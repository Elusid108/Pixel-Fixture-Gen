import type { Vec3 } from '../../types';
import { dist, dot, norm, sub } from './model';

/**
 * The data path: one continuous chain from the controller hub. Every lit strut is run once
 * with its strip in the direction the chain travels. Getting from where the chain ends to
 * where the next strip starts costs a dark run: a wire through struts that are already lit
 * (the spine's wire channel) or through wire-only struts.
 */

export interface PathStrut {
  id: string;
  a: string;
  b: string;
  dark: boolean;
  flip: boolean;
  length: number;
}

export interface ChainStep {
  /** Null for a free jump between disconnected parts of the design. */
  strut: string | null;
  from: string;
  to: string;
  lit: boolean;
}

export interface Chain {
  steps: ChainStep[];
  /** Lit struts in data order with their DIN → DOUT ends. */
  lit: { strut: string; from: string; to: string }[];
  /** Total length of dark runs, mm (struts walked without pixels, plus free jumps). */
  darkMm: number;
  darkSteps: number;
  jumps: number;
  /** How many leading lit struts came from the user's clicked order. */
  userCount: number;
}

interface Edge {
  s: PathStrut;
  other: string;
}

export function planChain(
  struts: PathStrut[],
  controller: string,
  order: string[] = [],
  positions?: Map<string, Vec3>,
): Chain {
  const adj = new Map<string, Edge[]>();
  const byId = new Map(struts.map((s) => [s.id, s]));
  for (const s of struts) {
    for (const [n, o] of [
      [s.a, s.b],
      [s.b, s.a],
    ]) {
      if (!adj.has(n)) adj.set(n, []);
      adj.get(n)!.push({ s, other: o });
    }
  }
  for (const list of adj.values()) list.sort((x, y) => (x.s.id < y.s.id ? -1 : 1));

  const remaining = new Set(struts.filter((s) => !s.dark).map((s) => s.id));
  const steps: ChainStep[] = [];
  const lit: Chain['lit'] = [];
  let darkMm = 0;
  let darkSteps = 0;
  let jumps = 0;
  let cur = controller;
  let prevDir: Vec3 | null = null;

  /** Dijkstra over every strut (lit or dark) by length. */
  const shortest = (from: string, goal: (n: string) => boolean): { path: Edge[]; end: string } | null => {
    const D = new Map<string, number>([[from, 0]]);
    const via = new Map<string, { prev: string; e: Edge }>();
    const done = new Set<string>();
    for (;;) {
      let u: string | null = null;
      let best = Infinity;
      for (const [n, d] of D) if (!done.has(n) && d < best - 1e-9) [u, best] = [n, d];
      if (u === null) return null;
      if (goal(u)) {
        const path: Edge[] = [];
        for (let x = u; x !== from; x = via.get(x)!.prev) path.unshift(via.get(x)!.e);
        return { path, end: u };
      }
      done.add(u);
      for (const e of adj.get(u) ?? []) {
        const nd = best + e.s.length;
        if (nd < (D.get(e.other) ?? Infinity) - 1e-9) {
          D.set(e.other, nd);
          via.set(e.other, { prev: u, e });
        }
      }
    }
  };

  const darkTo = (target: (n: string) => boolean): boolean => {
    if (target(cur)) return true;
    const r = shortest(cur, target);
    if (r) {
      for (const e of r.path) {
        steps.push({ strut: e.s.id, from: cur, to: e.other, lit: false });
        darkMm += e.s.length;
        darkSteps++;
        cur = e.other;
      }
      return true;
    }
    return false;
  };

  /** Free jump when the design falls apart into pieces with no strut between them. */
  const jumpTo = (candidates: string[]) => {
    const p0 = positions?.get(cur);
    let pick = candidates[0];
    if (p0) {
      let best = Infinity;
      for (const c of candidates) {
        const d = dist(p0, positions!.get(c) ?? p0);
        if (d < best) [best, pick] = [d, c];
      }
      darkMm += best;
    }
    steps.push({ strut: null, from: cur, to: pick, lit: false });
    jumps++;
    cur = pick;
  };

  const runLit = (s: PathStrut, from: string) => {
    const to = from === s.a ? s.b : s.a;
    if (!darkTo((n) => n === from)) jumpTo([from]);
    steps.push({ strut: s.id, from, to, lit: true });
    lit.push({ strut: s.id, from, to });
    remaining.delete(s.id);
    cur = to;
    const pa = positions?.get(from);
    const pb = positions?.get(to);
    prevDir = pa && pb ? norm(sub(pb, pa)) : null;
  };

  /** Hops from cur to n, by strut length; Infinity when unreachable. */
  const hopDist = (n: string): number => {
    if (n === cur) return 0;
    const r = shortest(cur, (x) => x === n);
    return r ? r.path.reduce((s, e) => s + e.s.length, 0) : Infinity;
  };

  /* 1. The user's clicked order. */
  let userCount = 0;
  for (const id of order) {
    const s = byId.get(id);
    if (!s || s.dark || !remaining.has(id)) continue;
    const near = hopDist(s.a) <= hopDist(s.b) ? s.a : s.b;
    runLit(s, s.flip ? (near === s.a ? s.b : s.a) : near);
    userCount++;
  }

  /* 2. Greedy DFS for the rest: never burn a bridge you can avoid, keep going straight. */
  const reachableLit = (start: string, without: string): number => {
    const seen = new Set([start]);
    const stack = [start];
    let edges = 0;
    while (stack.length) {
      const u = stack.pop()!;
      for (const e of adj.get(u) ?? []) {
        if (!remaining.has(e.s.id) || e.s.id === without) continue;
        edges++;
        if (!seen.has(e.other)) {
          seen.add(e.other);
          stack.push(e.other);
        }
      }
    }
    return edges / 2;
  };

  while (remaining.size) {
    const cands = (adj.get(cur) ?? []).filter((e) => remaining.has(e.s.id));
    if (!cands.length) {
      const hasWork = (n: string) => (adj.get(n) ?? []).some((e) => remaining.has(e.s.id));
      if (!darkTo(hasWork)) {
        const pending = [...new Set([...remaining].flatMap((id) => [byId.get(id)!.a, byId.get(id)!.b]))];
        jumpTo(pending);
      }
      continue;
    }
    let pick = cands[0];
    if (cands.length > 1) {
      const total = reachableLit(cur, '');
      let best = -Infinity;
      for (const e of cands) {
        // Fleury: an edge whose removal strands part of the remaining lit graph is a bridge.
        const bridge = reachableLit(e.other, e.s.id) < total - 1 ? 1 : 0;
        const pa = positions?.get(cur);
        const pb = positions?.get(e.other);
        const straight = prevDir && pa && pb ? dot(prevDir, norm(sub(pb, pa))) : 0;
        const flipCost = e.s.flip ? 1 : 0;
        const sc = -10 * bridge - 2 * flipCost + straight;
        if (sc > best + 1e-9) [best, pick] = [sc, e];
      }
    }
    runLit(pick.s, pick.s.flip ? pick.other : cur);
  }

  return { steps, lit, darkMm, darkSteps, jumps, userCount };
}
