import { add, cross, dot, norm, scale, sub } from '../geom/vec';
import type { Vec3 } from '../types';
import { fromPlane, planeNormal } from './geom';
import type { Sketch, SketchPath, SketchPlane, SketchRegion, Vec2 } from './types';

/**
 * Whole-entity operations: mirror, linear and polar arrays, and conversions between paths and
 * regions. Pure, so they're unit-tested and shared by the panel and any future scripting.
 */

export type Entity = { kind: 'path'; e: SketchPath } | { kind: 'region'; e: SketchRegion };

export const entities = (s: Sketch): Entity[] => [
  ...s.paths.map((e) => ({ kind: 'path' as const, e })),
  ...s.regions.map((e) => ({ kind: 'region' as const, e })),
];

/** All 3D points of an entity (region loops lifted off their plane). */
export function entityPoints(en: Entity): Vec3[] {
  if (en.kind === 'path') return en.e.pts;
  const pl = en.e.plane;
  return [...en.e.outer, ...en.e.holes.flat()].map((p) => fromPlane(p, pl));
}

export function centroid(pts: Vec3[]): Vec3 {
  if (!pts.length) return [0, 0, 0];
  return scale(pts.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
}

/* ---- Affine maps on points, directions and planes ---- */

export interface Affine {
  point(p: Vec3): Vec3;
  dir(d: Vec3): Vec3;
  /** True when the map flips handedness (mirrors). */
  flips: boolean;
}

export function mirrorMap(origin: Vec3, normal: Vec3): Affine {
  const n = norm(normal);
  const reflect = (v: Vec3) => sub(v, scale(n, 2 * dot(v, n)));
  return { point: (p) => add(origin, reflect(sub(p, origin))), dir: reflect, flips: true };
}

export function translateMap(t: Vec3): Affine {
  return { point: (p) => add(p, t), dir: (d) => d, flips: false };
}

/** Rotation by `deg` about `axis` through `origin` (Rodrigues). */
export function rotateMap(origin: Vec3, axis: Vec3, deg: number): Affine {
  const k = norm(axis);
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const rot = (v: Vec3): Vec3 => add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
  return { point: (p) => add(origin, rot(sub(p, origin))), dir: rot, flips: false };
}

function mapPlane(pl: SketchPlane, m: Affine): SketchPlane {
  return { origin: m.point(pl.origin), u: m.dir(pl.u), v: m.dir(pl.v) };
}

/** Apply a map. Mirrored regions keep valid winding by flipping the plane's v axis and y coords. */
export function mapEntity(en: Entity, m: Affine, id: string): Entity {
  if (en.kind === 'path') {
    const p = en.e;
    return { kind: 'path', e: { ...p, id, pts: p.pts.map(m.point), plane: p.plane ? mapPlane(p.plane, m) : undefined } };
  }
  const r = en.e;
  let plane = mapPlane(r.plane, m);
  let flipY = (q: Vec2[]) => q;
  if (m.flips) {
    plane = { ...plane, v: scale(plane.v, -1) };
    flipY = (q) => q.map(([x, y]) => [x, -y] as Vec2).reverse();
  }
  return { kind: 'region', e: { ...r, id, plane, outer: flipY(r.outer), holes: r.holes.map(flipY) } };
}

/* ---- Arrays ---- */

export function linearArray(en: Entity, count: number, step: Vec3, nextId: () => string): Entity[] {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => mapEntity(en, translateMap(scale(step, i + 1)), nextId()));
}

/** `count` copies in total (including the original) spread over `totalDeg`, about `axis` through `origin`. */
export function polarArray(en: Entity, count: number, origin: Vec3, axis: Vec3, totalDeg: number, nextId: () => string): Entity[] {
  const full = Math.abs(Math.abs(totalDeg) - 360) < 1e-6;
  const step = totalDeg / (full ? count : Math.max(1, count - 1));
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => mapEntity(en, rotateMap(origin, axis, step * (i + 1)), nextId()));
}

/* ---- Conversions for adapters ---- */

/** A region's loops as closed paths on its plane (outline systems like bars and truss). */
export function regionToPaths(r: SketchRegion, nextId: () => string): SketchPath[] {
  return [r.outer, ...r.holes].map((loop) => ({ id: nextId(), pts: loop.map((p) => fromPlane(p, r.plane)), closed: true, plane: r.plane, source: r.source }));
}

/** Whether every point of a path lies on its plane (within `tol` mm). */
export function isPlanar(p: SketchPath, tol = 0.05): boolean {
  if (!p.plane) return false;
  const n = planeNormal(p.plane);
  return p.pts.every((q) => Math.abs(dot(sub(q, p.plane!.origin), n)) <= tol);
}

/** Next free id for a prefix ("P", "R"): P1, P2 … */
export function idMaker(prefix: string, taken: Iterable<string>): () => string {
  let max = 0;
  for (const id of taken) {
    const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return () => `${prefix}${++max}`;
}
