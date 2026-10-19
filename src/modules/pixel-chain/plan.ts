import { add, cross, dist, dot, len, norm, scale, sub } from '../../geom/vec';
import type { Params, Vec3 } from '../../types';
import { resolveSpecs } from '../shared/params';
import { catenaryBySag, catenaryForLinks, heightAt, pointAtArc, sagOf } from './catenary';
import { effectivePitch, hingeRange, pcDims, type PcDims } from './dims';
import { anchorLabel, SAG_MAX, SAG_MIN, spanCount, type PcDesign, type PcGarland } from './model';
import { PC_PARAMS } from './params';

/**
 * Pure layout for M7 Pixel Chain: design + params → every link's pose, the pins, bend angles,
 * data order, strand splices and warnings. The build and the bench both run this.
 *
 * Each anchor is an anchor link (a bead with a bail) hanging level, its pins pitch/2 either
 * side. A span is the chain between one anchor's knuckle pin and the next anchor's clevis pin:
 * n rigid links of pin-to-pin length `pitch`, hanging on the catenary of arc length n·pitch.
 * n comes from the sag asked for, so the drape you get is the nearest one real links can make.
 */

const ZW: Vec3 = [0, 0, 1];
/** Anchor links turn in steps of this many degrees, so turned anchors still dedupe. */
export const YAW_STEP = 15;
export const YAW_MAX = 120;

export interface PcLink {
  gid: string;
  /** Position in the garland's chain order (anchor 0 first). */
  index: number;
  kind: 'anchor' | 'link';
  anchor?: number;
  span?: number;
  /** Link centre = bead centre, mm. */
  pos: Vec3;
  /** Link frame: X along the chain (knuckle side), Y along the pins, Z up out of the neck. */
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /** Anchor links: knuckle turned this far (deg, about Z) from the chain's incoming direction. */
  yaw: number;
  pitch: number;
}

export interface PcJoint {
  gid: string;
  pos: Vec3;
  /** Pin axis (unit). */
  axis: Vec3;
  /** Signed bend, deg: + concave up (sagging), − over the top (at anchors). */
  bend: number;
  span: number;
}

export interface PcSpan {
  index: number;
  from: number;
  to: number;
  /** Requested sag, % of the pin-to-pin chord (clamped to the allowed range). */
  sagPct: number;
  /** What n whole links actually hang to. */
  actualPct: number;
  sagMm: number;
  links: number;
  chord: number;
  arc: number;
  straight: boolean;
  /** Anchors closer than about two links: the span can't drape. */
  tooClose: boolean;
  /** Pins from the start anchor's knuckle to the end anchor's clevis. */
  joints: Vec3[];
}

export interface PcGarlandPlan {
  id: string;
  pitch: number;
  pitchReq: number;
  capped: boolean;
  raised: boolean;
  hinge: { up: number; down: number };
  /** Chain order (anchor 0 first). */
  links: PcLink[];
  /** Data order (reversed when the garland is fed from its last anchor). */
  order: PcLink[];
  joints: PcJoint[];
  spans: PcSpan[];
  /** Dense pin-line preview: anchors and the catenaries between them. */
  curve: Vec3[];
  /** Longest node-to-node distance between consecutive links. */
  maxChord: number;
  /** Largest bend relative to its limit. */
  worst: { bend: number; limit: number; where: string; ok: boolean } | null;
  arc: number;
  /** Lowest point of any bead, mm. */
  minZ: number;
  turns: { anchor: number; yaw: number; yawQ: number }[];
  /** Fewer than two anchors: nothing hangs yet. */
  incomplete: boolean;
}

export interface PcSplice {
  /** 1-based strand that starts here. */
  strand: number;
  gid: string;
  /** 1-based link in the garland's data order. */
  link: number;
  where: string;
}

export interface PcPlan {
  dims: PcDims;
  garlands: PcGarlandPlan[];
  /** Every link, in data order. */
  order: PcLink[];
  px: number;
  strands: number;
  splices: PcSplice[];
  /** Free wire runs between garlands (data order). */
  jumps: { from: string; to: string; mm: number }[];
  maxChord: number;
  worst: PcGarlandPlan['worst'];
  warnings: string[];
}

/** Resolved params, as the worker sees them. */
export const pcParams = (p: Params = {}): Params => resolveSpecs(PC_PARAMS, p);

