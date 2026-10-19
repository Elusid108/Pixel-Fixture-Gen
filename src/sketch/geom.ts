import { add, cross, dist, dot, norm, scale, sub } from '../geom/vec';
import type { Vec3 } from '../types';
import type { SketchPlane, Vec2 } from './types';

/**
 * Pure sketch geometry: no three.js and no manifold, so systems can lay out designs on the
 * UI thread and in tests. Exact clipping (partial tiles etc.) happens in the worker build
 * with CrossSection booleans.
 */

/* ---- Plane mapping ---- */

export function toPlane(p: Vec3, pl: SketchPlane): Vec2 {
  const d = sub(p, pl.origin);
  return [dot(d, pl.u), dot(d, pl.v)];
}

export function fromPlane(p: Vec2, pl: SketchPlane): Vec3 {
  return add(pl.origin, add(scale(pl.u, p[0]), scale(pl.v, p[1])));
}

export const planeNormal = (pl: SketchPlane): Vec3 => norm(cross(pl.u, pl.v));

/** Plane through three points (u along a→b). Null when they are (nearly) collinear. */
export function planeFrom3(a: Vec3, b: Vec3, c: Vec3): SketchPlane | null {
  const u = sub(b, a);
  const n = cross(u, sub(c, a));
  if (Math.hypot(...n) < 1e-6 || Math.hypot(...u) < 1e-6) return null;
  const un = norm(u);
  return { origin: a, u: un, v: norm(cross(norm(n), un)) };
}

/* ---- Polylines ---- */

export interface Segment {
  a: Vec3;
  b: Vec3;
  length: number;
  dir: Vec3;
}

export function segments(pts: Vec3[], closed: boolean): Segment[] {
  const out: Segment[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const length = dist(a, b);
    if (length > 1e-9) out.push({ a, b, length, dir: norm(sub(b, a)) });
  }
  return out;
}

export const polylineLength = (pts: Vec3[], closed = false): number => segments(pts, closed).reduce((s, g) => s + g.length, 0);

/** Points every `pitch` mm along the polyline, starting `offset` mm in. */
export function resample(pts: Vec3[], pitch: number, closed = false, offset = 0): Vec3[] {
  const out: Vec3[] = [];
  if (pitch <= 0) return out;
  let t = offset;
  let walked = 0;
  for (const s of segments(pts, closed)) {
    while (t <= walked + s.length + 1e-9) {
      out.push(add(s.a, scale(s.dir, t - walked)));
      t += pitch;
    }
    walked += s.length;
  }
  return out;
}

/**
 * Turning angle at each interior vertex in degrees: 0 is straight on, positive turns left
 * (counter-clockwise about `normal`). Closed paths report every vertex.
 */
export function cornerAngles(pts: Vec3[], closed: boolean, normal: Vec3 = [0, 0, 1]): { index: number; deg: number }[] {
  const out: { index: number; deg: number }[] = [];
  const n = pts.length;
  const start = closed ? 0 : 1;
  const end = closed ? n : n - 1;
  for (let i = start; i < end; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d0 = norm(sub(p1, p0));
    const d1 = norm(sub(p2, p1));
    const s = dot(cross(d0, d1), normal);
    out.push({ index: i, deg: (Math.atan2(s, dot(d0, d1)) * 180) / Math.PI });
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification (keeps endpoints). */
export function simplify(pts: Vec3[], eps: number): Vec3[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0];
  const b = pts[pts.length - 1];
  const ab = sub(b, a);
  const L = Math.hypot(...ab);
  let worst = -1;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ap = sub(pts[i], a);
    const d = L < 1e-9 ? Math.hypot(...ap) : Math.hypot(...cross(ab, ap)) / L;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= eps) return [a, b];
  const left = simplify(pts.slice(0, at + 1), eps);
  return [...left.slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/** Merge points closer than `tol` that follow one another (drawing double-clicks, SVG joins). */
export function dedupeConsecutive(pts: Vec3[], tol = 0.05): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > tol) out.push(p);
  return out;
}

/* ---- Polygons (plane coords) ---- */

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export const ccw = (poly: Vec2[]): Vec2[] => (polygonArea(poly) < 0 ? [...poly].reverse() : poly);
export const cw = (poly: Vec2[]): Vec2[] => (polygonArea(poly) > 0 ? [...poly].reverse() : poly);

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer loop and outside every hole. */
export function pointInRegion(p: Vec2, outer: Vec2[], holes: Vec2[][] = []): boolean {
  return pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h));
}

export function bounds2(pts: Vec2[]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const [x, y] of pts) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
  }
  return { min, max };
}

/** Distance from a point to a closed polygon's boundary. */
export function distToPolygon(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const L2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t)));
  }
  return best;
}

/**
 * Turn loose closed loops into regions by nesting: even depth is an outer boundary, odd depth a
 * hole of the loop that contains it. This is how SVG fills and stacked drawn shapes resolve.
 */
export function nestLoops(loops: Vec2[][]): { outer: Vec2[]; holes: Vec2[][] }[] {
  const items = loops
    .filter((l) => l.length >= 3 && Math.abs(polygonArea(l)) > 1e-6)
    .map((l) => ({ loop: l, area: Math.abs(polygonArea(l)) }))
    .sort((a, b) => b.area - a.area);
  const parent: number[] = items.map(() => -1);
  const depth: number[] = items.map(() => 0);
  items.forEach((it, i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (pointInPolygon(it.loop[0], items[j].loop)) {
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  });
  const out: { outer: Vec2[]; holes: Vec2[][] }[] = [];
  const index = new Map<number, number>();
  items.forEach((it, i) => {
    if (depth[i] % 2 === 0) {
      index.set(i, out.length);
      out.push({ outer: ccw(it.loop), holes: [] });
    } else {
      const k = index.get(parent[i]);
      if (k !== undefined) out[k].holes.push(cw(it.loop));
    }
  });
  return out;
}

/** Sample a circular arc from `a` to `b` through `mid` (three-point arc), in plane coords. */
export function arc3(a: Vec2, mid: Vec2, b: Vec2, maxSeg = 4): Vec2[] {
  const [ax, ay] = a;
  const [bx, by] = mid;
  const [cx, cy] = b;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [a, b];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const t0 = Math.atan2(ay - uy, ax - ux);
  const tm = Math.atan2(by - uy, bx - ux);
  const t1 = Math.atan2(cy - uy, cx - ux);
  // Go the way that passes through `mid`.
  const norm2 = (t: number) => ((t - t0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm2(t1);
  if (norm2(tm) > sweep) sweep -= 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(sweep * r) / maxSeg));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + (sweep * i) / n;
    return [ux + r * Math.cos(t), uy + r * Math.sin(t)] as Vec2;
  });
}

export function circlePts(c: Vec2, r: number, maxSeg = 4): Vec2[] {
  const n = Math.max(12, Math.ceil((2 * Math.PI * r) / maxSeg));
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);
}

export function regularPolygon(c: Vec2, r: number, sides: number, rotDeg = 90): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const t = ((rotDeg + (360 * i) / sides) * Math.PI) / 180;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as Vec2;
  });
}
