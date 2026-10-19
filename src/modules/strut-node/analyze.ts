import type { Vec3 } from '../../types';
import {
  add,
  angleDeg,
  cross,
  dist,
  dot,
  len,
  letters,
  norm,
  perp,
  perpOf,
  rotFromTo,
  scale,
  sphereDirs,
  sub,
  type SnDesign,
  type SnStrut,
} from './model';
import type { SnDims } from './params';
import { matchSockets } from '../../graph/dedupe';

/**
 * Everything derived from a design that doesn't need a geometry kernel: socket aims,
 * offsets, angle checks, cut lengths, part dedupe and the hub split plan. It runs in the
 * build worker and on the UI thread, so the inspector and the printed parts always agree.
 */

export interface SocketInfo {
  strut: string;
  other: string;
  /** Unit vector from the hub centre along the strut: the socket axis. */
  dir: Vec3;
  /** Which way the strip faces (⊥ dir). The spine key in the spigot follows it. */
  face: Vec3;
  lit: boolean;
  /** Dedupe key for this socket. */
  key: string;
  /** Engraving: hub line and strut line. */
  hubLabel: string;
  strutLabel: string;
}

export interface HubInfo {
  id: string;
  pos: Vec3;
  sockets: SocketInfo[];
  /** Smallest angle between two sockets, degrees. Null for one socket. */
  minAngle: number | null;
  minPair: [string, string] | null;
  /** Hub centre to tube shoulder, mm. Grows when sockets crowd each other. */
  offset: number;
  /** Tubes would still touch at the max offset. */
  collide: boolean;
  controller: boolean;
  classId: string;
  /** Rotation from the class representative's frame to this hub. */
  rot: number[][];
}

export interface StrutInfo {
  id: string;
  a: string;
  b: string;
  dark: boolean;
  flip: boolean;
  /** Node centre to node centre. */
  length: number;
  dir: Vec3;
  face: Vec3;
  offA: number;
  offB: number;
  /** Tube cut length: node distance minus both socket offsets. */
  cut: number;
  /** Visible length between spigot tips, where pixels go. */
  litLength: number;
  px: number;
  typeId: string;
  tooShort: boolean;
}

export interface StrutType {
  id: string;
  cut: number;
  dark: boolean;
  px: number;
  members: string[];
  /** Tube printed in this many equal segments joined by couplers. */
  tubeSegs: number;
  tubeSegLen: number;
  spineLen: number;
  spineSegs: number;
  spineSegLen: number;
}

export interface SplitPlan {
  /** Cut plane: n·x = h in the representative's frame. */
  n: Vec3;
  h: number;
  overhangDeg: number;
  supportFree: boolean;
  /** Bolt axis passes through `bolt.at` along n. */
  bolt: { at: Vec3; span: number; length: number; counterbore: number; clearance: number };
  pins: Vec3[];
  feed: Vec3 | null;
}

export interface HubClass {
  id: string;
  rep: string;
  members: string[];
  controller: boolean;
  offset: number;
  sockets: SocketInfo[];
  split: SplitPlan;
  /** Per socket (same order as `sockets`): which way the engraving faces. */
  labelUp: Vec3[];
}

export interface Analysis {
  dims: SnDims;
  hubs: HubInfo[];
  struts: StrutInfo[];
  types: StrutType[];
  classes: HubClass[];
  centroid: Vec3;
  /** Smallest socket angle a hub can take at the max offset with this tube. */
  requiredAngle: number;
  warnings: string[];
}

const ROUND = (v: number, q: number) => Number((Math.round(v / q) * q).toFixed(6));
/** Struts whose cut lengths differ by no more than this print as one part. */
export const CUT_TOL = 0.3;

