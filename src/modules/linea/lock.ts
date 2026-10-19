import { add, cross, dist, dot, len, norm, scale, sub } from '../../geom/vec';
import { dedupeConsecutive, fromPlane, planeFrom3, planeNormal, simplify, toPlane } from '../../sketch/geom';
import { planeXY, type SketchPlane } from '../../sketch/types';
import type { Params, Vec3 } from '../../types';
import { nextId } from '../shared/layout';
import { clean, type LineaDesign, type LineaRun } from './model';
import { jointArm, linDims, lineaParams, type LinDims } from './params';
import { TOPO_TOL } from './topology';

/**
 * Drawn paths → pitch-locked runs. Every straight between joint pieces must be a whole number
 * of pixels, so each segment's length is adjusted by sliding the downstream vertex (and
 * everything after it) along the segment: directions, and so every corner angle, stay exactly
 * as drawn. Path ends that land on another run snap onto it (a T, or a shared corner) by
 * sliding along their own segment, so the branch keeps its exact angle too.
 */

/** How far a drawn end may be from another run and still join it, mm. */
export const LAND_TOL = 12;
/** RDP tolerance for freehand and sampled curves, mm. */
export const SIMPLIFY_EPS = 2;

const DEG = 180 / Math.PI;

/** Angle between two directions, degrees, robust near 0° and 180°. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.atan2(len(cross(a, b)), dot(a, b)) * DEG;
}

/** Interior angle at vertex i (between the two bars), degrees. 180 is straight on. */
export function interiorAngle(pts: Vec3[], closed: boolean, i: number): number | null {
  const n = pts.length;
  if (!closed && (i === 0 || i === n - 1)) return null;
  const p = pts[(i - 1 + n) % n];
  const q = pts[(i + 1) % n];
  return angleBetween(norm(sub(p, pts[i])), norm(sub(q, pts[i])));
}

/** Arm length the joint at vertex i will have, as far as this run alone can tell. */
export function armAt(D: LinDims, pts: Vec3[], closed: boolean, i: number): number {
  const a = interiorAngle(pts, closed, i);
  return a === null ? D.endArm : jointArm(D, a);
}

/** Nearest locked length: arms plus a whole number (at least one) of pitches. */
export function lockedLength(D: LinDims, L: number, armA: number, armB: number): number {
  const k = Math.max(1, Math.round((L - armA - armB) / D.pitch));
  return armA + armB + k * D.pitch;
}

/** Least-squares intersection of lines P + s·d and Q + t·e. */
export function lineIntersect(P: Vec3, d: Vec3, Q: Vec3, e: Vec3): { s: number; t: number; gap: number; at: Vec3 } | null {
  const a = dot(d, d);
  const b = dot(d, e);
  const c = dot(e, e);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(Q, P);
  const dw = dot(d, w);
  const ew = dot(e, w);
  const s = (c * dw - b * ew) / den;
  const t = (b * dw - a * ew) / den;
  const p1 = add(P, scale(d, s));
  const p2 = add(Q, scale(e, t));
  return { s, t, gap: dist(p1, p2), at: scale(add(p1, p2), 0.5) };
}

export interface Landing {
  pos: Vec3;
  /** Directions of the bars already at the landing point, pointing away from it. */
  dirs: Vec3[];
  /** Landed on a vertex (merge) rather than a segment interior (T). */
  vertex: boolean;
}

/**
 * Where an end at E, arriving from `anchor`, joins the other runs: a vertex within LAND_TOL
 * (snapped onto exactly), else the point where its own line crosses another run's segment.
 */
