import { planChain, type Chain } from '../../graph/dataPath';
import { add, cross, dist, dot, norm, perp, perpOf, scale, sub } from '../../geom/vec';
import type { Params, Vec3 } from '../../types';
import { letters } from '../../geom/vec';
import { angleBetween } from './lock';
import { feedRun, type LineaDesign } from './model';
import { CATALOGUE_DEG, jointArm, linDims, type LinDims } from './params';
import { topology, type Topology } from './topology';

/**
 * Everything the bench, the inspector and the build share, derived from design + params:
 * joints with their arm lengths, bars between joints split into catalogue straights, joint
 * classes for dedupe, key seams, clip positions, the data chain and warnings. Pure.
 */

export type JointKind = 'end' | 'join' | 'corner' | 'tee' | 'cross' | 'hub';

export interface PArm {
  edge: string;
  /** Unit direction along the bar, away from the joint. */
  dir: Vec3;
  face: Vec3;
  /** Arm length of the joint piece toward this bar (0 at a plain join). */
  len: number;
}

export interface PNode {
  id: string;
  pos: Vec3;
  kind: JointKind;
  arms: PArm[];
  runs: string[];
  /** Corners: the exact angle between the two bars, degrees. */
  angle: number | null;
  /** Corners: the nearest catalogue angle. */
  nearest: number | null;
  /** Angles between neighbouring arms going round the face normal (planar joints), degrees. */
  gaps: number[];
  planar: boolean;
  face: Vec3;
  /** Takes up the leftover of its bars (T, X, joints between runs). */
  flexible: boolean;
  feed: boolean;
  /** Joint piece class id (empty when there is no piece: a plain join). */
  classId: string;
  /** Planar joints: index into `order` of the arm the class frame's +X follows. */
  rot: number;
  /** Arms sorted counter-clockwise about the face (planar), indices into `arms`. */
  order: number[];
}

export interface PEdge {
  id: string;
  run: string;
  seg: number;
  a: string;
  b: string;
  A: Vec3;
  B: Vec3;
  dir: Vec3;
  face: Vec3;
  /** Joint to joint. */
  length: number;
  armA: number;
  armB: number;
  /** Pixels (= pitches) on this bar. */
  k: number;
  /** Straight piece counts from A to B, in pixels. */
  straights: number[];
  tooShort: boolean;
}

export interface JointClass {
  id: string;
  kind: JointKind;
  label: string;
  members: string[];
  rep: string;
}

export interface Seam {
  pos: Vec3;
  dir: Vec3;
  face: Vec3;
}

export interface LineaStats {
  px: number;
  stripMm: number;
  straights: { count: number; mm: number; n: number }[];
  corners: { angle: number; nearest: number; n: number }[];
  tees: number;
  crosses: number;
  hubs: number;
  ends: number;
  joins: number;
  pieces: number;
}

export interface LineaPlan {
  D: LinDims;
  topo: Topology;
  nodes: PNode[];
  edges: PEdge[];
  chain: Chain;
  feedNode: string;
  classes: JointClass[];
  seams: Seam[];
  clips: Seam[];
  stats: LineaStats;
  warnings: string[];
}

const EPS = 1e-6;

/** Nearest catalogue corner angle. */
export function nearestCatalogue(angle: number): number {
  return CATALOGUE_DEG.reduce((best, a) => (Math.abs(a - angle) < Math.abs(best - angle) ? a : best), CATALOGUE_DEG[0]);
}

/**
 * Split a span of k pixels into catalogue straights: the fewest pieces, then no remainder,
 * then a remainder that is itself a catalogue length, then the most even split.
 */