const flat = (v: Vec3): Vec3 => [v[0], v[1], 0];
function rotZ(v: Vec3, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
const sagClamp = (v: number) => Math.min(SAG_MAX, Math.max(SAG_MIN, Number.isFinite(v) ? v : SAG_MIN));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Signed bend between link directions a → b about a pin axis, deg (+ = concave up). */
export function bendDeg(a: Vec3, b: Vec3, axis: Vec3): number {
  const pa = norm(sub(a, scale(axis, dot(a, axis))));
  const pb = norm(sub(b, scale(axis, dot(b, axis))));
  return (-Math.atan2(dot(cross(pa, pb), axis), dot(pa, pb)) * 180) / Math.PI;
}

/** One span: catenary between two pins, n whole links of `pitch`. */
export function solveSpan(S0: Vec3, S1: Vec3, sagPct: number, pitch: number, fallback: Vec3): Omit<PcSpan, 'index' | 'from' | 'to' | 'tooClose'> & { u: Vec3; curve: Vec3[] } {
  const dh = flat(sub(S1, S0));
  const h = len(dh);
  const dv = S1[2] - S0[2];
  const chord = Math.hypot(h, dv);
  const u = h > 1e-6 ? scale(dh, 1 / h) : fallback;
  const target = catenaryBySag(h, dv, (sagPct / 100) * chord);
  const n = Math.max(1, Math.ceil(chord / pitch - 1e-9), Math.round(target.length / pitch));
  const { c, joints: arcs } = catenaryForLinks(h, dv, n, pitch);
  const at = (s: number): Vec3 => {
    const [x, z] = pointAtArc(c, s);
    return add(S0, add(scale(u, x), [0, 0, z]));
  };
  const joints: Vec3[] = arcs.map((s, j) => (j === n ? S1 : at(s)));
  const curve: Vec3[] = [];
  const samples = c.straight ? 1 : 24;
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * h;
    curve.push(add(S0, add(scale(u, x), [0, 0, c.straight ? (i / samples) * dv : heightAt(c, x)])));
  }
  const sagMm = sagOf(c);
  return { sagPct, actualPct: chord > 1e-6 ? (100 * sagMm) / chord : 0, sagMm, links: n, chord, arc: c.length, straight: c.straight, joints, u, curve };
}

