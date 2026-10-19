import { planChain, type Chain } from '../../graph/dataPath';
import { add, cross, dist, dot, norm, scale, sub } from '../../geom/vec';
import type { Params, Vec3 } from '../../types';
import { fmt, plural } from '../shared/layout';
import { footprint, instDims, instPose, type InstDims, type InstPose, type SpanFrame } from './instruments';
import { KINDS, type InstrumentKind, type MountSide, type RigDesign } from './model';
import { MIN_CUSTOM, rigDims, SCALE, type RigDims } from './params';

/**
 * M3 Mini Rig planning: everything the build, the bench and the inspector share. Pure.
 *
 * - Every node is a 48 mm corner block. Its block frame is yawed so the drawn spans land on
 *   its faces; spans within SNAP_DEG of a face count as square, anything else is flagged
 *   (F34 corners are orthogonal). The set of used faces gives the block type and, up to the
 *   24 cube rotations, its printed part class.
 * - Each span's clear run (centre to centre minus a half block at each end) is cut into stock
 *   sections from the catalogue that fit the printer standing up, fewest pieces first, then
 *   fewest distinct lengths; a remainder becomes one short custom section.
 * - Instruments chain along the rig: spans in planChain order from the controller node,
 *   and along each span in the direction the data travels.
 */

/** Spans within this many degrees of a block axis are squared up. */
export const SNAP_DEG = 5;
/** Stock lengths count as an exact fit within this, mm. */
export const FIT_TOL = 0.5;

/* ---------------- Cube faces and rotations ---------------- */

/** Block faces: +X −X +Y −Y +Z −Z, each with a right-handed (u, v) so u × v = n. */
export const FACES: { n: Vec3; u: Vec3; v: Vec3; name: string }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], name: '+X' },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], name: '−X' },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], name: '+Y' },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], name: '−Y' },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], name: 'top' },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], name: 'bottom' },
];
export const TOP = 4;
export const BOTTOM = 5;

/**
 * Bolt pattern on a block face: four holes in a pinwheel, (a, b) turned in 90° steps. Two
 * faces meeting at an edge see the edge from opposite sides, so their holes near it sit at
 * opposite offsets along it and never collide inside the block. Section end frames carry
 * both hands (8 holes), so they bolt to blocks and to each other.
 */
export const pinwheel = (a: number, b: number): [number, number][] => [
  [a, b],
  [-b, a],
  [-a, -b],
  [b, -a],
];

const faceIndex = (v: Vec3): number => {
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(v[i]) > Math.abs(v[m]) ? i : m), 0);
  return 2 * k + (v[k] > 0 ? 0 : 1);
};

/** The 24 proper rotations of the cube, as row-major 3×3 signed permutation matrices. */
export const CUBE_ROTATIONS: number[][][] = (() => {
  const out: number[][][] = [];
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const p of perms)
    for (let s = 0; s < 8; s++) {
      const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (c === p[r] ? (s & (1 << r) ? -1 : 1) : 0)));
      const det =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      if (det > 0) out.push(m);
    }
  return out;
})();

const rot = (m: number[][], v: Vec3): Vec3 => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as Vec3;

export function rotateMask(m: number[][], mask: number): number {
  let out = 0;
  for (let f = 0; f < 6; f++) if (mask & (1 << f)) out |= 1 << faceIndex(rot(m, FACES[f].n));
  return out;
}

/**
 * Canonical face set for a block, up to rotation, and the rotation taking the canonical
 * block onto the actual one. The bottom face carries the highest bit, so the canonical
 * block keeps its bottom free whenever it can (a clean first layer).
 */
export function canonicalBlock(mask: number): { key: number; rot: number[][] } {
  let best = Infinity;
  let bestR = CUBE_ROTATIONS[0];
  for (const m of CUBE_ROTATIONS) {
    const k = rotateMask(m, mask);
    if (k < best) [best, bestR] = [k, m];
  }
  // bestR maps actual → canonical; its transpose maps canonical → actual.
  return { key: best, rot: [0, 1, 2].map((r) => [0, 1, 2].map((c) => bestR[c][r])) };
}