export function landing(E: Vec3, anchor: Vec3, runs: LineaRun[], tol = LAND_TOL): Landing | null {
  const d = norm(sub(E, anchor));
  let best: Landing | null = null;
  let bestD = tol;
  for (const r of runs) {
    const n = r.pts.length;
    r.pts.forEach((v, i) => {
      const dd = dist(E, v);
      if (dd >= bestD) return;
      const dirs: Vec3[] = [];
      if (r.closed || i > 0) dirs.push(norm(sub(r.pts[(i - 1 + n) % n], v)));
      if (r.closed || i < n - 1) dirs.push(norm(sub(r.pts[(i + 1) % n], v)));
      bestD = dd;
      best = { pos: v, dirs, vertex: true };
    });
  }
  if (best) return best;
  bestD = tol;
  for (const r of runs) {
    const n = r.closed ? r.pts.length : r.pts.length - 1;
    for (let i = 0; i < n; i++) {
      const A = r.pts[i];
      const B = r.pts[(i + 1) % r.pts.length];
      const L = dist(A, B);
      if (L < 1e-6) continue;
      const e = norm(sub(B, A));
      // Grazing joins (under 10°) are not T joints.
      if (len(cross(d, e)) < Math.sin(10 / DEG)) continue;
      const x = lineIntersect(anchor, d, A, e);
      if (!x || x.gap > 0.5 || x.s < 1 || x.t < 2 * TOPO_TOL || x.t > L - 2 * TOPO_TOL) continue;
      const dd = dist(x.at, E);
      if (dd >= bestD) continue;
      bestD = dd;
      best = { pos: add(A, scale(e, x.t)), dirs: [e, scale(e, -1)], vertex: false };
    }
  }
  return best;
}

/** Arm a landed end will get: from the smallest angle to the bars already there. */
function landArm(D: LinDims, away: Vec3, land: Landing): number {
  const min = Math.min(180, ...land.dirs.map((e) => angleBetween(away, e)));
  return jointArm(D, min);
}

/** Translate vertices from index `from` on (open runs) by `delta`. */
function shift(pts: Vec3[], from: number, delta: Vec3) {
  for (let j = from; j < pts.length; j++) pts[j] = add(pts[j], delta);
}

/**
 * Pitch-lock a run in place, landing its open ends on `others`. Returns new vertices.
 * Open runs lock forward from the (possibly landed) start. Closed runs scale uniformly when
 * every side then locks (regular polygons), else lock all but the last two sides and put the
 * last vertex where the last two drawn directions meet, so every angle stays exact.
 */
export function lockRun(D: LinDims, input: Vec3[], closed: boolean, others: LineaRun[]): Vec3[] {
  const pts = input.map((p) => [...p] as Vec3);
  const n = pts.length;
  if (n < 2) return pts;

  if (closed && n >= 3) {
    const dirs = pts.map((p, i) => norm(sub(pts[(i + 1) % n], p)));
    const arms = pts.map((_, i) => armAt(D, pts, true, i));
    const L = pts.map((p, i) => dist(p, pts[(i + 1) % n]));
    const s = lockedLength(D, L[0], arms[0], arms[1]) / L[0];
    const ok = L.every((l, i) => {
      const k = (l * s - arms[i] - arms[(i + 1) % n]) / D.pitch;
      return k > 0.5 && Math.abs(k - Math.round(k)) < 1e-6;
    });
    if (ok) {
      const c = scale(pts.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]), 1 / n);
      return pts.map((p) => add(c, scale(sub(p, c), s)));
    }
    for (let i = 0; i < n - 2; i++) {
      const l = dist(pts[i], pts[i + 1]);
      const want = lockedLength(D, l, arms[i], arms[i + 1]);
      shift(pts, i + 1, scale(dirs[i], want - l));
    }
    const x = lineIntersect(pts[n - 2], dirs[n - 2], pts[0], scale(dirs[n - 1], -1));
    if (x && x.s > 1 && x.t > 1) pts[n - 1] = x.at;
    return pts;
  }

  // Open: land the start on another run (sliding it along the first segment).
  let startArm = D.endArm;
  const d0 = norm(sub(pts[0], pts[1]));
  const s0 = landing(pts[0], pts[1], others);
  if (s0) {
    // On a vertex: carry the whole path there (every angle stays exact). On a segment: slide
    // the start along its own direction onto the host line.
    if (s0.vertex) shift(pts, 0, sub(s0.pos, pts[0]));
    pts[0] = s0.pos;
    startArm = landArm(D, scale(d0, -1), s0);
  }
  for (let i = 0; i < n - 1; i++) {
    const d = norm(sub(pts[i + 1], pts[i]));
    const l = dist(pts[i], pts[i + 1]);
    if (i === n - 2) {
      const e = landing(pts[n - 1], pts[n - 2], others);
      if (e) {
        pts[n - 1] = e.pos;
        break;
      }
    }
    const a = i === 0 ? startArm : armAt(D, pts, false, i);
    const b = i + 1 === n - 1 ? D.endArm : armAt(D, pts, false, i + 1);
    const want = lockedLength(D, l, a, b);
    shift(pts, i + 1, scale(d, want - l));
  }
  return pts;
}