/** Lay out one garland. */
export function layoutGarland(g: PcGarland, d: PcDims): PcGarlandPlan {
  const { pitch, capped, raised } = effectivePitch(d, g.pitch ?? d.pitchParam);
  const pitchReq = g.pitch ?? d.pitchParam;
  const P = pitch / 2;
  const hinge = hingeRange(d, pitch);
  const m = g.anchors.length;
  const nSpans = spanCount(g);
  const closed = nSpans === m && m >= 3;
  const base: PcGarlandPlan = {
    id: g.id,
    pitch,
    pitchReq,
    capped,
    raised,
    hinge,
    links: [],
    order: [],
    joints: [],
    spans: [],
    curve: [...g.anchors],
    maxChord: 0,
    worst: null,
    arc: 0,
    minZ: Math.min(...g.anchors.map((a) => a[2] + d.zb)),
    turns: [],
    incomplete: nSpans === 0,
  };
  if (!nSpans) {
    base.links = g.anchors.map((pos, i) => ({ gid: g.id, index: i, kind: 'anchor', anchor: i, pos, x: [1, 0, 0], y: [0, 1, 0], z: ZW, yaw: 0, pitch }));
    base.order = base.links;
    return base;
  }

  // Horizontal direction of each span, anchor to anchor (a vertical span borrows a neighbour's).
  const spanDir: Vec3[] = [];
  for (let k = 0; k < nSpans; k++) {
    const v = flat(sub(g.anchors[(k + 1) % m], g.anchors[k]));
    spanDir.push(len(v) > 1e-6 ? norm(v) : (spanDir[k - 1] ?? [1, 0, 0]));
  }
  for (let k = nSpans - 1; k >= 0; k--) {
    const v = flat(sub(g.anchors[(k + 1) % m], g.anchors[k]));
    if (len(v) <= 1e-6 && k + 1 < nSpans) spanDir[k] = spanDir[k + 1];
  }

  // Anchor links: clevis faces the incoming span, knuckle turned (in YAW_STEP steps) to the outgoing one.
  const anchors = g.anchors.map((A, i) => {
    const inSpan = closed ? (i - 1 + m) % m : i - 1;
    const outSpan = closed || i < nSpans ? i % m : -1;
    const dout = outSpan >= 0 ? spanDir[outSpan] : spanDir[inSpan];
    const din = inSpan >= 0 ? spanDir[inSpan] : dout;
    const yaw = (Math.atan2(cross(din, dout)[2], dot(din, dout)) * 180) / Math.PI;
    const yawQ = Math.max(-YAW_MAX, Math.min(YAW_MAX, Math.round(yaw / YAW_STEP) * YAW_STEP)) || 0;
    const uout = rotZ(din, yawQ);
    return { A, din, uout, yaw, yawQ, clevis: sub(A, scale(din, P)), knuckle: add(A, scale(uout, P)) };
  });
  base.turns = anchors.map((a, i) => ({ anchor: i, yaw: a.yaw, yawQ: a.yawQ })).filter((t) => Math.abs(t.yaw) > 0.5);

  const links: PcLink[] = [];
  const joints: PcJoint[] = [];
  const curve: Vec3[] = [];
  const spans: PcSpan[] = [];
  const pushAnchor = (i: number) => {
    const a = anchors[i];
    links.push({ gid: g.id, index: links.length, kind: 'anchor', anchor: i, pos: a.A, x: a.din, y: norm(cross(ZW, a.din)), z: ZW, yaw: a.yawQ, pitch });
  };
  // Direction a link leaves toward the next joint, and arrives from the previous one.
  const outDir = (l: PcLink) => (l.kind === 'anchor' ? anchors[l.anchor!].uout : l.x);
  const inDir = (l: PcLink) => l.x;

  pushAnchor(0);
  for (let k = 0; k < nSpans; k++) {
    const i0 = k;
    const i1 = (k + 1) % m;
    curve.push(anchors[i0].A);
    const sagPct = sagClamp(g.sags[k]);
    const s = solveSpan(anchors[i0].knuckle, anchors[i1].clevis, sagPct, pitch, spanDir[k]);
    const axis = norm(cross(ZW, s.u));
    const horiz = len(flat(sub(g.anchors[i1], g.anchors[i0])));
    spans.push({ index: k, from: i0, to: i1, sagPct, actualPct: s.actualPct, sagMm: s.sagMm, links: s.links, chord: s.chord, arc: s.arc, straight: s.straight, tooClose: horiz < 1.6 * pitch, joints: s.joints });
    curve.push(...s.curve);
    let prev = links[links.length - 1];
    for (let j = 0; j < s.links; j++) {
      const a = s.joints[j];
      const b = s.joints[j + 1];
      const x = len(sub(b, a)) > 1e-9 ? norm(sub(b, a)) : s.u;
      const l: PcLink = { gid: g.id, index: links.length, kind: 'link', span: k, pos: scale(add(a, b), 0.5), x, y: axis, z: norm(cross(x, axis)), yaw: 0, pitch };
      joints.push({ gid: g.id, pos: a, axis, bend: bendDeg(outDir(prev), inDir(l), axis), span: k });
      links.push(l);
      prev = l;
    }
    // Into the next anchor's clevis.
    joints.push({ gid: g.id, pos: s.joints[s.links], axis, bend: bendDeg(outDir(prev), anchors[i1].din, axis), span: k });
    if (!closed || i1 !== 0) pushAnchor(i1);
  }
  if (closed) curve.push(anchors[0].A);
  else curve.push(anchors[m - 1].A);

  base.links = links;
  base.order = g.reverse ? [...links].reverse() : links;
  base.joints = joints;
  base.spans = spans;
  base.curve = curve;
  base.arc = spans.reduce((s, x) => s + x.arc, 0) + (closed ? m : m - 1) * pitch;

  let maxChord = 0;
  for (let i = 1; i < links.length; i++) maxChord = Math.max(maxChord, dist(links[i - 1].pos, links[i].pos));
  if (closed && links.length > 1) maxChord = Math.max(maxChord, dist(links[links.length - 1].pos, links[0].pos));
  base.maxChord = maxChord;

  let worst: PcGarlandPlan['worst'] = null;
  let worstRatio = -1;
  joints.forEach((jt) => {
    const limit = jt.bend >= 0 ? hinge.up : hinge.down;
    const ratio = Math.abs(jt.bend) / Math.max(limit, 1e-6);
    if (ratio > worstRatio) {
      worstRatio = ratio;
      const sp = spans[jt.span];
      worst = { bend: jt.bend, limit, where: `span ${anchorLabel(sp.from)}–${anchorLabel(sp.to)}`, ok: Math.abs(jt.bend) <= limit };
    }
  });
  base.worst = worst;
  base.minZ = Math.min(...links.map((l) => l.pos[2] + d.zb * l.z[2] - d.R * Math.hypot(l.z[0], l.z[1])), ...curve.map((p) => p[2] + d.zb));
  return base;
}

function whereIs(gp: PcGarlandPlan, l: PcLink): string {
  if (l.kind === 'anchor') return `anchor ${anchorLabel(l.anchor!)}`;
  const sp = gp.spans[l.span!];
  return `span ${anchorLabel(sp.from)}–${anchorLabel(sp.to)}`;
}

