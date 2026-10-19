import { basis, cross, norm } from '../../geom/vec';
import { planeXY } from '../../sketch/types';
import type { SketchPlane, Vec2 } from '../../sketch/types';
import type { Mat4, Vec3 } from '../../types';

/**
 * Small pure helpers shared by the M-series systems: plane frames, ids, rounding and a
 * serpentine order for grid fills. No React, no three.js, no manifold.
 */

export { nextId } from '../strut-node/model';

/** Round to 0.1 mm so designs stay small and diff-stable. */
export const r1 = (v: number) => Math.round(v * 10) / 10;
export const r1v = <T extends number[]>(v: T): T => v.map(r1) as T;

/** Plane → world matrix: plane x along u, plane y along v, local +Z along the plane normal. */
export function planeFrame(pl: SketchPlane): Mat4 {
  const n = norm(cross(pl.u, pl.v));
  return basis(pl.u, pl.v, n, pl.origin);
}

/** A sane plane from possibly malformed JSON (falls back to the bench floor). */
export function parsePlane(x: unknown): SketchPlane {
  const ok = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  const p = x as Partial<SketchPlane> | null;
  if (p && ok(p.origin) && ok(p.u) && ok(p.v)) return { origin: p.origin, u: p.u, v: p.v };
  return planeXY(0);
}

export const isVec2 = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
export const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * Serpentine order for cells laid out in rows: rows by `row` (ascending), alternate rows
 * reversed along `col`. Returns the input items reordered. Rows are grouped by rounding `row`
 * to `rowTol`, so float noise doesn't split a row.
 */
export function serpentine<T>(items: T[], row: (t: T) => number, col: (t: T) => number, rowTol = 1): T[] {
  const rows = new Map<number, T[]>();
  for (const it of items) {
    const k = Math.round(row(it) / rowTol);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k)!.push(it);
  }
  const keys = [...rows.keys()].sort((a, b) => a - b);
  return keys.flatMap((k, i) => {
    const r = rows.get(k)!.sort((a, b) => col(a) - col(b));
    return i % 2 ? r.reverse() : r;
  });
}

/** `n` with its unit, singular or plural: plural(3, 'tile') → "3 tiles". */
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Compact mm: 120 → "120", 120.25 → "120.3". */
export const fmt = (v: number, d = 1) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(d));
