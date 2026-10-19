/**
 * The hanging-chain curve in one vertical plane. A span runs from x = 0 (height 0) to x = h
 * (height dv); gravity is −z. The catenary is z(x) = a·(cosh((x − x0)/a) − cosh(x0/a)),
 * where `a` is the catenary parameter (horizontal tension / weight per length) and `x0` puts
 * the vertex so the curve passes through both ends. Pure math, no allocation in hot paths.
 */

export interface Catenary {
  /** Horizontal span and height difference (end − start), mm. */
  h: number;
  dv: number;
  /** Straight chord (taut, or a vertical span): the formulas below fall back to the line. */
  straight: boolean;
  a: number;
  x0: number;
  /** Arc length start → end, mm. */
  length: number;
}

/** Vertex offset so the curve meets (h, dv). */
export function vertexX(h: number, dv: number, a: number): number {
  return h / 2 - a * Math.asinh(dv / (2 * a * Math.sinh(h / (2 * a))));
}

/** Arc length between the ends for parameter a (closed form). */
export function lengthFor(h: number, dv: number, a: number): number {
  return Math.hypot(dv, 2 * a * Math.sinh(h / (2 * a)));
}

export function heightAt(c: Catenary, x: number): number {
  if (c.straight) return c.h > 1e-9 ? (c.dv * x) / c.h : 0;
  return c.a * (Math.cosh((x - c.x0) / c.a) - Math.cosh(c.x0 / c.a));
}

/** Largest vertical gap between the chord and the curve (sag in the engineering sense). */
export function sagOf(c: Catenary): number {
  if (c.straight) return 0;
  const xs = Math.min(c.h, Math.max(0, c.x0 + c.a * Math.asinh(c.dv / c.h)));
  return (c.dv * xs) / c.h - heightAt(c, xs);
}

/** Arc length from the start to x. */
export function arcTo(c: Catenary, x: number): number {
  if (c.straight) return c.h > 1e-9 ? (x / c.h) * c.length : 0;
  return c.a * (Math.sinh((x - c.x0) / c.a) + Math.sinh(c.x0 / c.a));
}

/** Inverse of arcTo: horizontal position at arc length s. Straight spans return the fraction × h. */
export function xAtArc(c: Catenary, s: number): number {
  if (c.straight) return c.length > 1e-9 ? (s / c.length) * c.h : 0;
  return c.x0 + c.a * Math.asinh(s / c.a - Math.sinh(c.x0 / c.a));
}

/** Point along the span at arc length s, as (x, z) in the span plane. */
export function pointAtArc(c: Catenary, s: number): [number, number] {
  if (c.straight) {
    const t = c.length > 1e-9 ? s / c.length : 0;
    return [t * c.h, t * c.dv];
  }
  const x = xAtArc(c, s);
  return [x, heightAt(c, x)];
}

function straightSpan(h: number, dv: number): Catenary {
  return { h, dv, straight: true, a: Infinity, x0: h / 2, length: Math.hypot(h, dv) };
}

function make(h: number, dv: number, a: number): Catenary {
  return { h, dv, straight: false, a, x0: vertexX(h, dv, a), length: lengthFor(h, dv, a) };
}

/** Bisection over log(a) for a decreasing function f(a) → target. */
function solveA(h: number, f: (a: number) => number, target: number): number {
  let lo = Math.log(h / 600); // keeps sinh(h/2a) finite
  let hi = Math.log(h * 1e5);
  if (f(Math.exp(lo)) <= target) return Math.exp(lo);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(Math.exp(mid)) > target) lo = mid;
    else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/** Catenary through (0,0) and (h,dv) whose largest vertical sag below the chord is `sag` mm. */
export function catenaryBySag(h: number, dv: number, sag: number): Catenary {
  if (h < 1 || sag <= 1e-6) return straightSpan(h, dv);
  const a = solveA(h, (a) => sagOf(make(h, dv, a)), sag);
  return make(h, dv, a);
}

/**
 * Rigid links: walk `n` chords of exactly `pitch` along the curve from the start. Returns the
 * arc position of each joint (n + 1 values, the first 0). Past the end the analytic curve just
 * continues, which the solver below relies on.
 */
export function chordWalk(c: Catenary, n: number, pitch: number): number[] {
  const out = [0];
  let s = 0;
  let [x0, z0] = pointAtArc(c, 0);
  for (let j = 0; j < n; j++) {
    // Chord length grows monotonically with arc length on a catenary (it turns < 180°).
    let lo = s + pitch * 0.5;
    let hi = s + pitch * 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const [x, z] = pointAtArc(c, mid);
      if (Math.hypot(x - x0, z - z0) < pitch) lo = mid;
      else hi = mid;
    }
    s = (lo + hi) / 2;
    [x0, z0] = pointAtArc(c, s);
    out.push(s);
  }
  return out;
}

/**
 * The catenary on which n rigid links of `pitch` hang from (0,0) to (h,dv): its length is
 * chosen so the n-th joint lands exactly on the end. Falls back to a straight run when the
 * links can't reach (n·pitch ≤ chord) or the span is vertical.
 */
export function catenaryForLinks(h: number, dv: number, n: number, pitch: number): { c: Catenary; joints: number[] } {
  const chord = Math.hypot(h, dv);
  if (h < 1 || n * pitch <= chord * (1 + 1e-6)) {
    const c = straightSpan(h, dv);
    return { c, joints: Array.from({ length: n + 1 }, (_, j) => (j / n) * c.length) };
  }
  // g(S) = arc to the n-th joint − S: positive for S = n·pitch (chords are shorter than arcs).
  let lo = n * pitch;
  let hi = n * pitch * 1.2;
  const g = (S: number) => {
    const c = catenaryByLength(h, dv, S);
    const w = chordWalk(c, n, pitch);
    return { c, w, v: w[n] - c.length };
  };
  while (hi < n * pitch * 3 && g(hi).v > 0) hi *= 1.25;
  let best = g(lo);
  for (let i = 0; i < 40 && Math.abs(best.v) > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    const r = g(mid);
    if (r.v > 0) lo = mid;
    else hi = mid;
    best = r;
  }
  return { c: best.c, joints: best.w };
}

/** Catenary through (0,0) and (h,dv) with arc length `length` (a chain of fixed length). */
export function catenaryByLength(h: number, dv: number, length: number): Catenary {
  const chord = Math.hypot(h, dv);
  if (h < 1 || length <= chord * (1 + 1e-7)) return straightSpan(h, dv);
  const m = Math.sqrt(length * length - dv * dv);
  const a = solveA(h, (a) => 2 * a * Math.sinh(h / (2 * a)), m);
  return make(h, dv, a);
}