/** Interior turn at i for clean-up, degrees off straight. */
function turn(pts: Vec3[], closed: boolean, i: number): number {
  const a = interiorAngle(pts, closed, i);
  return a === null ? 180 : 180 - a;
}

/**
 * Tidy a drawn polyline: drop doubled points, close loops drawn back to the start, simplify
 * sampled curves into chords, and merge segments too short to hold a straight between joints.
 */
export function cleanPath(D: LinDims, raw: Vec3[], closedIn: boolean): { pts: Vec3[]; closed: boolean } {
  let pts = dedupeConsecutive(raw, 0.5);
  let closed = closedIn;
  if (!closed && pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) < 2) {
    closed = true;
    pts = pts.slice(0, -1);
  }
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 0.5) pts = pts.slice(0, -1);
  pts = closed ? simplify([...pts, pts[0]], SIMPLIFY_EPS).slice(0, -1) : simplify(pts, SIMPLIFY_EPS);
  // Shortest segment that still holds a one-pixel straight between two shallow corners.
  const minSeg = 2 * jointArm(D, 170) + D.pitch;
  for (let guard = 0; guard < 500; guard++) {
    const n = pts.length;
    if (n < (closed ? 4 : 3)) break;
    const segCount = closed ? n : n - 1;
    let worst = -1;
    let wl = minSeg;
    for (let i = 0; i < segCount; i++) {
      const l = dist(pts[i], pts[(i + 1) % n]);
      if (l < wl) [worst, wl] = [i, l];
    }
    if (worst < 0) break;
    const cand = [worst, (worst + 1) % n].filter((j) => closed || (j > 0 && j < n - 1));
    if (!cand.length) break;
    const drop = cand.sort((x, y) => turn(pts, closed, x) - turn(pts, closed, y))[0];
    pts = pts.filter((_, j) => j !== drop);
  }
  if (closed && pts.length < 3) closed = false;
  return { pts, closed };
}

function planeOf(pts: Vec3[], given?: SketchPlane): SketchPlane {
  if (given) return given;
  for (let i = 2; i < pts.length; i++) {
    const pl = planeFrom3(pts[0], pts[1], pts[i]);
    if (pl) return pl;
  }
  return planeXY(pts[0]?.[2] ?? 0);
}

/** Keep vertices exactly on their plane (drags and float noise can lift them a hair). */
function onPlane(pl: SketchPlane, p: Vec3): Vec3 {
  return fromPlane(toPlane(p, pl), pl);
}

/** Free ends of other runs that land on `run` snap onto it (a T drawn the other way round). */
function snapEndsOnto(design: LineaDesign, run: LineaRun): LineaDesign {
  const runs = design.runs.map((o) => {
    if (o.id === run.id || o.closed || o.pts.length < 2) return o;
    let pts = o.pts;
    for (const end of [0, o.pts.length - 1]) {
      const anchor = pts[end === 0 ? 1 : pts.length - 2];
      const E = pts[end];
      const land = landing(E, anchor, [run]);
      if (!land || dist(land.pos, E) < 1e-6) continue;
      pts = pts.map((p, j) => (j === end ? clean(land.pos) : p));
    }
    return pts === o.pts ? o : { ...o, pts };
  });
  return { ...design, runs };
}

export interface PathIn {
  pts: Vec3[];
  closed: boolean;
  plane?: SketchPlane;
}

/**
 * The `fromPaths` adapter: each planar polyline becomes a pitch-locked run lying in its plane,
 * light facing the plane normal. Merges into the design (appends) and returns the new one.
 */