const popcount = (m: number) => [0, 1, 2, 3, 4, 5].reduce((s, f) => s + ((m >> f) & 1), 0);
const hasOpposite = (m: number) => [0, 2, 4].some((f) => m & (1 << f) && m & (1 << (f + 1)));

export type BlockType = 'none' | 'end' | 'corner' | 'inline' | 'T' | 'cross' | '5-way' | '6-way';

/** Block type from the faces its spans use: 2/3/4/6-way, corner or T or cross. */
export function blockType(spanMask: number): { ways: number; type: BlockType; label: string } {
  const ways = popcount(spanMask);
  if (ways === 0) return { ways, type: 'none', label: 'No truss' };
  if (ways === 1) return { ways, type: 'end', label: '1-way end' };
  if (ways === 2) return hasOpposite(spanMask) ? { ways, type: 'inline', label: '2-way inline (180°)' } : { ways, type: 'corner', label: '2-way corner (90°)' };
  if (ways === 3) return hasOpposite(spanMask) ? { ways, type: 'T', label: '3-way T' } : { ways, type: 'corner', label: '3-way corner' };
  if (ways === 4) {
    const free = 63 & ~spanMask;
    return hasOpposite(free) ? { ways, type: 'cross', label: '4-way cross' } : { ways, type: 'T', label: '4-way T' };
  }
  return ways === 5 ? { ways, type: '5-way', label: '5-way' } : { ways, type: '6-way', label: '6-way' };
}

/* ---------------- Sections ---------------- */

export interface SectionCut {
  /** Section lengths in order from node a, mm (overall, end frame to end frame). */
  lengths: number[];
  /** Length of the custom section among them, or null when stock lengths fill the run. */
  custom: number | null;
}

/**
 * Cut a clear run into sections: stock lengths that fit the printer, plus at most one short
 * custom section (MIN_CUSTOM up to the shortest stock length + MIN_CUSTOM). Fewest pieces
 * first, then fewest distinct lengths, then the shortest custom piece. The custom piece sits
 * in the middle of the run, so the rig reads symmetric.
 */
export function planSections(clear: number, catalogue: number[], maxLen: number, minCustom = MIN_CUSTOM, tol = FIT_TOL): SectionCut {
  if (!(clear >= minCustom - tol)) return { lengths: [], custom: null };
  const cat = [...catalogue].filter((l) => l <= maxLen + 1e-6).sort((a, b) => b - a);
  if (!cat.length) {
    const n = Math.max(1, Math.ceil(clear / maxLen));
    return { lengths: Array(n).fill(clear / n), custom: clear / n };
  }
  const customMax = Math.min(maxLen, cat[cat.length - 1] + minCustom);
  let best: { score: number[]; counts: number[]; rest: number } | null = null;
  const counts = cat.map(() => 0);
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  const visit = (i: number, sum: number, pieces: number) => {
    if (best && pieces > best.score[0]) return;
    if (i === cat.length) {
      const rest = clear - sum;
      const exact = Math.abs(rest) <= tol;
      if (!exact && !(rest >= minCustom && rest < customMax)) return;
      const n = pieces + (exact ? 0 : 1);
      const distinct = counts.filter((c) => c > 0).length + (exact ? 0 : 1);
      const score = [n, distinct, exact ? 0 : rest];
      if (!best || better(score, best.score)) best = { score, counts: [...counts], rest };
      return;
    }
    const max = Math.floor((clear - sum + tol) / cat[i]);
    for (let k = max; k >= 0; k--) {
      counts[i] = k;
      visit(i + 1, sum + k * cat[i], pieces + k);
    }
    counts[i] = 0;
  };
  visit(0, 0, 0);
  if (!best) return { lengths: [clear], custom: clear };
  const b = best as { counts: number[]; rest: number };
  const stock = cat.flatMap((l, i) => Array(b.counts[i]).fill(l) as number[]);
  if (Math.abs(b.rest) <= tol) return { lengths: stock, custom: null };
  const lengths = [...stock];
  lengths.splice(Math.ceil(stock.length / 2), 0, b.rest);
  return { lengths, custom: b.rest };
}

