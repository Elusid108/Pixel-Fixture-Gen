import { dist } from '../geom/vec';
import type { Vec3 } from '../types';
import { arc3, ccw, circlePts, dedupeConsecutive, fromPlane, regularPolygon, simplify, toPlane } from './geom';
import { isPlanar } from './ops';
import type { SketchPath, SketchPlane, SketchRegion, Vec2 } from './types';

/**
 * Tool clicks → entities. Pure: the canvas layer gathers points and calls these, and the
 * tests drive them directly.
 */

type Out = { paths: SketchPath[]; regions: SketchRegion[] };
const none = (): Out => ({ paths: [], regions: [] });

/**
 * A polyline the user clicked out. A closed loop on one plane becomes a region; one that changed
 * plane (X/Y/Z mid-draw) stays a closed 3D path. Open polylines are paths, keeping their plane
 * only if every point is on it.
 */
export function finishPolyline(pts: Vec3[], plane: SketchPlane, closed: boolean, id: { path: () => string; region: () => string }): Out {
  const clean = dedupeConsecutive(closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 0.05 ? pts.slice(0, -1) : pts);
  if (clean.length < 2) return none();
  const probe: SketchPath = { id: '', pts: clean, closed, plane };
  const flat = isPlanar(probe);
  if (closed && clean.length >= 3 && flat) {
    return { paths: [], regions: [{ id: id.region(), outer: ccw(clean.map((p) => toPlane(p, plane))), holes: [], plane, source: 'draw' }] };
  }
  return { paths: [{ id: id.path(), pts: clean, closed: closed && clean.length >= 3, plane: flat ? plane : undefined, source: flat ? 'draw' : '3d' }], regions: [] };
}

const region = (loop: Vec2[], plane: SketchPlane, id: () => string): Out => ({
  paths: [],
  regions: [{ id: id(), outer: ccw(loop), holes: [], plane, source: 'draw' }],
});

export function rectRegion(a: Vec3, b: Vec3, plane: SketchPlane, id: () => string): Out {
  const [x0, y0] = toPlane(a, plane);
  const [x1, y1] = toPlane(b, plane);
  if (Math.abs(x1 - x0) < 0.5 || Math.abs(y1 - y0) < 0.5) return none();
  return region(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    plane,
    id,
  );
}

export function circleRegion(c: Vec3, edge: Vec3, plane: SketchPlane, id: () => string): Out {
  const cc = toPlane(c, plane);
  const e = toPlane(edge, plane);
  const r = Math.hypot(e[0] - cc[0], e[1] - cc[1]);
  return r < 0.5 ? none() : region(circlePts(cc, r), plane, id);
}

/** Regular polygon with a vertex pointing at the cursor. */
export function polygonRegion(c: Vec3, edge: Vec3, sides: number, plane: SketchPlane, id: () => string): Out {
  const cc = toPlane(c, plane);
  const e = toPlane(edge, plane);
  const r = Math.hypot(e[0] - cc[0], e[1] - cc[1]);
  const rot = (Math.atan2(e[1] - cc[1], e[0] - cc[0]) * 180) / Math.PI;
  return r < 0.5 ? none() : region(regularPolygon(cc, r, Math.max(3, Math.round(sides)), rot), plane, id);
}

/** Three-point arc: start, end, then a point it passes through. */
export function arcPath(a: Vec3, b: Vec3, through: Vec3, plane: SketchPlane, id: () => string): Out {
  const pts = arc3(toPlane(a, plane), toPlane(through, plane), toPlane(b, plane)).map((p) => fromPlane(p, plane));
  return pts.length < 2 ? none() : { paths: [{ id: id(), pts, closed: false, plane, source: 'draw' }], regions: [] };
}

/** Freehand stroke: simplified; a stroke that ends where it began becomes a region. */
export function freehand(raw: Vec3[], plane: SketchPlane, id: { path: () => string; region: () => string }, eps = 0.8): Out {
  const pts = simplify(dedupeConsecutive(raw, 0.5), eps);
  if (pts.length < 2) return none();
  const span = Math.max(...pts.map((p) => dist(p, pts[0])));
  if (pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) < Math.max(6, span * 0.08)) return finishPolyline(pts, plane, true, id);
  return { paths: [{ id: id.path(), pts, closed: false, plane, source: 'draw' }], regions: [] };
}