export function splitSpan(k: number, counts: number[]): number[] {
  if (k <= 0) return [];
  let best: { pieces: number[]; score: number[] } | null = null;
  for (const c of counts) {
    const q = Math.floor(k / c);
    const rem = k - q * c;
    const pieces = [...Array(q).fill(c), ...(rem ? [rem] : [])];
    if (!pieces.length) continue;
    const score = [pieces.length, rem ? 1 : 0, rem && !counts.includes(rem) ? 1 : 0, -Math.min(...pieces), -c];
    if (!best || lexLess(score, best.score)) best = { pieces, score };
  }
  return best ? best.pieces : [k];
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** In-plane angle of `d` in the frame (x, y), degrees in [0, 360). */
function polar(d: Vec3, x: Vec3, y: Vec3): number {
  const a = (Math.atan2(dot(d, y), dot(d, x)) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

const KIND_LABEL: Record<JointKind, string> = { end: 'End cap', join: 'Join', corner: 'Corner', tee: 'T joint', cross: 'X joint', hub: 'Hub joint' };

export function jointLabel(n: Pick<PNode, 'kind' | 'angle' | 'gaps' | 'feed'>): string {
  const deg = (v: number) => `${Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)}°`;
  if (n.kind === 'end') return n.feed ? 'End cap · feed' : 'End cap';
  if (n.kind === 'corner' && n.angle !== null) return `Corner ${deg(n.angle)}`;
  if (n.kind === 'join') return 'Join';
  if (n.gaps.length) return `${KIND_LABEL[n.kind]} ${n.gaps.map(deg).join('/')}`;
  return KIND_LABEL[n.kind];
}

export function planLinea(design: LineaDesign, params: Params): LineaPlan {
  const D = linDims(params);
  const topo = topology(design);
  const runFace = new Map(design.runs.map((r) => [r.id, r.face]));
  const nodePos = new Map(topo.nodes.map((n) => [n.id, n.pos]));
  const warnings: string[] = [];

  /* Edges: geometry first, arms later. */
  const raw = topo.edges.map((e) => {
    const A = nodePos.get(e.a)!;
    const B = nodePos.get(e.b)!;
    const dir = norm(sub(B, A));
    const f0 = norm(runFace.get(e.run) ?? [0, 0, 1]);
    const face = perpOf(f0, dir) ?? perp(dir);
    return { ...e, A, B, dir, face, length: dist(A, B) };
  });

  /* Nodes: arms, kind, base arm length. */
  const incident = new Map<string, { edge: string; dir: Vec3; face: Vec3; run: string }[]>();
  for (const e of raw) {
    for (const [n, dir] of [
      [e.a, e.dir],
      [e.b, scale(e.dir, -1)],
    ] as [string, Vec3][]) {
      if (!incident.has(n)) incident.set(n, []);
      incident.get(n)!.push({ edge: e.id, dir, face: e.face, run: e.run });
    }
  }
  const fr = feedRun(design);
  const feedNode = fr ? (topo.nodes.find((n) => n.verts.some((v) => v.run === fr.id && v.i === 0))?.id ?? '') : '';

  const base = new Map<string, number>();
  const nodes: PNode[] = topo.nodes.map((tn) => {
    const inc = incident.get(tn.id) ?? [];
    const deg = inc.length;
    let minAngle = 180;
    for (let i = 0; i < deg; i++) for (let j = i + 1; j < deg; j++) minAngle = Math.min(minAngle, angleBetween(inc[i].dir, inc[j].dir));
    const kind: JointKind = deg <= 1 ? 'end' : deg === 2 ? (minAngle >= 179 ? 'join' : 'corner') : deg === 3 ? 'tee' : deg === 4 ? 'cross' : 'hub';
    const face = inc[0]?.face ?? [0, 0, 1];
    const planar = inc.every((a) => dot(a.face, face) > 0.999 && Math.abs(dot(a.dir, face)) < 0.02);
    const runs = [...new Set(inc.map((a) => a.run))];
    const angle = kind === 'corner' || kind === 'join' ? minAngle : null;
    base.set(tn.id, deg <= 1 ? D.endArm : jointArm(D, minAngle));
    // Gaps round the face normal, for labels and class matching.
    let order = inc.map((_, i) => i);
    let gaps: number[] = [];
    if (planar && deg >= 2) {
      const x = inc[0].dir;
      const y = cross(face, x);
      const th = inc.map((a) => polar(a.dir, x, y));
      order = order.sort((i, j) => th[i] - th[j]);
      gaps = order.map((i, k) => {
        const next = order[(k + 1) % order.length];
        let g = th[next] - th[i];
        if (k === order.length - 1) g += 360;
        return g;
      });
    }
    return {
      id: tn.id,
      pos: tn.pos,
      kind,
      arms: inc.map((a) => ({ edge: a.edge, dir: a.dir, face: a.face, len: 0 })),
      runs,
      angle,
      nearest: kind === 'corner' && angle !== null ? nearestCatalogue(angle) : null,
      gaps,
      planar,
      face,
      flexible: deg >= 3 || runs.length > 1 || tn.verts.length === 0,
      feed: tn.id === feedNode,
      classId: '',
      rot: 0,
      order,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  /* Edges: pitch-locked span, remainder to the flexible end(s), straights. */
  const edges: PEdge[] = raw.map((e) => {
    const na = nodeById.get(e.a)!;
    const nb = nodeById.get(e.b)!;
    const ba = base.get(e.a)!;
    const bb = base.get(e.b)!;
    const span = e.length - ba - bb;
    let k = Math.floor(span / D.pitch + EPS);
    let armA = ba;
    let armB = bb;
    let tooShort = false;
    if (k < 1) {
      k = 0;
      if (span < -EPS) {
        tooShort = true;
        const s = ba + bb > 0 ? e.length / (ba + bb) : 0.5;
        armA = ba * s;
        armB = bb * s;
      } else {
        tooShort = true;
        armA += span / 2;
        armB += span / 2;
      }
    } else {
      let r = span - k * D.pitch;
      if (r < EPS) r = 0;
      const fa = na.flexible && na.kind !== 'end';
      const fb = nb.flexible && nb.kind !== 'end';
      if (fa && !fb) armA += r;
      else if (fb && !fa) armB += r;
      else {
        armA += r / 2;
        armB += r / 2;
      }
    }
    return {
      id: e.id,
      run: e.run,
      seg: e.seg,
      a: e.a,
      b: e.b,
      A: e.A,
      B: e.B,
      dir: e.dir,
      face: e.face,
      length: e.length,
      armA,
      armB,
      k,
      straights: splitSpan(k, D.counts),
      tooShort,
    };
  });
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (const n of nodes) {
    for (const arm of n.arms) {
      const e = edgeById.get(arm.edge)!;
      arm.len = e.a === n.id ? e.armA : e.armB;
    }
  }

  /* Joint classes: same kind, same arm lengths and gaps (cyclically) print as one part. */
  const classes: JointClass[] = [];
  const byKey = new Map<string, JointClass>();
  for (const n of nodes) {
    if (n.arms.every((a) => a.len < 0.01)) continue;
    let key: string;
    if (n.planar) {
      const seq = n.order.map((i, k) => `${n.arms[i].len.toFixed(2)}@${(n.gaps[k] ?? 360).toFixed(2)}`);
      let bestRot = 0;
      let bestStr = '';
      for (let r = 0; r < seq.length; r++) {
        const s = [...seq.slice(r), ...seq.slice(0, r)].join(',');
        if (!bestStr || s < bestStr) [bestStr, bestRot] = [s, r];
      }
      n.rot = bestRot;
      key = `${n.kind}|${n.feed ? 'feed' : ''}|${bestStr}`;
    } else key = `solo|${n.id}`;
    let c = byKey.get(key);
    if (!c) {
      c = { id: letters(classes.length), kind: n.kind, label: jointLabel(n), members: [], rep: n.id };
      byKey.set(key, c);
      classes.push(c);
    }
    c.members.push(n.id);
    n.classId = c.id;
  }

  /* Data chain over bars. */
  const chain = planChain(
    edges.map((e) => ({ id: e.id, a: e.a, b: e.b, dark: e.k === 0, flip: false, length: e.length })),
    feedNode,
    [],
    nodePos,
  );

  /* Key seams and clips. */
  const seams: Seam[] = [];
  const clips: Seam[] = [];
  for (const e of edges) {
    if (!e.k) continue;
    let s = e.armA;
    const at = (x: number) => add(e.A, scale(e.dir, x));
    const pushSeam = (x: number) => {
      const p = at(x);
      if (!seams.some((q) => dist(q.pos, p) < 0.5)) seams.push({ pos: p, dir: e.dir, face: e.face });
    };
    pushSeam(s);
    for (const c of e.straights) {
      s += c * D.pitch;
      pushSeam(s);
    }
    if (D.mount !== 'none') {
      const span = e.k * D.pitch;
      const m = Math.max(1, Math.round(span / D.clipEvery));
      for (let j = 0; j < m; j++) clips.push({ pos: at(e.armA + (span * (j + 0.5)) / m), dir: e.dir, face: e.face });
    }
  }

  /* Stats. */
  const sc = new Map<number, number>();
  for (const e of edges) for (const c of e.straights) sc.set(c, (sc.get(c) ?? 0) + 1);
  const cc = new Map<string, { angle: number; nearest: number; n: number }>();
  for (const n of nodes) {
    if (n.kind !== 'corner' || n.angle === null) continue;
    const k = n.angle.toFixed(1);
    const hit = cc.get(k);
    if (hit) hit.n++;
    else cc.set(k, { angle: n.angle, nearest: n.nearest!, n: 1 });
  }
  const px = edges.reduce((s, e) => s + e.k, 0);
  const count = (k: JointKind) => nodes.filter((n) => n.kind === k).length;
  const stats: LineaStats = {
    px,
    stripMm: px * D.pitch,
    straights: [...sc.entries()].sort((a, b) => b[0] - a[0]).map(([c, n]) => ({ count: c, mm: c * D.pitch, n })),
    corners: [...cc.values()].sort((a, b) => a.angle - b.angle),
    tees: count('tee'),
    crosses: count('cross'),
    hubs: count('hub'),
    ends: count('end'),
    joins: count('join'),
    pieces: [...sc.values()].reduce((s, n) => s + n, 0) + nodes.filter((n) => n.classId).length,
  };

  /* Warnings. */
  for (const e of edges) {
    if (e.tooShort) {
      const need = (base.get(e.a)! + base.get(e.b)! + D.pitch).toFixed(0);
      warnings.push(`Bar ${e.id} (${e.a}–${e.b}) is too short for its joints and stays dark. It needs at least ${need} mm.`);
    }
  }
  for (const n of nodes) {
    if (!n.planar && n.arms.length > 1) warnings.push(`${n.id} joins bars from different planes. Its joint prints with supports and has no lid.`);
    if (n.kind === 'hub') warnings.push(`${n.id} joins ${n.arms.length} bars. It is built as one hub joint; check the arms clear each other.`);
    const minGap = n.gaps.length ? Math.min(...n.gaps) : 180;
    if (n.arms.length > 1 && minGap < 20) warnings.push(`${n.id} has a very sharp ${minGap.toFixed(0)}° angle, so its arms are ${Math.max(...n.arms.map((a) => a.len)).toFixed(0)} mm long.`);
  }
  if (chain.jumps) warnings.push(`The design is in ${chain.jumps + 1} separate pieces. The data path jumps between them on a free wire.`);
  const amps = (px * D.pixel.wattsPerPx) / D.pixel.volts;
  if (amps > 6) warnings.push(`Full white draws ${amps.toFixed(1)} A at ${D.pixel.volts} V. Inject power along the run (see Data & power).`);

  return { D, topo, nodes, edges, chain, feedNode, classes, seams, clips, stats, warnings };
}

/** Pixel points along a bar in data order (from `from`), where the light reads. */
export function edgePixels(plan: LineaPlan, e: PEdge, from: string): Vec3[] {
  const { D } = plan;
  const lift = scale(e.face, D.topZ);
  const pts = Array.from({ length: e.k }, (_, i) => add(add(e.A, scale(e.dir, e.armA + (i + 0.5) * D.pitch)), lift));
  return from === e.a ? pts : pts.reverse();
}

/** Straight pieces of a bar as (start offset from A, count). */
export function straightOffsets(plan: LineaPlan, e: PEdge): { at: number; count: number }[] {
  let s = e.armA;
  return e.straights.map((c) => {
    const at = s;
    s += c * plan.D.pitch;
    return { at, count: c };
  });
}