/** "1.5 m" for stock lengths, "52 mm custom" for the rest. */
export function sectionLabel(len: number, dims: RigDims): string {
  const stock = dims.catalogueAll.find((l) => Math.abs(l - len) < 0.05);
  return stock ? `${fmt((stock * SCALE) / 1000, 2)} m · ${fmt(len)} mm` : `custom ${fmt(len)} mm`;
}

/* ---------------- The plan ---------------- */

export interface NodeInfo {
  id: string;
  pos: Vec3;
  spans: string[];
  /** Block frame: yaw about Z, axes in world. */
  yaw: number;
  axes: [Vec3, Vec3, Vec3];
  /** Faces used by spans, and by spans plus base plate and pick eye (the drilled faces). */
  spanMask: number;
  mask: number;
  ways: number;
  type: BlockType;
  label: string;
  base: boolean;
  pick: boolean;
  /** Part class (canonical face set) and the rotation canonical → block frame. */
  classKey: number;
  classRot: number[][];
  /** Worst angle between a span and its block face, degrees. */
  offDeg: number;
  bad: boolean;
}

export interface SectionInfo {
  len: number;
  /** Start offset from node a along the span axis. */
  start: number;
  custom: boolean;
}

export interface SpanInfo {
  id: string;
  a: string;
  b: string;
  A: Vec3;
  B: Vec3;
  length: number;
  /** Centre-to-centre minus a half block at each end. */
  clear: number;
  frame: SpanFrame;
  vertical: boolean;
  sections: SectionInfo[];
  ok: boolean;
}

export interface InstInfo {
  id: string;
  kind: InstrumentKind;
  span: string;
  t: number;
  side: MountSide;
  pan: number;
  tilt: number;
  /** mm from node a along the span axis. */
  along: number;
  dims: InstDims;
  pose: InstPose;
  /** Data index (0-based) and the end of the span the chain enters from. */
  seq: number;
  from: string;
}

export interface Group<T> {
  key: string;
  label: string;
  count: number;
  members: T[];
}

export interface RigPlan {
  dims: RigDims;
  nodes: NodeInfo[];
  spans: SpanInfo[];
  /** Instruments in data order. */
  instruments: InstInfo[];
  chain: Chain;
  controller: string;
  sectionGroups: (Group<string> & { len: number; custom: boolean })[];
  blockGroups: (Group<string> & { classKey: number })[];
  joints: { sectionSection: number; sectionBlock: number };
  px: number;
  warnings: string[];
}

const Z: Vec3 = [0, 0, 1];
const yawAxes = (yaw: number): [Vec3, Vec3, Vec3] => [
  [Math.cos(yaw), Math.sin(yaw), 0],
  [-Math.sin(yaw), Math.cos(yaw), 0],
  Z,
];
const offAxis = (d: Vec3, axes: Vec3[]): number => {
  const m = Math.max(...axes.map((a) => Math.abs(dot(d, a))));
  return (Math.acos(Math.min(1, m)) * 180) / Math.PI;
};
/** Yaw folded into [−45°, 45°). */
const foldYaw = (y: number) => {
  const q = Math.PI / 2;
  return ((((y + q / 2) % q) + q) % q) - q / 2;
};

/** Cross-section frame of a span: "up" is world up (horizontal spans) or the block's +Y (vertical ones). */
export function spanFrame(A: Vec3, B: Vec3, yawA: number): SpanFrame {
  const d = norm(sub(B, A));
  const ref = Math.abs(d[2]) > 0.9 ? yawAxes(yawA)[1] : Z;
  const up = norm(sub(ref, scale(d, dot(ref, d))));
  let front = cross(d, up);
  const fy = -front[1];
  if (fy < -1e-6 || (Math.abs(fy) <= 1e-6 && -front[0] < 0)) front = scale(front, -1);
  return { A, d, up, front };
}