/** Struts that can be built: both ends exist, distinct, not duplicated, non-zero. */
export function validStruts(d: SnDesign, warnings: string[] = []): SnStrut[] {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: SnStrut[] = [];
  for (const s of d.struts) {
    const a = nodes.get(s.a);
    const b = nodes.get(s.b);
    if (!a || !b || s.a === s.b) {
      warnings.push(`${s.id} is not connected to two hubs and was skipped.`);
      continue;
    }
    const k = [s.a, s.b].sort().join('|');
    if (seen.has(k)) {
      warnings.push(`${s.id} duplicates another strut between ${s.a} and ${s.b} and was skipped.`);
      continue;
    }
    if (dist(a.pos, b.pos) < 1) {
      warnings.push(`${s.id} has zero length and was skipped.`);
      continue;
    }
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Pixels that fit a strut's lit length, centred, as distances from the lit start. */
export function pixelSlots(dims: SnDims, litLength: number): number[] {
  // Each pixel owns one pitch of length, so half a pitch stays clear of each spigot.
  const pitch = dims.pixel.shape.kind === 'strip' ? dims.pixel.shape.pitch : dims.nodePitch;
  const k = Math.max(0, Math.floor(litLength / pitch + 1e-9));
  return Array.from({ length: k }, (_, i) => litLength / 2 + (i - (k - 1) / 2) * pitch);
}

/** Socket offset a hub needs so neighbouring tubes and their engraving bands clear. */
export function socketOffset(dims: SnDims, minAngle: number | null): { offset: number; collide: boolean } {
  const base = dims.tExit + dims.labelBand + 1;
  let need = base;
  if (minAngle !== null && minAngle < 179.9) {
    const half = ((minAngle / 2) * Math.PI) / 180;
    need = Math.max(base, (dims.collarR + 0.4) / Math.sin(half) + dims.labelBand);
  }
  const collide = need > dims.maxOffset;
  return { offset: Math.ceil(Math.min(need, dims.maxOffset) * 2) / 2, collide };
}

/** Smallest inter-socket angle that still clears at the max offset. */
export function requiredAngle(dims: SnDims): number {
  const room = dims.maxOffset - dims.labelBand;
  const s = Math.min(1, (dims.collarR + 0.4) / Math.max(1e-6, room));
  return (2 * Math.asin(s) * 180) / Math.PI;
}

export function analyze(design: SnDesign, dims: SnDims): Analysis {
  const warnings: string[] = [];
  const struts = validStruts(design, warnings);
  const nodes = new Map(design.nodes.map((n) => [n.id, n]));
  const centroid: Vec3 = design.nodes.length
    ? design.nodes.reduce<Vec3>((s, n) => add(s, scale(n.pos, 1 / design.nodes.length)), [0, 0, 0])
    : [0, 0, 0];
  const controller = nodes.has(design.controller) ? design.controller : (design.nodes[0]?.id ?? '');

  /* ---- Strut frames ---- */
  const geo = new Map<string, { dir: Vec3; face: Vec3; length: number }>();
  for (const s of struts) {
    const A = nodes.get(s.a)!.pos;
    const B = nodes.get(s.b)!.pos;
    const dir = norm(sub(B, A));
    const mid = scale(add(A, B), 0.5);
    // Strips face outward from the sculpture's centre, so they read from outside.
    const face = perpOf(sub(mid, centroid), dir, 1e-3 * dist(A, B)) ?? perpOf([0, 0, 1], dir) ?? perp(dir);
    geo.set(s.id, { dir, face, length: dist(A, B) });
  }

  /* ---- Hubs: sockets, angles, offsets ---- */
  const incident = new Map<string, SnStrut[]>();
  for (const s of struts) for (const e of [s.a, s.b]) incident.set(e, [...(incident.get(e) ?? []), s]);
  const hubs: HubInfo[] = [];
  for (const n of design.nodes) {
    const inc = incident.get(n.id) ?? [];
    if (!inc.length) {
      warnings.push(`${n.id} has no struts. It is left out of the build.`);
      continue;
    }
    const sockets: SocketInfo[] = inc
      .map((s) => {
        const g = geo.get(s.id)!;
        const out = s.a === n.id;
        return { strut: s.id, other: out ? s.b : s.a, dir: out ? g.dir : scale(g.dir, -1), face: g.face, lit: !s.dark, key: '', hubLabel: '', strutLabel: '' };
      })
      .sort((x, y) => (x.strut < y.strut ? -1 : 1));
    let minAngle: number | null = null;
    let minPair: [string, string] | null = null;
    for (let i = 0; i < sockets.length; i++)
      for (let j = i + 1; j < sockets.length; j++) {
        const a = angleDeg(sockets[i].dir, sockets[j].dir);
        if (minAngle === null || a < minAngle) {
          minAngle = a;
          minPair = [sockets[i].strut, sockets[j].strut];
        }
      }
    const { offset, collide } = socketOffset(dims, minAngle);
    hubs.push({ id: n.id, pos: n.pos, sockets, minAngle, minPair, offset, collide, controller: n.id === controller, classId: '', rot: rotFromTo([0, 0, 1], [0, 0, 1]) });
  }
  const hubById = new Map(hubs.map((h) => [h.id, h]));

  /* ---- Struts: cut lengths and types ---- */
  const infos: StrutInfo[] = struts.map((s) => {
    const g = geo.get(s.id)!;
    const offA = hubById.get(s.a)!.offset;
    const offB = hubById.get(s.b)!.offset;
    const cut = ROUND(g.length - offA - offB, 0.1);
    const litLength = Math.max(0, cut - 2 * dims.insert);
    const px = s.dark ? 0 : pixelSlots(dims, litLength).length;
    const tooShort = cut < 2 * dims.insert + 6;
    return { id: s.id, a: s.a, b: s.b, dark: !!s.dark, flip: !!s.flip, length: g.length, dir: g.dir, face: g.face, offA, offB, cut, litLength, px, typeId: '', tooShort };
  });

  // Cut lengths within CUT_TOL of each other are one part: the spigot fit swallows the difference,
  // and hand-placed or rounded hub positions never land on exactly the same tenth.
  const groups: StrutInfo[][] = [];
  for (const dark of [false, true]) {
    const sorted = infos.filter((s) => s.dark === dark).sort((x, y) => x.cut - y.cut);
    for (const s of sorted) {
      const g = groups[groups.length - 1];
      if (g && g[0].dark === dark && s.cut - g[0].cut <= CUT_TOL) g.push(s);
      else groups.push([s]);
    }
  }
  const types: StrutType[] = groups.map((members, i) => {
    const cut = ROUND(members.reduce((sum, m) => sum + m.cut, 0) / members.length, 0.1);
    for (const m of members) {
      m.cut = cut;
      m.litLength = Math.max(0, cut - 2 * dims.insert);
      m.px = m.dark ? 0 : pixelSlots(dims, m.litLength).length;
    }
    const { ridge } = dims.coupler;
    const tubeSegs = Math.max(1, Math.ceil((cut + ridge) / (dims.bed.z - 1 + ridge)));
    const tubeSegLen = (cut - (tubeSegs - 1) * ridge) / tubeSegs;
    const spineLen = Math.max(10, cut - 2 * dims.insert + 2 * dims.slotDepth - 1);
    const maxSpine = Math.max(dims.bed.x, dims.bed.y) - 2;
    const spineSegs = Math.max(1, Math.ceil(spineLen / maxSpine));
    return { id: letters(i), cut, dark: members[0].dark, px: members[0].px, members: members.map((m) => m.id), tubeSegs, tubeSegLen, spineLen, spineSegs, spineSegLen: spineLen / spineSegs };
  });
  for (const t of types) for (const m of t.members) infos.find((s) => s.id === m)!.typeId = t.id;
  const strutById = new Map(infos.map((s) => [s.id, s]));

  /* ---- Socket keys and hub classes ---- */
  for (const h of hubs) for (const so of h.sockets) so.key = dims.labels === 'types' ? strutById.get(so.strut)!.typeId : so.lit ? 'L' : 'D';
  const classes: HubClass[] = [];
  const ordered = [...hubs].sort((a, b) => Number(b.controller) - Number(a.controller) || (a.id < b.id ? -1 : 1));
  for (const h of ordered) {
    let placed = false;
    if (dims.labels !== 'ids' && !h.controller) {
      for (const c of classes) {
        if (c.controller || Math.abs(c.offset - h.offset) > 0.01) continue;
        const rot = matchSockets(c.sockets, h.sockets);
        if (rot) {
          c.members.push(h.id);
          h.classId = c.id;
          h.rot = rot;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      const id = dims.labels === 'ids' ? h.id : `H${letters(classes.length)}`;
      classes.push({ id, rep: h.id, members: [h.id], controller: h.controller, offset: h.offset, sockets: h.sockets.map((s) => ({ ...s })), split: null as unknown as SplitPlan, labelUp: [] });
      h.classId = id;
    }
  }
  // Class names follow node order so HA is the first hub you'd look for, not the controller.
  if (dims.labels !== 'ids') {
    const order = [...classes].sort((a, b) => (a.rep < b.rep ? -1 : 1));
    order.forEach((c, i) => {
      const id = `H${letters(i)}`;
      for (const m of c.members) hubById.get(m)!.classId = id;
      c.id = id;
    });
    classes.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /* ---- Engraving text, split plan, label orientation ---- */
  for (const c of classes) {
    for (const so of c.sockets) {
      const s = strutById.get(so.strut)!;
      so.hubLabel = dims.labels === 'none' ? '' : dims.labels === 'types' ? c.id : c.rep;
      so.strutLabel = dims.labels === 'none' ? '' : dims.labels === 'types' ? `S${s.typeId}` : s.id;
    }
    c.split = planSplit(c.sockets, dims, c.offset, c.controller);
    c.labelUp = c.sockets.map((so) => labelUp(so, c.split, dims, c.offset));
  }
  for (const h of hubs) {
    const c = classes.find((x) => x.id === h.classId)!;
    h.sockets = h.sockets.map((so) => ({ ...so, hubLabel: c.sockets[0].hubLabel, strutLabel: dims.labels === 'ids' ? so.strut : dims.labels === 'types' ? `S${strutById.get(so.strut)!.typeId}` : '' }));
  }

  /* ---- Warnings ---- */
  const req = requiredAngle(dims);
  for (const h of hubs) {
    if (h.collide && h.minPair) {
      warnings.push(
        `${h.id}: ${h.minPair[0]} and ${h.minPair[1]} meet at ${h.minAngle!.toFixed(1)}°. Ø${(dims.tubeR * 2).toFixed(0)} tubes need at least ${req.toFixed(1)}° at the ${dims.maxOffset} mm max offset, so these tubes will touch. Spread the struts, use a thinner tube, or raise the max offset.`,
      );
    }
  }
  const short = infos.filter((s) => s.tooShort);
  if (short.length) warnings.push(`${short.map((s) => s.id).join(', ')} ${short.length === 1 ? 'is' : 'are'} too short for ${short.length === 1 ? 'its' : 'their'} sockets (cut length under ${(2 * dims.insert + 6).toFixed(0)} mm). Move the hubs apart.`);
  const unlit = infos.filter((s) => !s.dark && s.px === 0 && !s.tooShort);
  if (unlit.length) warnings.push(`${unlit.map((s) => s.id).join(', ')}: too short for a single pixel at this pitch.`);
  for (const c of classes) {
    if (!c.split.supportFree) {
      warnings.push(`Hub ${c.id}: worst overhang after the split is ${c.split.overhangDeg.toFixed(0)}° (limit ${dims.overhangDeg}°). Enable supports for this hub or raise the core radius.`);
    }
    if (c.split.bolt.clearance < 0) warnings.push(`Hub ${c.id}: the M3 bolt runs close to a socket. Check the bolt path in the slicer.`);
  }
  if (dims.spine.reach > dims.tubeIR - 0.3) warnings.push(`The ${dims.pixel.name} spine does not fit inside a Ø${(dims.tubeR * 2).toFixed(0)} tube. Use a larger tube.`);
  if (dims.spine.reach > dims.coupler.boreR && types.some((t) => t.tubeSegs > 1 && !t.dark))
    warnings.push(`Split struts: the spine and pixels are wider than the coupler bore (Ø${(dims.coupler.boreR * 2).toFixed(1)}). Slide couplers on before the spine, or use a larger tube.`);
  const spineMax = (dims.spine.w / 2 + 0.2) ** 2 + Math.max(dims.spine.fBottom ** 2, dims.spine.fBarTop ** 2);
  if (Math.sqrt(spineMax) > dims.spigR - 0.8) warnings.push('The spine key slot breaks through the spigot wall. Use a larger tube.');

  return { dims, hubs, struts: infos, types, classes, centroid, requiredAngle: req, warnings };
}

/* ------------------------------------------------------------------ */
/* Split plan                                                          */
/* ------------------------------------------------------------------ */

interface Sample {
  d: Vec3;
  ts: [number, number][];
  ends: [number, number][];
}

function samplesFor(sockets: SocketInfo[], dims: SnDims, offset: number): Sample[] {
  const t0 = Math.max(0, dims.tExit - 1);
  const tip = offset + dims.insert;
  return sockets.map((s) => {
    const ts: [number, number][] = [];
    for (let i = 0; i <= 6; i++) ts.push([t0 + ((offset - t0) * i) / 6, dims.collarR]);
    for (let i = 1; i <= 4; i++) ts.push([offset + ((tip - offset) * i) / 4, dims.spigR]);
    return { d: s.dir, ts, ends: [[offset, dims.collarR], [tip, dims.spigR]] };
  });
}

/**
 * Worst overhang (as the sine of its angle from vertical) when the hub is cut on n·x = h and
 * both halves print cut-face down. For a cylinder of radius r whose axis sits z above the
 * cut, the lowest surface still present faces down by min(z/r, cos e), where e is the axis
 * elevation. Slivers on the far side of the cut are caps and never overhang.
 */
export function splitOverhang(samples: Sample[], coreR: number, n: Vec3, h: number): number {
  let w = Math.abs(h) / coreR;
  for (const s of samples) {
    const e = dot(s.d, n);
    const ce = Math.sqrt(Math.max(0, 1 - e * e));
    for (const [t, r] of s.ts) {
      const z = t * e - h;
      const q = Math.min(ce, Math.abs(z) / r);
      if (q > w) w = q;
    }
    for (const [t, r] of s.ends) {
      const z = t * e - h;
      if (e < 0 && z + r * ce > 0) w = Math.max(w, -e);
      if (e > 0 && z - r * ce < 0) w = Math.max(w, e);
    }
  }
  return w;
}

function rotateAbout(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = norm(axis);
  return norm(add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c))));
}

/** Distance from point p to the segment x0 + n·s, s ∈ [s0, s1]. */
function distToAxis(p: Vec3, x0: Vec3, n: Vec3, s0: number, s1: number): number {
  const s = Math.max(s0, Math.min(s1, dot(sub(p, x0), n)));
  return dist(p, add(x0, scale(n, s)));
}

const M3_LENGTHS = [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60];

export function planSplit(sockets: SocketInfo[], dims: SnDims, offset: number, controller: boolean): SplitPlan {
  const R = dims.coreR;
  const samples = samplesFor(sockets, dims, offset);
  const dirs = sockets.map((s) => s.dir);

  /* Plane: coarse sweep, keep the best few distinct planes, refine each, then let the bolt decide. */
  const cands: Vec3[] = sphereDirs(600).filter((v) => v[2] >= 0);
  const mean = dirs.reduce<Vec3>((s, d) => add(s, d), [0, 0, 0]);
  if (len(mean) > 1e-6) cands.push(norm(mean));
  for (let i = 0; i < dirs.length; i++) {
    cands.push(dirs[i]);
    for (let j = i + 1; j < dirs.length; j++) {
      const c = cross(dirs[i], dirs[j]);
      if (len(c) > 1e-6) cands.push(norm(c));
    }
  }
  const hs = [-0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45].map((k) => k * R);
  const cost = (n: Vec3, h: number) => splitOverhang(samples, R, n, h) + 0.002 * (Math.abs(h) / R) + 0.0005 * (1 - Math.abs(n[2]));
  const sweep: { n: Vec3; h: number; c: number }[] = [];
  for (const n of cands) for (const h of hs) sweep.push({ n, h, c: cost(n, h) });
  sweep.sort((a, b) => a.c - b.c);
  // Keep a spread of distinct planes, support-free ones first, so the bolt check has real choices.
  const limit = Math.sin((dims.overhangDeg * Math.PI) / 180) + 1e-6;
  const picked: { n: Vec3; h: number; c: number }[] = [];
  const same = (p: { n: Vec3; h: number }, s: { n: Vec3; h: number }) => {
    const c = dot(p.n, s.n);
    return Math.abs(c) > Math.cos((10 * Math.PI) / 180) && Math.abs(p.h - Math.sign(c) * s.h) < 0.25 * R;
  };
  for (const pass of [true, false]) {
    for (const s of sweep) {
      if (picked.length >= (pass ? 28 : 36)) break;
      if (pass !== s.c - 0.003 <= limit) continue;
      if (picked.some((p) => same(p, s))) continue;
      picked.push(s);
    }
  }

  const refine = (n0: Vec3, h0: number) => {
    let [bn, bh, bc] = [n0, h0, cost(n0, h0)];
    for (const step of [4, 2, 1, 0.5, 0.25]) {
      let improved = true;
      // A few moves per step size: near-ties otherwise crawl across the sphere a quarter degree at a time.
      for (let it = 0; improved && it < 8; it++) {
        improved = false;
        const p = perp(bn);
        const q = cross(bn, p);
        const tries: [Vec3, number][] = [
          [rotateAbout(bn, p, step), bh],
          [rotateAbout(bn, p, -step), bh],
          [rotateAbout(bn, q, step), bh],
          [rotateAbout(bn, q, -step), bh],
          [bn, bh + step * R * 0.0125],
          [bn, bh - step * R * 0.0125],
        ];
        for (const [n, h] of tries) {
          if (Math.abs(h) > 0.5 * R) continue;
          const c = cost(n, h);
          if (c < bc - 1e-9) {
            [bn, bh, bc] = [n, h, c];
            improved = true;
          }
        }
      }
    }
    return { n: bn, h: bh };
  };

  const tip = offset + dims.insert;
  /**
   * Bolt along n. Inside the core everything is solid, so the shank only has to miss the wire
   * bores; the head counterbore and the nut trap must not open under a collar where they
   * leave the sphere. `pt` is the bolt line's point on the cut plane, s runs along n from it.
   */
  const placeBolt = (n: Vec3, h: number) => {
    const c0 = scale(n, h);
    const p = perp(n);
    const q = cross(n, p);
    const avoid = (pt: Vec3, c: number) => {
      let clear = Infinity;
      const shank: [number, number] = [-c - h, c - h];
      const ends: [number, number][] = [
        [c - h, c - h + 6],
        [-c - h - 6, -c - h],
      ];
      for (const d of dirs) {
        for (let t = dims.cavR + 3; t <= tip; t += 1.5) {
          const a = scale(d, t);
          clear = Math.min(clear, distToAxis(a, pt, n, ...shank) - (dims.wireR + 1.7 + 0.6));
          if (t >= dims.tExit - 2) {
            const rr = t <= offset ? dims.collarR : dims.spigR;
            for (const e of ends) clear = Math.min(clear, distToAxis(a, pt, n, ...e) - (rr + 3.35 + 0.3));
          }
        }
      }
      return clear;
    };
    let bolt = { at: c0, span: 0, length: 0, counterbore: 0, clearance: -Infinity };
    let bestScore = -Infinity;
    const secR = Math.sqrt(Math.max(0, R * R - h * h));
    for (const rho of [0, 0.3, 0.45, 0.6].map((k) => k * R)) {
      if (rho > secR - 4.5) continue;
      for (let k = 0; k < (rho ? 12 : 1); k++) {
        const a = (k * Math.PI) / 6;
        const pt = add(c0, add(scale(p, rho * Math.cos(a)), scale(q, rho * Math.sin(a))));
        const c = Math.sqrt(R * R - rho * rho);
        const clear = avoid(pt, c);
        // Prefer the centre unless moving out actually buys clearance.
        const score = Math.min(clear, 2) - 0.02 * rho;
        if (score > bestScore + 1e-9) {
          bestScore = score;
          bolt = { at: pt, span: 2 * c, length: 0, counterbore: 0, clearance: clear };
        }
      }
    }
    // Head sits in a counterbore on the + half; the tip ends 1 mm short of the far face, in the nut trap.
    const G = bolt.span;
    const room = G / 2 - h - 1.5;
    let bestBad = Infinity;
    for (const L of M3_LENGTHS) {
      const cb = G - L - 1;
      const bad = Math.max(0, 3 - cb) + Math.max(0, cb - room);
      if (bad < bestBad - 1e-9 || (bad <= bestBad + 1e-9 && L > bolt.length)) {
        bestBad = bad;
        bolt.length = L;
      }
    }
    bolt.counterbore = Math.max(2.5, G - bolt.length - 1);
    return bolt;
  };

  // Support-free first, then a clear bolt path, then the smallest overhang.
  let best: { n: Vec3; h: number; w: number; bolt: ReturnType<typeof placeBolt>; key: number[] } | null = null;
  for (const s of picked) {
    const { n, h } = refine(s.n, s.h);
    const w = splitOverhang(samples, R, n, h);
    const bolt = placeBolt(n, h);
    const key = [w <= limit ? 0 : 1, bolt.clearance >= 0 ? 0 : 1, w + 0.002 * (Math.abs(h) / R)];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2] - 1e-9)))) best = { n, h, w, bolt, key };
  }
  const { n, h, w, bolt } = best!;
  const overhangDeg = (Math.asin(Math.min(1, w)) * 180) / Math.PI;
  const c0 = scale(n, h);
  const p = perp(n);
  const q = cross(n, p);
  const secR = Math.sqrt(Math.max(0, R * R - h * h));

  // Controller feed: the open direction farthest from every socket, leaning toward the floor,
  // and clear of the bolt so the cable doesn't fight the screw.
  let feed: Vec3 | null = null;
  if (controller) {
    let bestF = -Infinity;
    for (const gd of sphereDirs(240)) {
      const m = Math.min(...dirs.map((d) => angleDeg(gd, d)));
      let boltClear = Infinity;
      for (let t = 0.6 * R; t <= R + 1; t += 1.5) boltClear = Math.min(boltClear, distToAxis(scale(gd, t), bolt.at, n, -bolt.span / 2 - h, bolt.span / 2 - h) - (4 + 1.7 + 0.8));
      const sc = m - 12 * gd[2] - (boltClear < 0 ? 200 : 0);
      if (sc > bestF) {
        bestF = sc;
        feed = gd;
      }
    }
  }

  /* Pins: two dowels across the cut face, apart from each other and everything else. */
  const pinCands: { pt: Vec3; ang: number; clear: number }[] = [];
  const rMin = dims.cavR + 3.4;
  const rMax = secR - 3;
  for (const f of [0.35, 0.6, 0.85]) {
    const rho = rMin + (rMax - rMin) * f;
    if (rho < rMin || rho > rMax) continue;
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI) / 12;
      const pt = add(c0, add(scale(p, rho * Math.cos(a)), scale(q, rho * Math.sin(a))));
      let clear = Infinity;
      for (const d of dirs) for (let t = dims.cavR; t <= tip; t += 1.2) clear = Math.min(clear, distToAxis(scale(d, t), pt, n, -6.5, 6.5) - (dims.wireR + 1.6 + 0.8));
      if (feed) for (let t = dims.cavR; t <= R + 1; t += 1.2) clear = Math.min(clear, distToAxis(scale(feed, t), pt, n, -6.5, 6.5) - (4 + 1.6 + 0.8));
      const bd = len(sub(sub(pt, bolt.at), scale(n, dot(sub(pt, bolt.at), n))));
      clear = Math.min(clear, bd - (3.4 + 1.6 + 1));
      pinCands.push({ pt, ang: a, clear });
    }
  }
  pinCands.sort((x, y) => y.clear - x.clear);
  const pins: Vec3[] = [];
  if (pinCands.length) {
    const first = pinCands[0];
    pins.push(first.pt);
    const second = pinCands.find((c) => {
      const da = Math.abs(((c.ang - first.ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      return da >= (100 * Math.PI) / 180 && dist(c.pt, first.pt) >= 9;
    });
    if (second) pins.push(second.pt);
  }

  return { n, h, overhangDeg, supportFree: overhangDeg <= dims.overhangDeg + 0.05, bolt, pins, feed };
}

/** Which way the engraving on a socket's collar should face: up, in the half it prints in. */
function labelUp(so: SocketInfo, split: SplitPlan, dims: SnDims, offset: number): Vec3 {
  const tMid = offset - 1.5 - dims.labelH;
  const z = tMid * dot(so.dir, split.n) - split.h;
  const u = z >= 0 ? split.n : scale(split.n, -1);
  return perpOf(u, so.dir, 0.2) ?? so.face;
}

export { DIR_TOL, matchSockets } from '../../graph/dedupe';
