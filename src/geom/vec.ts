import type { Mat4, Vec3 } from '../types';

/**
 * Plain-array vector kit (mm, Z-up), shared by every module and the sketch engine.
 * Pure TS with no three.js, so it runs in the worker, on the UI thread and in Node.
 */

/* ---- Small vector kit (plain arrays, mm) ---- */

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}
export const angleDeg = (a: Vec3, b: Vec3): number => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;

/** Any unit vector perpendicular to `d`, stable for a given `d`. */
export function perp(d: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return norm(sub(ref, scale(d, dot(ref, d))));
}

/** Component of `v` perpendicular to unit `d`, normalised; null when `v` is (nearly) along `d`. */
export function perpOf(v: Vec3, d: Vec3, eps = 1e-6): Vec3 | null {
  const p = sub(v, scale(d, dot(v, d)));
  return len(p) > eps ? norm(p) : null;
}

/** Column-major 4×4 from basis columns and a translation. */
export function basis(x: Vec3, y: Vec3, z: Vec3, t: Vec3 = [0, 0, 0]): Mat4 {
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, t[0], t[1], t[2], 1];
}

/** Frame with local Z along `d` and local X along `a` (a ⊥ d). For things modelled along Z. */
export const frameZ = (d: Vec3, a: Vec3, t: Vec3 = [0, 0, 0]): Mat4 => basis(a, cross(d, a), d, t);

/** Frame with local X along `d` and local Z along `f` (f ⊥ d). For things modelled lying along X. */
export const frameX = (d: Vec3, f: Vec3, t: Vec3 = [0, 0, 0]): Mat4 => basis(d, cross(f, d), f, t);

/** 3×3 rotation (row-major) as a column-major Mat4. */
export function rotMat4(r: number[][]): Mat4 {
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, 0, 0, 0, 1];
}

export function applyRot(r: number[][], v: Vec3): Vec3 {
  return [r[0][0] * v[0] + r[0][1] * v[1] + r[0][2] * v[2], r[1][0] * v[0] + r[1][1] * v[1] + r[1][2] * v[2], r[2][0] * v[0] + r[2][1] * v[1] + r[2][2] * v[2]];
}

/** Rotation taking orthonormal frame (a0, a1, a2) onto (b0, b1, b2): R = B·Aᵀ. */
export function rotBetweenFrames(a: Vec3[], b: Vec3[]): number[][] {
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += b[k][i] * a[k][j];
  return r;
}

/** Shortest rotation taking unit `a` onto unit `b`. */
export function rotFromTo(a: Vec3, b: Vec3): number[][] {
  const c = dot(a, b);
  if (c > 1 - 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-9) {
    const p = perp(a);
    // 180° about p: R = 2ppᵀ − I
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) => 2 * p[i] * p[j] - (i === j ? 1 : 0)));
  }
  const v = cross(a, b);
  const k = 1 / (1 + c);
  return [
    [c + v[0] * v[0] * k, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1]],
    [v[1] * v[0] * k + v[2], c + v[1] * v[1] * k, v[1] * v[2] * k - v[0]],
    [v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], c + v[2] * v[2] * k],
  ];
}

/** Evenly spread unit directions (Fibonacci sphere). */
export function sphereDirs(n: number): Vec3[] {
  const out: Vec3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    out.push([r * Math.cos(ga * i), r * Math.sin(ga * i), z]);
  }
  return out;
}

/** Letters for class ids: A … Z, AA, AB … */
export function letters(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
