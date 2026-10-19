import { cross, dot, len, norm, rotBetweenFrames, rotFromTo, scale, sub, applyRot } from '../geom/vec';
import type { Vec3 } from '../types';

/**
 * "Is this the same printed part, just rotated?" Shared by every system that dedupes parts
 * into print counts (hubs, truss corners, facets, orb panels).
 */

/** Direction tolerance for matching keyed directions after rotation. */
export const DIR_TOL = 1.5e-3;

/** A feature direction on a part, keyed by what plugs in there. `face` orients lit features. */
export interface KeyedDir {
  key: string;
  dir: Vec3;
  face: Vec3;
  lit: boolean;
}

function frame(a: Vec3, b: Vec3): Vec3[] {
  const y = norm(sub(b, scale(a, dot(a, b))));
  return [a, y, cross(a, y)];
}

/**
 * Finds the rotation that maps every socket of `rep` onto a socket of `cand` with the same
 * key (and the same strip face for lit sockets). Mirror images do not match: a left-handed
 * hub is a different print.
 */
export function matchSockets(rep: KeyedDir[], cand: KeyedDir[]): number[][] | null {
  if (rep.length !== cand.length || !rep.length) return null;
  const k1 = rep.map((s) => s.key).sort().join();
  const k2 = cand.map((s) => s.key).sort().join();
  if (k1 !== k2) return null;

  const verify = (R: number[][]): boolean => {
    const used = new Set<number>();
    for (const s of rep) {
      const d = applyRot(R, s.dir);
      const f = applyRot(R, s.face);
      const j = cand.findIndex((c, i) => !used.has(i) && c.key === s.key && len(sub(d, c.dir)) < DIR_TOL && (!s.lit || len(sub(f, c.face)) < DIR_TOL));
      if (j < 0) return false;
      used.add(j);
    }
    return true;
  };

  const s0 = rep[0];
  if (s0.lit) {
    const A = [s0.dir, s0.face, cross(s0.dir, s0.face)];
    for (const c of cand) {
      if (c.key !== s0.key || !c.lit) continue;
      const R = rotBetweenFrames(A, [c.dir, c.face, cross(c.dir, c.face)]);
      if (verify(R)) return R;
    }
    return null;
  }
  const k = rep.findIndex((s, i) => i > 0 && Math.abs(dot(s.dir, s0.dir)) < 0.999);
  if (k < 0) {
    for (const c of cand) {
      if (c.key !== s0.key) continue;
      const R = rotFromTo(s0.dir, c.dir);
      if (verify(R)) return R;
    }
    return null;
  }
  const ang = dot(s0.dir, rep[k].dir);
  const A = frame(s0.dir, rep[k].dir);
  for (const c of cand) {
    if (c.key !== s0.key) continue;
    for (const c2 of cand) {
      if (c2 === c || c2.key !== rep[k].key || Math.abs(dot(c.dir, c2.dir) - ang) > 2e-3) continue;
      const R = rotBetweenFrames(A, frame(c.dir, c2.dir));
      if (verify(R)) return R;
    }
  }
  return null;
}


/**
 * 1-D clustering: items whose value is within `tol` of the first in a run share one class.
 * Sorted by value; returns groups in ascending order. Used for cut lengths, arc spans, etc.
 */
export function cluster1D<T>(items: T[], value: (t: T) => number, tol: number): T[][] {
  const sorted = [...items].sort((x, y) => value(x) - value(y));
  const groups: T[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && value(it) - value(g[0]) <= tol) g.push(it);
    else groups.push([it]);
  }
  return groups;
}