/** The whole design: garlands, data order, strands and warnings. */
export function planChain(design: PcDesign, params: Params): PcPlan {
  const d = pcDims(pcParams(params));
  const warnings: string[] = [];
  const garlands = design.garlands.map((g) => layoutGarland(g, d));
  const order = garlands.flatMap((g) => g.order);
  const px = order.length;
  const strands = Math.max(1, Math.ceil(px / d.strand));

  const splices: PcSplice[] = [];
  let start = 0;
  for (const gp of garlands) {
    for (let i = 0; i < gp.order.length; i++) {
      const at = start + i;
      if (at > 0 && at % d.strand === 0) splices.push({ strand: at / d.strand + 1, gid: gp.id, link: i + 1, where: whereIs(gp, gp.order[i]) });
    }
    start += gp.order.length;
  }

  const jumps: PcPlan['jumps'] = [];
  const lit = garlands.filter((g) => g.order.length);
  for (let i = 1; i < lit.length; i++) {
    const a = lit[i - 1].order[lit[i - 1].order.length - 1];
    const b = lit[i].order[0];
    jumps.push({ from: lit[i - 1].id, to: lit[i].id, mm: dist(a.pos, b.pos) });
  }

  const pitchSet = new Set<number>();
  for (const gp of garlands) {
    if (gp.incomplete) {
      warnings.push(`${gp.id} has one anchor. Add another to hang it.`);
      continue;
    }
    pitchSet.add(gp.pitch);
    if (gp.capped) warnings.push(`${gp.id}: a ${r1(gp.pitchReq)} mm pitch is longer than the ${d.lead} mm lead allows with ${d.slack} mm slack. Links are ${gp.pitch} mm instead.`);
    if (gp.raised) warnings.push(`${gp.id}: a ${r1(gp.pitchReq)} mm pitch would make neighbouring ${d.shape} beads touch. Links are ${gp.pitch} mm instead.`);
    if (gp.maxChord > d.lead + 1e-6) warnings.push(`${gp.id}: nodes ${r1(gp.maxChord)} mm apart, past the ${d.lead} mm lead.`);
    const w = gp.worst;
    if (w && !w.ok) {
      warnings.push(
        `${gp.id}: the chain bends ${r1(Math.abs(w.bend))}° ${w.bend >= 0 ? 'in the drape' : 'over an anchor'} (${w.where}); these hinges allow ${w.limit}°. ${w.bend >= 0 ? 'Use less sag or a longer pitch.' : 'Use more sag, or a longer pitch.'}`,
      );
    }
    for (const sp of gp.spans) if (sp.tooClose) warnings.push(`${gp.id}: anchors ${anchorLabel(sp.from)} and ${anchorLabel(sp.to)} are closer than two links. Move them apart.`);
    for (const t of gp.turns) {
      if (Math.abs(t.yaw) > YAW_MAX + YAW_STEP / 2) warnings.push(`${gp.id}: anchor ${anchorLabel(t.anchor)} turns ${r1(Math.abs(t.yaw))}°, past the ${YAW_MAX}° an anchor link can take. Add an anchor to round the corner.`);
    }
    if (gp.minZ < 0) warnings.push(`${gp.id} drapes ${r1(-gp.minZ)} mm into the floor. Raise its anchors or use less sag.`);
  }
  if (pitchSet.size > 1) warnings.push(`Garlands use ${pitchSet.size} different pitches, so their links print as separate parts.`);
  if (px > d.strand) {
    const at = splices.map((s) => `${s.gid} link ${s.link} (${s.where})`);
    warnings.push(`${px} nodes need ${strands} strands of ${d.strand}. Splice at ${at.join(', ')}.`);
  }
  for (const j of jumps) if (j.mm > d.lead) warnings.push(`${j.from} → ${j.to}: data jumps ${(j.mm / 1000).toFixed(2)} m between garlands. Run a 3-core extension lead.`);

  let maxChord = 0;
  let worst: PcPlan['worst'] = null;
  for (const gp of garlands) {
    maxChord = Math.max(maxChord, gp.maxChord);
    if (gp.worst && (!worst || Math.abs(gp.worst.bend) / Math.max(1, gp.worst.limit) > Math.abs(worst.bend) / Math.max(1, worst.limit))) worst = { ...gp.worst, where: `${gp.id} ${gp.worst.where}` };
  }
  return { dims: d, garlands, order, px, strands, splices, jumps, maxChord, worst, warnings };
}

/** Every link of a design, in data order: the adapter-facing summary of `planChain`. */
export function layoutLinks(design: PcDesign, params: Params = {}): PcLink[] {
  return planChain(design, params).order;
}

/** Highest-level summary of where the chain sits, for framing and lifting drawn garlands. */
export function garlandBounds(gp: PcGarlandPlan): { min: Vec3; max: Vec3 } {
  const pts = [...gp.curve, ...gp.links.map((l) => l.pos)];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p[k]);
    max[k] = Math.max(max[k], p[k]);
  }
  return { min, max };
}