export function addPaths(design: LineaDesign, paths: PathIn[], params: Params = {}): LineaDesign {
  const D = linDims(lineaParams(params));
  let d: LineaDesign = { ...design, runs: [...design.runs] };
  for (const p of paths) {
    if (!p.pts || p.pts.length < 2) continue;
    const plane = planeOf(p.pts, p.plane);
    const { pts, closed } = cleanPath(
      D,
      p.pts.map((q) => onPlane(plane, q)),
      p.closed,
    );
    if (pts.length < 2) continue;
    const locked = lockRun(D, pts, closed, d.runs);
    const run: LineaRun = {
      id: nextId('R', d.runs.map((r) => r.id)),
      plane,
      pts: locked.map(clean),
      closed,
      face: clean(planeNormal(plane)),
    };
    d = snapEndsOnto({ ...d, runs: [...d.runs, run] }, run);
  }
  return d;
}

/** Circle–circle intersection in a plane, the solution nearest `near`. */
function circles(pl: SketchPlane, c1: Vec3, r1: number, c2: Vec3, r2: number, near: Vec3): Vec3 | null {
  const a = toPlane(c1, pl);
  const b = toPlane(c2, pl);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dd = Math.hypot(dx, dy);
  if (dd < 1e-9 || dd > r1 + r2 || dd < Math.abs(r1 - r2)) return null;
  const along = (r1 * r1 - r2 * r2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const mx = a[0] + (dx * along) / dd;
  const my = a[1] + (dy * along) / dd;
  const s1 = fromPlane([mx - (dy * h) / dd, my + (dx * h) / dd], pl);
  const s2 = fromPlane([mx + (dy * h) / dd, my - (dx * h) / dd], pl);
  return dist(s1, near) <= dist(s2, near) ? s1 : s2;
}

/**
 * A vertex dragged to `pos` (commit). Ends land on other runs or lock their own segment;
 * an interior vertex settles where both its segments lock, so only it moves.
 */
export function moveVertex(design: LineaDesign, runId: string, i: number, pos: Vec3, params: Params = {}): LineaDesign {
  const run = design.runs.find((r) => r.id === runId);
  if (!run || i < 0 || i >= run.pts.length) return design;
  const D = linDims(lineaParams(params));
  const others = design.runs.filter((r) => r.id !== runId);
  const pts = run.pts.map((p) => [...p] as Vec3);
  const n = pts.length;
  pts[i] = onPlane(run.plane, pos);
  const isEnd = !run.closed && (i === 0 || i === n - 1);
  if (isEnd) {
    const j = i === 0 ? 1 : n - 2;
    const land = landing(pts[i], pts[j], others);
    if (land) pts[i] = land.pos;
    else {
      const l = dist(pts[j], pts[i]);
      if (l > 1e-6) pts[i] = add(pts[j], scale(norm(sub(pts[i], pts[j])), lockedLength(D, l, armAt(D, pts, false, j), D.endArm)));
    }
  } else {
    const ip = (i - 1 + n) % n;
    const inx = (i + 1) % n;
    let at = pts[i];
    for (let it = 0; it < 4; it++) {
      const r1 = lockedLength(D, dist(pts[ip], at), armAt(D, pts, run.closed, ip), armAt(D, pts, run.closed, i));
      const r2 = lockedLength(D, dist(at, pts[inx]), armAt(D, pts, run.closed, i), armAt(D, pts, run.closed, inx));
      const x = circles(run.plane, pts[ip], r1, pts[inx], r2, pos);
      if (!x) break;
      at = x;
      pts[i] = at;
    }
  }
  const moved: LineaRun = { ...run, pts: pts.map(clean) };
  return { ...design, runs: design.runs.map((r) => (r.id === runId ? moved : r)) };
}

/** Re-lock a whole run (after a param change that alters pitch, or on request). */
export function relockRun(design: LineaDesign, runId: string, params: Params = {}): LineaDesign {
  const run = design.runs.find((r) => r.id === runId);
  if (!run) return design;
  const D = linDims(lineaParams(params));
  const pts = lockRun(
    D,
    run.pts.map((p) => onPlane(run.plane, p)),
    run.closed,
    design.runs.filter((r) => r.id !== runId),
  );
  return { ...design, runs: design.runs.map((r) => (r.id === runId ? { ...r, pts: pts.map(clean) } : r)) };
}