export function planRig(design: RigDesign, params: Params): RigPlan {
  const dims = rigDims(params);
  const W = dims.W;
  const warnings: string[] = [];
  const nodeById = new Map(design.nodes.map((n) => [n.id, n]));

  /* Spans that join two distinct, existing nodes. */
  const spans = design.spans.filter((s) => {
    const ok = s.a !== s.b && nodeById.has(s.a) && nodeById.has(s.b);
    if (!ok) warnings.push(`Span ${s.id} doesn't join two nodes and is skipped.`);
    return ok;
  });
  const incident = new Map<string, { span: string; dir: Vec3 }[]>();
  for (const s of spans) {
    const A = nodeById.get(s.a)!.pos;
    const B = nodeById.get(s.b)!.pos;
    if (dist(A, B) < 1e-6) continue;
    const d = norm(sub(B, A));
    incident.set(s.a, [...(incident.get(s.a) ?? []), { span: s.id, dir: d }]);
    incident.set(s.b, [...(incident.get(s.b) ?? []), { span: s.id, dir: scale(d, -1) }]);
  }

  /* Block yaw: square the block to its horizontal spans; vertical-only nodes inherit. */
  const yaw = new Map<string, number>();
  for (const n of design.nodes) {
    const inc = incident.get(n.id) ?? [];
    const cands = inc.filter((e) => Math.abs(e.dir[2]) < 0.7).map((e) => foldYaw(Math.atan2(e.dir[1], e.dir[0])));
    if (!cands.length) continue;
    let best = cands[0];
    let bestCost = Infinity;
    for (const c of cands) {
      const cost = Math.max(...inc.map((e) => offAxis(e.dir, yawAxes(c))));
      if (cost < bestCost - 1e-9) [best, bestCost] = [c, cost];
    }
    yaw.set(n.id, best);
  }
  for (let pass = 0; pass < design.nodes.length; pass++) {
    let changed = false;
    for (const s of spans) {
      for (const [x, y] of [
        [s.a, s.b],
        [s.b, s.a],
      ]) {
        if (!yaw.has(x) && yaw.has(y)) {
          yaw.set(x, yaw.get(y)!);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  /* Nodes → blocks. */
  const nodes: NodeInfo[] = [];
  for (const n of design.nodes) {
    const inc = incident.get(n.id) ?? [];
    const y = yaw.get(n.id) ?? 0;
    const axes = yawAxes(y);
    let spanMask = 0;
    let offDeg = 0;
    let bad = false;
    const byFace = new Map<number, string>();
    for (const e of inc) {
      const local: Vec3 = [dot(e.dir, axes[0]), dot(e.dir, axes[1]), dot(e.dir, axes[2])];
      const f = faceIndex(local);
      const off = offAxis(e.dir, axes);
      offDeg = Math.max(offDeg, off);
      if (off > SNAP_DEG) {
        bad = true;
        warnings.push(`${e.span} meets ${n.id} ${fmt(off, 0)}° off square. F34 corner blocks are orthogonal: square the span up (within ${SNAP_DEG}°).`);
      }
      if (byFace.has(f)) {
        bad = true;
        warnings.push(`${n.id}: ${byFace.get(f)} and ${e.span} both land on the block's ${FACES[f].name} face.`);
      }
      byFace.set(f, e.span);
      spanMask |= 1 << f;
    }
    let base = n.base;
    let pick = n.pick;
    if (base && spanMask & (1 << BOTTOM)) {
      warnings.push(`${n.id}: a span uses the bottom face, so there's no room for its base plate.`);
      base = false;
    }
    if (pick && spanMask & (1 << TOP)) {
      warnings.push(`${n.id}: a span uses the top face, so there's no room for its pick eye.`);
      pick = false;
    }
    if (!inc.length) warnings.push(`${n.id} has no truss and is skipped.`);
    const mask = spanMask | (base ? 1 << BOTTOM : 0) | (pick ? 1 << TOP : 0);
    const bt = blockType(spanMask);
    const cls = canonicalBlock(mask);
    nodes.push({ id: n.id, pos: n.pos, spans: inc.map((e) => e.span), yaw: y, axes, spanMask, mask, ways: bt.ways, type: bt.type, label: bt.label, base, pick, classKey: cls.key, classRot: cls.rot, offDeg, bad });
  }

  /* Spans → sections. */
  const spanInfos: SpanInfo[] = [];
  let sectionSection = 0;
  let sectionBlock = 0;
  for (const s of spans) {
    const A = nodeById.get(s.a)!.pos;
    const B = nodeById.get(s.b)!.pos;
    const length = dist(A, B);
    const clear = length - W;
    const frame = spanFrame(A, B, yaw.get(s.a) ?? 0);
    const cut = planSections(clear, dims.catalogue, dims.maxSection);
    const ok = cut.lengths.length > 0;
    if (!ok) warnings.push(`${s.id} is ${fmt(length)} mm centre to centre: too short for two blocks and a ${MIN_CUSTOM} mm section. Move its nodes at least ${W + MIN_CUSTOM} mm apart.`);
    const sections: SectionInfo[] = [];
    let at = W / 2;
    let customSeen = false;
    for (const len of cut.lengths) {
      const custom = cut.custom !== null && !customSeen && Math.abs(len - cut.custom) < 1e-9;
      if (custom) customSeen = true;
      sections.push({ len, start: at, custom });
      at += len;
    }
    if (ok) {
      sectionSection += sections.length - 1;
      sectionBlock += 2;
    }
    spanInfos.push({ id: s.id, a: s.a, b: s.b, A, B, length, clear, frame, vertical: Math.abs(frame.d[2]) > 0.9, sections, ok });
  }
  const spanById = new Map(spanInfos.map((s) => [s.id, s]));

  /* Instruments. */
  const dimsByKind = new Map<InstrumentKind, InstDims>();
  const idims = (k: InstrumentKind) => {
    if (!dimsByKind.has(k)) dimsByKind.set(k, instDims(k, dims));
    return dimsByKind.get(k)!;
  };
  type Placed = Omit<InstInfo, 'seq' | 'from'>;
  const placed: Placed[] = [];
  for (const i of design.instruments) {
    const sp = spanById.get(i.span);
    if (!sp || !sp.ok) {
      warnings.push(`${i.id} hangs on ${i.span}, which isn't a buildable span. It's skipped.`);
      continue;
    }
    const id = idims(i.kind);
    const along = W / 2 + i.t * Math.max(0, sp.clear);
    placed.push({ id: i.id, kind: i.kind, span: i.span, t: i.t, side: i.side, pan: i.pan, tilt: i.tilt, along, dims: id, pose: instPose(sp.frame, along, i.side, i.pan, i.tilt, dims, id) });
  }
  const bat = dimsByKind.get('batten');
  if (bat?.batten?.trimmed) warnings.push(`Battens are shortened to ${bat.px} px so they and their yokes fit the ${dims.bed.name} bed.`);

  // Overlaps on the same chord.
  for (let x = 0; x < placed.length; x++)
    for (let y = x + 1; y < placed.length; y++) {
      const p = placed[x];
      const q = placed[y];
      if (p.span !== q.span || p.side !== q.side) continue;
      const need = (footprint(p.dims, p.pan) + footprint(q.dims, q.pan)) / 2;
      if (Math.abs(p.along - q.along) < need) warnings.push(`${p.id} and ${q.id} overlap on ${p.span}: move them at least ${fmt(need, 0)} mm apart.`);
    }

  /* Data order: spans with instruments are "lit", walked from the controller node. */
  const lit = new Set(placed.map((p) => p.span));
  const built = nodes.filter((n) => n.spans.length);
  const controller =
    (design.controller && built.some((n) => n.id === design.controller) ? design.controller : '') || built.find((n) => n.base)?.id || built[0]?.id || '';
  const positions = new Map(design.nodes.map((n) => [n.id, n.pos]));
  const chain = planChain(
    spanInfos.filter((s) => s.ok).map((s) => ({ id: s.id, a: s.a, b: s.b, dark: !lit.has(s.id), flip: false, length: s.length })),
    controller,
    [],
    positions,
  );
  const instruments: InstInfo[] = [];
  for (const run of chain.lit) {
    const sp = spanById.get(run.strut)!;
    const fwd = run.from === sp.a;
    const list = placed.filter((p) => p.span === run.strut).sort((p, q) => (fwd ? p.along - q.along : q.along - p.along));
    for (const p of list) instruments.push({ ...p, seq: instruments.length, from: run.from });
  }
  if (chain.jumps) warnings.push(`The rig is in ${chain.jumps + 1} separate pieces. The data line jumps between them on a free cable.`);

  /* Print groups. */
  const sectionGroups = new Map<string, Group<string> & { len: number; custom: boolean }>();
  for (const s of spanInfos)
    for (const sec of s.sections) {
      const key = sec.len.toFixed(1);
      const g = sectionGroups.get(key) ?? { key, label: sectionLabel(sec.len, dims), count: 0, members: [], len: sec.len, custom: sec.custom };
      g.count++;
      if (!g.members.includes(s.id)) g.members.push(s.id);
      sectionGroups.set(key, g);
    }
  const blockGroups = new Map<number, Group<string> & { classKey: number }>();
  for (const n of nodes) {
    if (!n.spans.length) continue;
    const g = blockGroups.get(n.classKey) ?? { key: `C${n.classKey}`, label: `${n.label}${n.base ? ' + base' : ''}${n.pick ? ' + pick' : ''}`, count: 0, members: [], classKey: n.classKey };
    g.count++;
    g.members.push(n.id);
    blockGroups.set(n.classKey, g);
  }

  const total = instruments.reduce((s, i) => s + i.dims.px, 0);
  const chPerPx = new Set(instruments.map((i) => i.dims.pixel.chPerPx));
  const channels = instruments.reduce((s, i) => s + i.dims.px * i.dims.pixel.chPerPx, 0);
  if (channels > 512) warnings.push(`${total} px is ${channels} channels: the rig patches across ${Math.ceil(channels / 510)} universes.`);
  if (chPerPx.size > 1) warnings.push('RGB and RGBW instruments share one data line: set the controller per instrument, or use one pixel type.');
  const volts = new Set(instruments.map((i) => i.dims.pixel.volts));
  if (volts.size > 1) warnings.push(`Instruments run at ${[...volts].join(' V and ')} V: feed each voltage separately.`);

  return {
    dims,
    nodes,
    spans: spanInfos,
    instruments,
    chain,
    controller,
    sectionGroups: [...sectionGroups.values()].sort((a, b) => b.len - a.len),
    blockGroups: [...blockGroups.values()].sort((a, b) => b.count - a.count),
    joints: { sectionSection, sectionBlock },
    px: total,
    warnings,
  };
}

/** World point at a node's block face centre, for overlays. */
export const faceCentre = (n: NodeInfo, f: number, W: number): Vec3 =>
  add(n.pos, scale(add(add(scale(n.axes[0], FACES[f].n[0]), scale(n.axes[1], FACES[f].n[1])), scale(n.axes[2], FACES[f].n[2])), W / 2));

/** "3 PARs · 2 2-lites": instrument counts by kind, for stats lines. */
export function kindSummary(plan: RigPlan): string {
  const counts = new Map<InstrumentKind, number>();
  for (const i of plan.instruments) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => plural(n, KINDS[k].short)).join(' · ') || 'none';
}
