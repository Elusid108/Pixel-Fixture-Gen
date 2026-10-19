import { add, dist, dot, len, scale, sub } from '../../geom/vec';
import type { Vec3 } from '../../types';
import type { LineaDesign } from './model';

/**
 * Bar graph of a design, independent of params: nodes where runs bend, end, meet or cross,
 * and edges (bars between joints). A vertex landing on another run's segment splits it (T);
 * two segments crossing make a node on both (X); vertices on vertices merge.
 */

/** Geometric tolerance for "the same point" and "on that segment", mm. */
export const TOPO_TOL = 1;

export interface TNode {
  id: string;
  pos: Vec3;
  /** Run vertices sitting on this node. Empty for a crossing. */
  verts: { run: string; i: number }[];
}

export interface TEdge {
  /** `R01-2`: the second bar between joints along run R01. */
  id: string;
  run: string;
  /** Run segment index (pts[seg] → pts[seg + 1]). */
  seg: number;
  a: string;
  b: string;
}

export interface Topology {
  nodes: TNode[];
  edges: TEdge[];
}

interface Seg {
  run: string;
  seg: number;
  A: Vec3;
  B: Vec3;
  a: string;
  b: string;
}

/** Closest points between segments PQ and RS: parameters s, t in [0, 1] and the distance. */
export function segClosest(P: Vec3, Q: Vec3, R: Vec3, S: Vec3): { s: number; t: number; d: number } {
  const d1 = sub(Q, P);
  const d2 = sub(S, R);
  const r = sub(P, R);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a < 1e-12 && e < 1e-12) return { s, t, d: dist(P, R) };
  if (a < 1e-12) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = dot(d1, r);
    if (e < 1e-12) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const p1 = add(P, scale(d1, s));
  const p2 = add(R, scale(d2, t));
  return { s, t, d: dist(p1, p2) };
}

/** Distance from p to segment AB and the position along it (mm from A). */
export function onSegment(p: Vec3, A: Vec3, B: Vec3): { d: number; at: number; L: number } {
  const ab = sub(B, A);
  const L = len(ab);
  if (L < 1e-9) return { d: dist(p, A), at: 0, L };
  const at = dot(sub(p, A), ab) / L;
  const c = Math.max(0, Math.min(L, at));
  return { d: dist(p, add(A, scale(ab, c / L))), at, L };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function topology(design: LineaDesign, tol = TOPO_TOL): Topology {
  const nodes: TNode[] = [];
  const nodeAt = (p: Vec3): TNode => {
    const hit = nodes.find((n) => dist(n.pos, p) <= tol);
    if (hit) return hit;
    const n: TNode = { id: `J${pad(nodes.length + 1)}`, pos: p, verts: [] };
    nodes.push(n);
    return n;
  };

  /* 1. Vertices. */
  const vNode = new Map<string, string>();
  for (const r of design.runs) {
    r.pts.forEach((p, i) => {
      const n = nodeAt(p);
      n.verts.push({ run: r.id, i });
      vNode.set(`${r.id}:${i}`, n.id);
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = (id: string) => byId.get(id)!.pos;

  /* 2. Segments between vertex nodes. */
  const segs: Seg[] = [];
  for (const r of design.runs) {
    const n = r.closed ? r.pts.length : r.pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = vNode.get(`${r.id}:${i}`)!;
      const b = vNode.get(`${r.id}:${(i + 1) % r.pts.length}`)!;
      if (a === b) continue;
      segs.push({ run: r.id, seg: i, a, b, A: pos(a), B: pos(b) });
    }
  }

  /* 3. Crossings: interior points of two segments that meet make a node on both. */
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
      const c = segClosest(s.A, s.B, t.A, t.B);
      if (c.d > tol) continue;
      const Ls = dist(s.A, s.B);
      const Lt = dist(t.A, t.B);
      const inS = c.s * Ls > tol && (1 - c.s) * Ls > tol;
      const inT = c.t * Lt > tol && (1 - c.t) * Lt > tol;
      if (!inS && !inT) continue;
      // A vertex of one landing on the other is handled in step 4; only make true crossings here.
      if (!inS || !inT) continue;
      const p = scale(add(add(s.A, scale(sub(s.B, s.A), c.s)), add(t.A, scale(sub(t.B, t.A), c.t))), 0.5);
      const n = nodeAt(p);
      byId.set(n.id, n);
    }
  }

  /* 4. Split every segment at the nodes lying on its interior. */
  const edges: TEdge[] = [];
  const seen = new Set<string>();
  const count = new Map<string, number>();
  for (const s of segs) {
    const L = dist(s.A, s.B);
    const on: { id: string; at: number }[] = [];
    for (const n of nodes) {
      if (n.id === s.a || n.id === s.b) continue;
      const o = onSegment(n.pos, s.A, s.B);
      if (o.d <= tol && o.at > tol && o.at < L - tol) on.push({ id: n.id, at: o.at });
    }
    on.sort((x, y) => x.at - y.at);
    const chain = [s.a, ...on.map((o) => o.id), s.b];
    for (let k = 0; k < chain.length - 1; k++) {
      const a = chain[k];
      const b = chain[k + 1];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (a === b || seen.has(key)) continue;
      seen.add(key);
      const nth = (count.get(s.run) ?? 0) + 1;
      count.set(s.run, nth);
      edges.push({ id: `${s.run}-${nth}`, run: s.run, seg: s.seg, a, b });
    }
  }

  // Drop nodes nothing touches (a lone vertex of a degenerate run).
  const used = new Set(edges.flatMap((e) => [e.a, e.b]));
  return { nodes: nodes.filter((n) => used.has(n.id)), edges };
}
