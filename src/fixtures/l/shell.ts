import type { CrossSection, Manifold } from 'manifold-3d';
import { fitOf, seatOf, sideOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { apply, applyDir, mul, Rx, Rz, T } from '../../geom/mat';
import { invert, splitParts, splitToBed } from '../../geom/split';
import { add, basis, cross, dist, dot, frameZ, letters, norm, perp, rotMat4, scale, sub } from '../../geom/vec';
import { cluster1D, matchSockets, type KeyedDir } from '../../graph/dedupe';
import { getPixel, pcbLedOffsets, type PixelType } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { AssemblyStep, HardwareLine, Mat4, ParamSpec, Params, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { layFlat, str } from '../util';
import type { SplitCfg } from './common';

/**
 * Modular shells: the Orb's construction, shared by every panel-shell fixture (L1 Orb, L7 Dome,
 * L8 Drum, L9 Polyhedra).
 *
 * A shell is a convex polyhedron of flat faces. Every vertex has a **spoke**: the inward
 * direction its panel corners run along. Each edge plus the spokes at its two ends span one
 * **seam plane**, so neighbouring panels cut from the same plane meet face to face. For a
 * sphere every spoke points at the centre; for a drum they run level to the axis.
 *
 * - **Panels** are light boxes: a flat diffuser face, skirts in the seam planes, and a 45°
 *   funnel (support-free, face down on the plate) up to a collar that holds the face pixel.
 *   Each seam skirt is set back half the fit gap, so two panels leave the full gap between them.
 * - **Vertex caps** join the panels from the outside: a spigot drops into the round corner hole
 *   the panels leave around the vertex (round fit: hole = spigot + fit gap), and countersunk
 *   self-tappers pull the cap down onto the corner bosses. A cap can carry the second pixel: a
 *   PCB seated in the spigot shining out through a printed lens in a fit-gap counterbore.
 * - **Bands** are polygonal rings the panels stand in (drum seams, the dome's base ring). A
 *   panel's face plate carries on past its edge as a tongue into a groove in the band
 *   (prismatic fit: groove = tongue + fit gap, and half the gap deeper). A band can carry a strip
 *   in a slot behind a thin diffuser lip.
 *
 * Faces and vertices dedupe with matchSockets, so identical panels and caps print as one part ×N.
 */

export const SKIRT_T = 1.6;
export const SKIRT_D = 8;
export const FACE_T = 1.2;
export const FUNNEL_W = 1.2;
export const COLLAR_T = 3;
export const BOSS_H = 10;
export const BOSS_R = 3.8;
export const CAP_T = 2.4;
export const SPIG_L = 6;
/** 1/8 IPS nipple is 10.3 mm OD. Hardware: its own hole size. */
export const PIPE_R = 5.35;
export const LENS_T = 1.6;
export const TONGUE_T = 2.4;
export const TONGUE_D = 5;
/** Diffuser wall in front of a band strip. */
export const LIP = 1.2;

const BIG = 4000;

/* ------------------------------------------------------------------ */
/* Pixels                                                              */
/* ------------------------------------------------------------------ */

/** Radius of a pixel's outline in its socket plane. */
export function pixelR(p: PixelType): number {
  const s = p.shape;
  return s.kind === 'round' ? s.d / 2 : s.kind === 'ring' ? s.od / 2 : s.kind === 'box' ? Math.max(s.w, s.l) / 2 : s.width / 2;
}

/** Select options for a pixel choice that allows "none". */
export function pixelOptions(ids: string[], none: string): { value: string; label: string }[] {
  return [...ids.map((id) => ({ value: id, label: getPixel(id).name })), { value: 'none', label: none }];
}

/** The pixel a select param names, or null for 'none'. */
export function optPixel(params: Params, key: string): PixelType | null {
  const id = str(params, key);
  return id && id !== 'none' ? getPixel(id) : null;
}

/** LEDs of a pixel lying in a plane at `c` facing `n`, with `x` along the plane: data order. */
export function pixelsAt(p: PixelType, c: Vec3, n: Vec3, x: Vec3, unit: string): PixelPlacement[] {
  if (p.form === 'node' || p.form === 'pcb') return [{ pos: c, normal: n, unit }];
  const y = cross(n, x);
  return pcbLedOffsets(p).map(([u, v]) => ({ pos: add(c, add(scale(x, u), scale(y, v))), normal: n, unit }));
}

/* ------------------------------------------------------------------ */
/* Plan: faces, vertices, classes, data order                          */
/* ------------------------------------------------------------------ */

export type EdgeKind = 'seam' | 'tongue';

export interface ShellFace {
  idx: number;
  /** Vertex indices, CCW seen from outside. */
  v: number[];
  pts: Vec3[];
  c: Vec3;
  /** Outward normal. */
  n: Vec3;
  /** edges[k] runs v[k] → v[k+1]. */
  edges: EdgeKind[];
  cls: string;
  /** Rotation taking the class representative onto this face. */
  rot: number[][];
}

export interface ShellVertex {
  idx: number;
  p: Vec3;
  /** Unit, inward. */
  spoke: Vec3;
  /** Neighbour vertex indices, CCW seen from outside. */
  nbrs: number[];
  /** faces[k] lies between nbrs[k] and nbrs[k+1]; -1 where the shell is open (a rim). */
  faces: number[];
  cls: string;
  rot: number[][];
  top: boolean;
  rim: boolean;
}

export interface ShellClass {
  id: string;
  rep: number;
  members: number[];
}

export interface ShellPlan {
  faces: ShellFace[];
  verts: ShellVertex[];
  faceClasses: ShellClass[];
  vertexClasses: ShellClass[];
  /** Data order: face indices. */
  order: number[];
  /** Data order: vertex indices (no crown, no rim). */
  vertOrder: number[];
  minEdge: number;
  maxEdge: number;
}

export interface ShellInput {
  points: Vec3[];
  /** Polygons of point indices; either winding. */
  faces: number[][];
  /** Inward unit direction at a vertex. */
  spoke: (p: Vec3) => Vec3;
  /** Edges that carry a tongue into a band instead of a seam. */
  tongue?: (a: Vec3, b: Vec3) => boolean;
  /** The top vertex is the crown (its own class). */
  crown?: boolean;
  /** Overall size (a radius), for matching tolerances. */
  size: number;
}

const ident = () => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const kd = (key: string, dir: Vec3): KeyedDir => ({ key, dir, face: [0, 0, 1], lit: false });

function classify<T extends { idx: number; cls: string; rot: number[][] }>(items: T[], keysOf: (t: T) => KeyedDir[], idOf: (k: number, t: T) => string, own?: (t: T) => string | null): ShellClass[] {
  const classes: (ShellClass & { keys: KeyedDir[]; solo: boolean })[] = [];
  let plain = 0;
  for (const t of items) {
    const keys = keysOf(t);
    const solo = own?.(t) ?? null;
    let hit = false;
    if (!solo)
      for (const c of classes) {
        if (c.solo) continue;
        const rot = matchSockets(c.keys, keys);
        if (rot) {
          c.members.push(t.idx);
          t.cls = c.id;
          t.rot = rot;
          hit = true;
          break;
        }
      }
    if (!hit) {
      const id = solo ?? idOf(plain++, t);
      classes.push({ id, rep: t.idx, members: [t.idx], keys, solo: !!solo });
      t.cls = id;
    }
  }
  return classes.map(({ id, rep, members }) => ({ id, rep, members }));
}

/** Latitude bands top to bottom; each band runs as a ring, starting near the end of the last. */
export function bandOrder(points: Vec3[], step: number): number[] {
  const items = points.map((c, i) => ({ c, i }));
  const orderFor = (tolK: number): number[] => {
    const bands = cluster1D(items, (f) => -f.c[2], step * tolK);
    const out: number[] = [];
    for (const band of bands) {
      const ring = [...band].sort((a, b) => Math.atan2(a.c[1], a.c[0]) - Math.atan2(b.c[1], b.c[0]));
      const last = out.length ? points[out[out.length - 1]] : null;
      let s0 = 0;
      if (last) ring.forEach((f, i) => dist(f.c, last) < dist(ring[s0].c, last) && (s0 = i));
      const n = ring.length;
      const fwd = n > 1 && dist(ring[(s0 + 1) % n].c, ring[s0].c) <= dist(ring[(s0 - 1 + n) % n].c, ring[s0].c);
      for (let k = 0; k < n; k++) out.push(ring[(s0 + (fwd ? k : -k) + n * n) % n].i);
    }
    return out;
  };
  const worstHop = (o: number[]) => o.reduce((w, fi, k) => (k ? Math.max(w, dist(points[fi], points[o[k - 1]])) : w), 0);
  let order = orderFor(0.2);
  for (const k of [0.1, 0.3, 0.4, 0.5, 0.6]) {
    const o = orderFor(k);
    if (worstHop(o) < worstHop(order) - 1e-6) order = o;
  }
  // Sparse shells (a few big faces) make poor rings: a nearest-neighbour walk from the top,
  // preferring to stay high, often has shorter hops.
  if (points.length > 2) {
    const left = new Set(points.map((_, i) => i));
    let cur = points.reduce((b, p, i) => (p[2] > points[b][2] ? i : b), 0);
    const walk = [cur];
    left.delete(cur);
    while (left.size) {
      let best = -1;
      let bd = Infinity;
      for (const i of left) {
        const d = dist(points[i], points[cur]) - 1e-3 * points[i][2];
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      walk.push(best);
      left.delete(best);
      cur = best;
    }
    if (worstHop(walk) < worstHop(order) * 0.95) order = walk;
  }
  return order;
}

/** Geometry, adjacency and dedupe for a shell. No kernel needed. */
export function planShell(inp: ShellInput): ShellPlan {
  const P = inp.points;
  const spokes = P.map((p) => norm(inp.spoke(p)));
  const tol = 0.02 * (inp.size / 250);

  const faces: ShellFace[] = inp.faces.map((v0, idx) => {
    let v = [...v0];
    const newell = (ids: number[]): Vec3 => {
      let n: Vec3 = [0, 0, 0];
      ids.forEach((a, k) => (n = add(n, cross(P[a], P[ids[(k + 1) % ids.length]]))));
      return norm(n);
    };
    let n = newell(v);
    const s = v.reduce<Vec3>((acc, i) => add(acc, spokes[i]), [0, 0, 0]);
    if (dot(n, s) > 0) {
      v = v.reverse();
      n = scale(n, -1);
    }
    const pts = v.map((i) => P[i]);
    const c = scale(
      pts.reduce<Vec3>((a, p) => add(a, p), [0, 0, 0]),
      1 / pts.length,
    );
    const edges = v.map((a, k): EdgeKind => (inp.tongue?.(P[a], P[v[(k + 1) % v.length]]) ? 'tongue' : 'seam'));
    return { idx, v, pts, c, n, edges, cls: '', rot: ident() };
  });

  let minEdge = Infinity;
  let maxEdge = 0;
  for (const f of faces)
    f.pts.forEach((p, i) => {
      const e = dist(p, f.pts[(i + 1) % f.pts.length]);
      minEdge = Math.min(minEdge, e);
      maxEdge = Math.max(maxEdge, e);
    });

  /* ---- Face classes: same panel up to rotation (mirror images are different prints) ---- */
  const radial = faces.flatMap((f) => f.pts.map((p, i) => ({ f: f.idx, i, d: dist(p, f.c) })));
  const rClass = new Map<string, number>();
  cluster1D(radial, (x) => x.d, tol).forEach((grp, k) => grp.forEach((x) => rClass.set(`${x.f}:${x.i}`, k)));
  const faceClasses = classify(
    faces,
    (f) => [
      ...f.pts.map((p, i) => kd(`r${rClass.get(`${f.idx}:${i}`)}`, norm(sub(p, f.c)))),
      ...f.v.map((vi, i) => kd(`s${rClass.get(`${f.idx}:${i}`)}`, spokes[vi])),
      kd('n', f.n),
      ...f.edges.flatMap((k, i) => (k === 'tongue' ? [kd('t', norm(sub(scale(add(f.pts[i], f.pts[(i + 1) % f.pts.length]), 0.5), f.c)))] : [])),
    ],
    (k) => letters(k),
  );

  /* ---- Vertices: neighbours in CCW order, incident faces, classes ---- */
  const used = new Set(faces.flatMap((f) => f.v));
  const topIdx = [...used].reduce((best, i) => (P[i][2] > P[best][2] ? i : best), [...used][0]);
  const inc = new Map<number, number[]>();
  faces.forEach((f) => f.v.forEach((i) => inc.set(i, [...(inc.get(i) ?? []), f.idx])));
  const polyNbrs = (f: ShellFace, i: number): [number, number] => {
    const k = f.v.indexOf(i);
    return [f.v[(k + f.v.length - 1) % f.v.length], f.v[(k + 1) % f.v.length]];
  };
  const verts: ShellVertex[] = P.map((p, idx) => {
    const fs = inc.get(idx) ?? [];
    const nV = scale(spokes[idx], -1);
    const nbrSet = new Set<number>();
    for (const fi of fs) for (const j of polyNbrs(faces[fi], idx)) nbrSet.add(j);
    const x = perp(nV);
    const y = cross(nV, x);
    const ang = (j: number) => {
      const d = sub(P[j], p);
      return Math.atan2(dot(d, y), dot(d, x));
    };
    const nbrs = [...nbrSet].sort((a, b) => ang(a) - ang(b));
    const fOrdered = nbrs.map((a, k) => {
      const b = nbrs[(k + 1) % nbrs.length];
      return fs.find((fi) => {
        const pn = polyNbrs(faces[fi], idx);
        return pn.includes(a) && pn.includes(b);
      }) ?? -1;
    });
    // A rim vertex has one gap: rotate so the gap comes last.
    const gap = fOrdered.indexOf(-1);
    if (gap >= 0 && gap !== fOrdered.length - 1) {
      const s = gap + 1;
      nbrs.push(...nbrs.splice(0, s));
      fOrdered.push(...fOrdered.splice(0, s));
    }
    return { idx, p, spoke: spokes[idx], nbrs, faces: fOrdered, cls: '', rot: ident(), top: !!inp.crown && idx === topIdx, rim: gap >= 0 };
  });
  const live = verts.filter((v) => used.has(v.idx));
  const edgeList = live.flatMap((v) => v.nbrs.map((j) => ({ v: v.idx, j, d: dist(v.p, P[j]) })));
  const eClass = new Map<string, number>();
  cluster1D(edgeList, (e) => e.d, tol).forEach((grp, k) => grp.forEach((e) => eClass.set(`${e.v}:${e.j}`, k)));
  const vertexClasses = classify(
    live,
    (v) => [
      ...v.nbrs.map((j) => kd(`e${eClass.get(`${v.idx}:${j}`)}`, norm(sub(P[j], v.p)))),
      kd('n', scale(v.spoke, -1)),
      ...v.faces.filter((fi) => fi >= 0).map((fi) => kd(`f${faces[fi].cls}`, norm(sub(faces[fi].c, v.p)))),
    ],
    (k, v) => `${v.rim ? 'R' : 'V'}${letters(k)}`,
    (v) => (v.top ? 'crown' : null),
  );

  const order = bandOrder(
    faces.map((f) => f.c),
    minEdge,
  );
  const accentVerts = live.filter((v) => !v.top && !v.rim);
  const vertOrder = bandOrder(
    accentVerts.map((v) => v.p),
    minEdge,
  ).map((k) => accentVerts[k].idx);

  return { faces, verts, faceClasses, vertexClasses, order, vertOrder, minEdge, maxEdge };
}

/* ------------------------------------------------------------------ */
/* Fit: the cap joint                                                  */
/* ------------------------------------------------------------------ */

export interface CapJoints {
  fit: number;
  side: number;
  seat: number;
  /** Cap spigot radius (male). */
  spigR: number;
  /** Corner hole radius the panels leave around a vertex (female): spigot + fit/2. */
  holeR: number;
  /** Corner screw boss distance from the vertex, along the corner bisector. */
  bossD: number;
  accent: PixelType | null;
  /** Lens disc radius (male) and its counterbore (female). */
  lensR: number;
  lensBoreR: number;
}

/** Every dimension of the vertex joint, from the fit settings and the accent pixel. */
export function capJoints(params: Params, accent: PixelType | null, crown: boolean): CapJoints {
  const fit = fitOf(params);
  const side = sideOf(params);
  const seat = seatOf(params);
  const ar = accent ? pixelR(accent) : 0;
  const spigR = Math.max(5, crown ? PIPE_R + 2 : 0, accent ? ar + seat + 1.6 : 0);
  const holeR = spigR + side;
  const lensR = accent ? ar + 1.5 : 0;
  return { fit, side, seat, spigR, holeR, bossD: holeR + BOSS_R + 0.8, accent, lensR, lensBoreR: lensR + side };
}

/** Corner region (cap size, funnel chop) for a capped shell: big enough to cover the bosses. */
export function capRegion(plan: ShellPlan, j: CapJoints): { rc: number; tight: boolean } {
  const base = Math.min(0.4 * plan.minEdge, Math.max(13, Math.min(28, 0.24 * plan.minEdge)));
  let worstCos = 1;
  for (const f of plan.faces)
    f.pts.forEach((p, i) => {
      const a = norm(sub(f.pts[(i + 1) % f.pts.length], p));
      const b = norm(sub(f.pts[(i + f.pts.length - 1) % f.pts.length], p));
      worstCos = Math.min(worstCos, Math.cos(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / 2));
    });
  const need = (j.bossD + 3.4 + 0.8) / worstCos;
  const want = Math.max(base, need);
  const lim = 0.45 * plan.minEdge;
  return { rc: Math.min(want, lim), tight: want > lim };
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

/** Print frame of a face: outer face on z=0, panel rising inward (+z), x along the first edge. */
export function faceFrame(f: ShellFace): Mat4 {
  const z = scale(f.n, -1);
  const x = norm(sub(f.pts[1], f.pts[0]));
  return basis(x, cross(z, x), z, f.c);
}

/** Warning when face pixels on strand leads sit further apart than the leads reach. */
export function leadWarning(plan: ShellPlan, pixel: PixelType): string | null {
  if (!pixel.leadLength) return null;
  const hop = Math.max(0, ...plan.order.map((fi, k) => (k ? dist(plan.faces[fi].c, plan.faces[plan.order[k - 1]].c) : 0)));
  if (hop <= pixel.leadLength) return null;
  return `Face centres are up to ${hop.toFixed(0)} mm apart in data order: order nodes on ${hop > 150 ? '12″ (300 mm)' : '6″ (150 mm)'} leads, or extend the leads.`;
}

/** Corner screw point of a face corner (assembled frame), along the corner bisector. */
export function cornerPoint(f: ShellFace, i: number, d: number): Vec3 {
  const n = f.pts.length;
  const p = f.pts[i];
  const a = norm(sub(f.pts[(i + 1) % n], p));
  const b = norm(sub(f.pts[(i + n - 1) % n], p));
  return add(p, scale(norm(add(a, b)), d));
}

/** Instances of a face class: the representative's print frame carried onto every member. */
export function faceInstances(plan: ShellPlan, cls: ShellClass): Mat4[] {
  const f = plan.faces[cls.rep];
  const M = faceFrame(f);
  return cls.members.map((m) => {
    const o = plan.faces[m];
    return mul(T(...o.c), rotMat4(o.rot), T(...scale(f.c, -1)), M);
  });
}

export interface PanelOpts {
  side: number;
  seat: number;
  pixel: PixelType;
  /** Corner region left dark (and covered by caps). */
  rc: number;
  caps: CapJoints | null;
  /** Assembled-frame tongue for a tongue edge. */
  tongue?: (f: ShellFace, k: number) => Manifold | null;
}

/** One light-box panel for a face, in its print frame. */
export function buildPanel(g: Geo, plan: ShellPlan, f: ShellFace, o: PanelOpts): { solid: Manifold; hf: number; collarR: number } {
  const M = faceFrame(f);
  const Mi = invert(M);
  const n = f.pts.length;
  const p = f.pts.map((q) => apply(Mi, q));
  const S = f.v.map((vi) => norm(applyDir(Mi, plan.verts[vi].spoke)));
  const at = (i: number, z: number): Vec3 => add(p[i], scale(S[i], z / Math.max(0.05, S[i][2])));
  const ring = (z: number) => p.map((_, i) => at(i, z));
  const ring2 = (z: number): P2[] => ring(z).map((q) => [q[0], q[1]]);
  const inset = (pts: P2[], d: number, z: number): Vec3[] => {
    const poly = (g.poly(pts).offset(-d, 'Miter').toPolygons() as unknown as P2[][])[0] ?? [];
    return poly.map(([x, y]) => [x, y, z]);
  };

  // Face plate and skirts: the wedge between the seam planes, hollowed above the face.
  const outer = g.M.hull([...ring(0), ...ring(SKIRT_D)]);
  const sk = SKIRT_T + o.side;
  const skirtVoid = g.M.hull([...inset(ring2(FACE_T), sk, FACE_T), ...inset(ring2(SKIRT_D + 1), sk, SKIRT_D + 1)]);

  // Funnel from the corner-chopped face up to the pixel collar, 45° so it prints support-free.
  const E = (i: number, j: number, d: number): Vec3 => add(p[i], scale(norm(sub(p[j], p[i])), d));
  const chop = (d: number): P2[] => p.flatMap((_, i) => [E(i, (i + n - 1) % n, d), E(i, (i + 1) % n, d)]).map((q) => [q[0], q[1]] as P2);
  const hexIn = g.poly(chop(o.rc)).offset(-(sk + 0.4), 'Miter');
  const cavBase = hexIn.offset(-FUNNEL_W, 'Miter');
  const cavPts = (cavBase.toPolygons() as unknown as P2[][])[0] ?? [];
  const reach = cavPts.length ? Math.max(...cavPts.map(([x, y]) => Math.hypot(x, y))) : 20;

  const pr = pixelR(o.pixel);
  const node = o.pixel.form === 'node';
  const sockR = pr + o.seat;
  const topR = node ? sockR + 1.2 : Math.max(2, pr - 1);
  const collarR = sockR + (node ? 2.5 : 2);
  const hf = FACE_T + Math.max(18, reach - topR);
  const collarT = node ? COLLAR_T : 1.2 + o.pixel.shape.depth + 0.4;
  const funnel = g.M.hull([g.extrude(hexIn, FACE_T - 0.3, FACE_T), g.cylZ(collarR, hf, hf + collarT)]);
  const cavity = g.M.hull([g.extrude(cavBase, FACE_T, FACE_T + 0.01), g.cylZ(topR, hf - 0.01, hf)]);
  // A node pushes into the collar from inside and aims back at the face. A PCB drops into a
  // pocket from inside, LEDs toward the face, and sits on a 1.2 mm lip.
  const sockets = node
    ? [g.place(socketCutter(g, o.pixel, { tol: o.seat }), mul(T(0, 0, hf - 1), Rx(180)))]
    : [g.place(socketCutter(g, o.pixel, { tol: o.seat, over: 0.01 }), mul(T(0, 0, hf + 1.2), Rx(180))), g.cylZ(sockR, hf + 1.7, hf + collarT + 1)];

  // Cap joint: a screw boss in each corner along the spoke, and a round hole around the vertex
  // for the cap spigot.
  const bosses: Manifold[] = [];
  const cuts: Manifold[] = [];
  if (o.caps) {
    for (let i = 0; i < n; i++) {
      const a = norm(sub(p[(i + 1) % n], p[i]));
      const b = norm(sub(p[(i + n - 1) % n], p[i]));
      const q = add(p[i], scale(norm(add(a, b)), o.caps.bossD));
      const Fq = frameZ(S[i], perp(S[i]), q);
      bosses.push(g.place(g.cylZ(BOSS_R, -0.5, BOSS_H), Fq));
      cuts.push(g.place(g.cylZ(1.25, -1, BOSS_H + 2), Fq));
      cuts.push(g.place(g.cylZ(o.caps.holeR, -2, BOSS_H + 4), frameZ(S[i], perp(S[i]), p[i])));
    }
  }
  // Seam skirts sit half the fit gap back from the seam plane.
  for (let k = 0; k < n; k++) {
    if (f.edges[k] !== 'seam') continue;
    const e = sub(p[(k + 1) % n], p[k]);
    let nn = norm(cross(e, S[k]));
    if (dot(nn, scale(p[k], -1)) > 0) nn = scale(nn, -1);
    cuts.push(g.place(g.box([-BIG, -BIG, 0], [BIG, BIG, BIG]), frameZ(nn, perp(nn), sub(p[k], scale(nn, o.side)))));
  }
  const tongues: Manifold[] = [];
  if (o.tongue)
    for (let k = 0; k < n; k++) {
      if (f.edges[k] !== 'tongue') continue;
      const t = o.tongue(f, k);
      if (t) tongues.push(g.place(t, Mi));
    }

  const hullB = g.M.hull([...ring(0), ...ring(BOSS_H + 1)]);
  const body = g.union([g.cut(outer, [skirtVoid]), bosses.length ? g.union(bosses).intersect(hullB) : null, funnel, ...tongues]);
  return { solid: g.cut(body, [cavity, ...sockets, ...cuts]), hf, collarR };
}

/* ------------------------------------------------------------------ */
/* Vertex caps                                                         */
/* ------------------------------------------------------------------ */

/** Cap print frame: flat outer top on z=0, spigot side up (+z inward). */
export function capFrame(plan: ShellPlan, v: ShellVertex): Mat4 {
  const nV = scale(v.spoke, -1);
  const toN = sub(plan.verts[v.nbrs[0]].p, v.p);
  const x = norm(sub(toN, scale(nV, dot(toN, nV))));
  return basis(x, cross(v.spoke, x), v.spoke, add(v.p, scale(nV, CAP_T)));
}

/** Instances of a vertex class. */
export function vertexInstances(plan: ShellPlan, cls: ShellClass, frame: Mat4): Mat4[] {
  const v = plan.verts[cls.rep];
  return cls.members.map((m) => {
    const w = plan.verts[m];
    return mul(T(...w.p), rotMat4(w.rot), T(...scale(v.p, -1)), frame);
  });
}

/**
 * A vertex cap in its print frame. It covers the dark corners of every panel at the vertex,
 * drops its spigot into their corner hole, and takes a countersunk screw into each corner boss.
 * `keep` (assembled frame) trims a rim cap to the half above the base.
 */
export function buildCap(g: Geo, plan: ShellPlan, v: ShellVertex, j: CapJoints, rc: number, o: { accent: boolean; keep?: Manifold }): { solid: Manifold; frame: Mat4 } {
  const F = capFrame(plan, v);
  const Fi = invert(F);
  const Vc = apply(Fi, v.p);
  const Es = v.nbrs.map((k) => apply(Fi, add(v.p, scale(norm(sub(plan.verts[k].p, v.p)), rc))));
  const outline: P2[] = [];
  v.nbrs.forEach((_, k) => {
    outline.push([Es[k][0], Es[k][1]]);
    if (v.faces[k] < 0) outline.push([Vc[0], Vc[1]]);
  });
  const zmax = Math.max(...Es.map((e) => e[2]), Vc[2]);
  const body = g.extrude(g.poly(outline), 0, zmax + 0.01);
  const beyond = g.M.hull([Vc, ...Es, add(Vc, [0, 0, 60]), ...Es.map((e) => add(e, [0, 0, 60]))]);
  const holes: Manifold[] = [];
  v.faces.forEach((fi) => {
    if (fi < 0) return;
    const f = plan.faces[fi];
    const q = apply(Fi, cornerPoint(f, f.v.indexOf(v.idx), j.bossD));
    holes.push(g.cylZ(1.7, -1, zmax + 2, q[0], q[1]), g.coneZ(3.4, 1.7, -0.01, 1.7, q[0], q[1]));
  });
  const spigot = g.cylZ(j.spigR, 0.5, CAP_T + SPIG_L);
  let solid = g.union([g.cut(body, [beyond, ...holes]), spigot]);
  if (o.accent && j.accent) {
    const px = j.accent;
    const depth = px.shape.depth;
    const zPcb = CAP_T + SPIG_L - depth;
    const sockR = pixelR(px) + j.seat;
    solid = g.cut(solid, [
      g.cylZ(j.lensBoreR, -1, LENS_T),
      g.cylZ(Math.max(2, pixelR(px) - 0.8), -1, zPcb + 0.01),
      g.place(socketCutter(g, px, { tol: j.seat, over: 0.01, wire: 0 }), mul(T(0, 0, zPcb), Rx(180))),
      g.cylZ(sockR, zPcb + 0.5, CAP_T + SPIG_L + 1),
    ]);
  }
  if (o.keep) solid = solid.intersect(g.place(o.keep, Fi));
  return { solid, frame: F };
}

/** The diffuser lens over a cap's accent pixel: a disc that drops into the fit-gap counterbore. */
export function lensSolid(g: Geo, j: CapJoints): Manifold {
  return g.union([g.coneZ(j.lensR - 0.3, j.lensR, 0, 0.3), g.cylZ(j.lensR, 0.3, LENS_T)]);
}

/** Crown: a cap with a 45° boss outside for the 1/8 IPS nipple, printed boss-down. */
export function buildCrown(g: Geo, plan: ShellPlan, v: ShellVertex, j: CapJoints, rc: number): { solid: Manifold; instance: Mat4 } {
  const { solid, frame } = buildCap(g, plan, v, j, rc, { accent: false });
  const Fi = invert(frame);
  const Es = v.nbrs.map((k) => apply(Fi, add(v.p, scale(norm(sub(plan.verts[k].p, v.p)), rc))));
  const prism = g.extrude(g.poly(Es.map((e) => [e[0], e[1]] as P2)), -22, 0.01);
  const boss = g.place(g.coneZ(31, 11, 0, 20), Rx(180)).intersect(prism);
  const crown = g.cut(g.union([solid, boss]), [g.cylZ(PIPE_R, -30, 30)]);
  const lay = layFlat(g, crown, Rx(180), frame);
  return { solid: lay.solid, instance: lay.instance };
}

/* ------------------------------------------------------------------ */
/* Capped shells: panels + caps + crown + lenses                       */
/* ------------------------------------------------------------------ */

export interface CappedShellOpts {
  params: Params;
  split: SplitCfg;
  facePixel: PixelType;
  accent: PixelType | null;
  crown: boolean;
  /** Panel tongues for rim edges (assembled frame). */
  tongue?: (f: ShellFace, k: number) => Manifold | null;
  /** Assembled keep-region for rim caps. */
  rimKeep?: Manifold;
}

export interface CappedShell {
  parts: PartSpec<Manifold>[];
  j: CapJoints;
  rc: number;
  tight: boolean;
  splitPieces: number;
  splitPins: number;
  hf: number;
}

export function buildCappedShell(g: Geo, plan: ShellPlan, o: CappedShellOpts): CappedShell {
  const j = capJoints(o.params, o.accent, o.crown);
  const { rc, tight } = capRegion(plan, j);
  const parts: PartSpec<Manifold>[] = [];
  let splitPieces = 0;
  let splitPins = 0;
  let hf = 0;
  for (const cls of plan.faceClasses) {
    const f = plan.faces[cls.rep];
    const pb = buildPanel(g, plan, f, { side: j.side, seat: j.seat, pixel: o.facePixel, rc, caps: j, tongue: o.tongue });
    hf = Math.max(hf, pb.hf);
    const instances = faceInstances(plan, cls);
    const sides = `${f.pts.length}-sided`;
    const base = {
      id: `panel-${cls.id}`,
      name: `Panel ${cls.id} (${sides})`,
      role: 'diffuser' as const,
      note: `Face down, natural or white PETG. One ${o.facePixel.name} ${o.facePixel.form === 'node' ? 'pushes into the collar' : 'drops into the collar pocket'} from inside.`,
    };
    if (o.split.on) {
      const sp = splitToBed(g, pb.solid, o.split.printer, { ...o.split.opts, tol: j.side, keepOut: [{ p: [0, 0, 0], r: pb.collarR + 4 }] });
      parts.push(...splitParts(sp, base, instances));
      if (sp.pieces > 1) {
        splitPieces += sp.pieces * instances.length;
        splitPins += sp.pins * instances.length;
      }
    } else parts.push({ ...base, solid: pb.solid, instances });
  }

  const lensInst: Mat4[] = [];
  for (const cls of plan.vertexClasses) {
    const v = plan.verts[cls.rep];
    if (v.top) {
      const c = buildCrown(g, plan, v, j, rc);
      parts.push({
        id: 'crown',
        name: 'Crown',
        role: 'body',
        solid: c.solid,
        instances: [c.instance],
        explode: [0, 0, 1],
        note: `1/8 IPS nipple through the crown and the panel corners; lock nut and fender washer inside. Its spigot drops into the top corner hole with a ${fmtGap(j.fit)} gap. Prints boss-down.`,
      });
      continue;
    }
    const accent = !!o.accent && !v.rim;
    const { solid, frame } = buildCap(g, plan, v, j, rc, { accent, keep: v.rim ? o.rimKeep : undefined });
    const instances = vertexInstances(plan, cls, frame);
    if (accent) lensInst.push(...instances);
    const ways = v.faces.filter((x) => x >= 0).length;
    parts.push({
      id: `cap-${cls.id}`,
      name: `${v.rim ? 'Rim cap' : 'Vertex cap'} ${cls.id} (${ways}-way)`,
      role: 'body',
      solid,
      instances,
      note: `Flat top on the plate. Spigot into the corner hole (${fmtGap(j.fit)} gap); countersunk M3 self-tappers into the panel corner bosses.${accent ? ` One ${o.accent!.name} pushes into the spigot from the inside, LEDs out.` : ''}`,
    });
  }
  if (lensInst.length)
    parts.push({
      id: 'lens',
      name: 'Accent lens',
      role: 'diffuser',
      solid: lensSolid(g, j),
      instances: lensInst,
      note: `Natural PETG, chamfer down. Drops into the cap counterbore (${fmtGap(j.fit)} gap); a drop of clear CA holds it.`,
    });
  return { parts, j, rc, tight, splitPieces, splitPins, hf };
}

export const fmtGap = (v: number) => `${v.toFixed(2).replace(/0$/, '')} mm`;

/* ------------------------------------------------------------------ */
/* Bands: polygonal rings the panels stand in                          */
/* ------------------------------------------------------------------ */

/** A panel face in a band's section plane: apothem a(z) = a0 + s·(z − z0); z0 is the panel edge. */
export interface FaceLine {
  a0: number;
  z0: number;
  s: number;
}

/**
 * Tongue (clear = 0) or groove (clear = fit/2) section in (apothem, z): the face plate carried
 * `TONGUE_D` past the panel edge, `dir` −1 down / +1 up. `open` runs back past the edge, into the
 * panel for a tongue and out of the band for a groove.
 */
export function tongueSection(L: FaceLine, dir: 1 | -1, clear: number, open: number): P2[] {
  const af = (z: number) => L.a0 + L.s * (z - L.z0);
  const zFar = L.z0 + dir * (TONGUE_D + clear);
  const zNear = L.z0 - dir * open;
  return [
    [af(zFar) - TONGUE_T - clear, zFar],
    [af(zFar) + clear, zFar],
    [af(zNear) + clear, zNear],
    [af(zNear) - TONGUE_T - clear, zNear],
  ];
}

/** Outermost apothem of the groove for a face line, clearance included. dir −1: panel above the band. */
export function grooveReach(L: FaceLine, dir: 1 | -1, side: number): number {
  const af = (z: number) => L.a0 + L.s * (z - L.z0);
  return Math.max(af(L.z0), af(L.z0 + dir * (TONGUE_D + side))) + side;
}

/** Slot for a strip standing on edge, LEDs out: radial width and depth, with the seat clearance. */
export function stripSlot(strip: PixelType | null, seat: number): { w: number; d: number } | null {
  if (!strip || strip.shape.kind !== 'strip') return null;
  return { w: strip.shape.depth + 2 * seat, d: strip.shape.width + seat + 0.5 };
}

export interface BandSpec {
  n: number;
  /** Angle of polygon vertex 0, rad. */
  theta0: number;
  z0: number;
  h: number;
  aOut: number;
  aIn: number;
  /** Panel above (its bottom edge on the band top) and below, per side. */
  above?: (i: number) => FaceLine | null;
  below?: (i: number) => FaceLine | null;
  /** Strip slot behind the lip: radial width, depth from the open face. */
  slot?: { w: number; d: number; from: 'top' | 'bottom' } | null;
  /** Vertical holes at polygon corners (every `every`-th), hardware sizes. */
  holes?: { a: number; r: number; every: number; csk?: boolean } | null;
  side: number;
}

const half = (s: BandSpec) => Math.PI / s.n;

/** Section of side i in (apothem, z). */
function bandSection(g: Geo, s: BandSpec, i: number): CrossSection {
  const base = g.poly([
    [s.aIn, s.z0],
    [s.aOut, s.z0],
    [s.aOut, s.z0 + s.h],
    [s.aIn, s.z0 + s.h],
  ]);
  const cuts: P2[][] = [];
  const up = s.above?.(i);
  const dn = s.below?.(i);
  if (up) cuts.push(tongueSection(up, -1, s.side, 1));
  if (dn) cuts.push(tongueSection(dn, 1, s.side, 1));
  if (s.slot) {
    const a1 = s.aOut - LIP;
    const a0 = a1 - s.slot.w;
    const [z0, z1] = s.slot.from === 'top' ? [s.z0 + s.h - s.slot.d, s.z0 + s.h + 1] : [s.z0 - 1, s.z0 + s.slot.d];
    cuts.push([
      [a0, z0],
      [a1, z0],
      [a1, z1],
      [a0, z1],
    ]);
  }
  return cuts.length ? base.subtract(g.CS.union(cuts.map((c) => g.poly(c)))) : base;
}

/** Side i's segment: the section run along the side, mitred on the radial planes through its corners. */
function bandSegment(g: Geo, s: BandSpec, i: number): Manifold {
  const h = half(s);
  const phi = s.theta0 + (2 * i + 1) * h;
  const L = 2 * s.aOut * Math.tan(h) + 40;
  const nu: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
  const tau: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
  const solid = g.place(bandSection(g, s, i).extrude(L).translate([0, 0, -L / 2]), basis(nu, [0, 0, 1], scale(tau, -1)));
  const Rb = (s.aOut / Math.cos(h)) * 1.5 + 50;
  const t0 = s.theta0 + 2 * i * h;
  const t1 = t0 + 2 * h;
  const wedge = g.extrude(
    g.poly([
      [0, 0],
      [Rb * Math.cos(t0), Rb * Math.sin(t0)],
      [Rb * Math.cos(t1), Rb * Math.sin(t1)],
    ]),
    s.z0 - 10,
    s.z0 + s.h + 10,
  );
  return solid.intersect(wedge);
}

const lineKey = (L: FaceLine | null | undefined) => (L ? `${L.a0.toFixed(3)}/${L.z0.toFixed(3)}/${L.s.toFixed(5)}` : '-');

/** The whole band ring in the assembled frame. Identical sides are built once and turned. */
export function buildBand(g: Geo, s: BandSpec): Manifold {
  const made = new Map<string, { i: number; m: Manifold }>();
  const segs: Manifold[] = [];
  for (let i = 0; i < s.n; i++) {
    const key = `${lineKey(s.above?.(i))}|${lineKey(s.below?.(i))}`;
    const hit = made.get(key);
    if (hit) segs.push(g.place(hit.m, Rz(((i - hit.i) * 360) / s.n)));
    else {
      const m = bandSegment(g, s, i);
      made.set(key, { i, m });
      segs.push(m);
    }
  }
  let ring = g.union(segs);
  if (s.holes) {
    const cut: Manifold[] = [];
    const rr = s.holes.a / Math.cos(half(s));
    for (let i = 0; i < s.n; i += s.holes.every) {
      const t = s.theta0 + 2 * i * half(s);
      const [x, y] = [rr * Math.cos(t), rr * Math.sin(t)];
      cut.push(g.cylZ(s.holes.r, s.z0 - 1, s.z0 + s.h + 1, x, y));
      if (s.holes.csk) cut.push(g.coneZ(s.holes.r, s.holes.r + 2.6, s.z0 + s.h - 2.6, s.z0 + s.h + 0.01, x, y));
    }
    ring = g.cut(ring, cut);
  }
  return ring;
}

/** A panel's tongue on a band side (assembled frame), clipped to the side's sector less the fit gap. */
export function tongueSolid(g: Geo, s: { n: number; theta0: number; side: number }, i: number, L: FaceLine, dir: 1 | -1, reach: number): Manifold {
  const h = Math.PI / s.n;
  const phi = s.theta0 + (2 * i + 1) * h;
  const nu: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
  const tau: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
  const Lx = 2 * reach * Math.tan(h) + 40;
  const sec = g.poly(tongueSection(L, dir, 0, 0.3));
  const solid = g.place(sec.extrude(Lx).translate([0, 0, -Lx / 2]), basis(nu, [0, 0, 1], scale(tau, -1)));
  const Rb = reach * 2 + 50;
  const t0 = s.theta0 + 2 * i * h;
  const t1 = t0 + 2 * h;
  const sector = g
    .poly([
      [0, 0],
      [Rb * Math.cos(t0), Rb * Math.sin(t0)],
      [Rb * Math.cos(t1), Rb * Math.sin(t1)],
    ])
    .offset(-s.side, 'Miter');
  const zs = [L.z0 - TONGUE_D - 5, L.z0 + TONGUE_D + 5];
  return solid.intersect(g.extrude(sector, zs[0], zs[1]));
}

/** Strip LEDs around a band, CCW from vertex 0 plus half a pitch, at the band's outer face. */
export function bandStrip(s: BandSpec, pitch: number, zLed: number, unit: string, reverse = false): { pixels: PixelPlacement[]; mm: number } {
  const h = half(s);
  const aL = s.aOut - LIP;
  const sideLen = 2 * aL * Math.tan(h);
  const total = sideLen * s.n;
  const count = Math.floor(total / pitch);
  const pixels: PixelPlacement[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) * pitch;
    const i = Math.min(s.n - 1, Math.floor(t / sideLen));
    const u = t - i * sideLen - sideLen / 2;
    const phi = s.theta0 + (2 * i + 1) * h;
    const nu: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
    const tau: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
    pixels.push({ pos: [nu[0] * s.aOut + tau[0] * u, nu[1] * s.aOut + tau[1] * u, zLed], normal: nu, unit });
  }
  if (reverse) pixels.reverse();
  return { pixels, mm: count * pitch };
}

/** Prints a band: lay it on z=0, split it into identical arcs that fit, place it at each height. */
export function bandParts(g: Geo, ring: Manifold, s: BandSpec, split: SplitCfg, base: { id: string; name: string; role: 'body' | 'diffuser'; note: string }, heights: number[]): { parts: PartSpec<Manifold>[]; pieces: number; pins: number } {
  const solid = g.place(ring, T(0, 0, -s.z0));
  const instances = heights.map((z) => T(0, 0, z));
  if (!split.on) return { parts: [{ ...base, solid, instances }], pieces: 1, pins: 0 };
  const deg = (r: number) => (r * 180) / Math.PI;
  const midSide = deg(s.theta0 + half(s));
  let sp = splitToBed(g, solid, split.printer, { ...split.opts, tol: s.side, mode: 'radial', sectors: (k) => s.n % k === 0, phase: () => midSide });
  if (!sp.fits) {
    const corners = Array.from({ length: s.n }, (_, i) => ({ angle: deg(s.theta0 + 2 * i * half(s)), half: 4 }));
    sp = splitToBed(g, solid, split.printer, { ...split.opts, tol: s.side, mode: 'radial', avoid: corners });
  }
  return { parts: splitParts(sp, base, instances), pieces: sp.pieces, pins: sp.pins };
}

/* ------------------------------------------------------------------ */
/* Paperwork helpers                                                   */
/* ------------------------------------------------------------------ */

/** One pixel (or one PCB's LEDs) per face, in face data order. */
export function facePixels(plan: ShellPlan, pixel: PixelType, unit: string): PixelPlacement[] {
  return plan.order.flatMap((fi) => {
    const f = plan.faces[fi];
    return pixelsAt(pixel, f.c, f.n, norm(sub(f.pts[0], f.c)), unit);
  });
}

/** One accent per vertex cap, in vertex data order, read at the lens face. */
export function starPixels(plan: ShellPlan, accent: PixelType | null, unit: string): PixelPlacement[] {
  if (!accent) return [];
  return plan.vertOrder.flatMap((vi) => {
    const v = plan.verts[vi];
    const F = capFrame(plan, v);
    const nV = scale(v.spoke, -1);
    return pixelsAt(accent, add(v.p, scale(nV, CAP_T)), nV, [F[0], F[1], F[2]], unit);
  });
}

/** Schedule line for the face pixels. */
export function faceLine(plan: ShellPlan, pixel: PixelType, unit: string, purpose: string): ScheduleLine {
  const F = plan.faces.length;
  const strand = pixel.strandLength;
  const notes = strand
    ? `${Math.ceil(F / strand)} strand${Math.ceil(F / strand) === 1 ? '' : 's'} of ${strand} chained in face order. Inject ${pixel.volts} V at the start of each strand.`
    : `Hand-wired chain panel to panel in face order. Inject ${pixel.volts} V every ${Math.max(1, Math.floor(60 / pixel.pxPerUnit))} panels.`;
  return { unit, position: `Faces 1–${F}`, purpose, pixelId: pixel.id, units: F, px: F * pixel.pxPerUnit, notes };
}

/** Schedule line for the vertex stars. */
export function starLine(plan: ShellPlan, accent: PixelType, unit: string, crown: boolean): ScheduleLine {
  const n = plan.vertOrder.length;
  return {
    unit,
    position: `Vertices 1–${n}`,
    purpose: 'Vertex stars, top band first',
    pixelId: accent.id,
    units: n,
    px: n * accent.pxPerUnit,
    notes: `Hand-wired chain cap to cap in vertex order${crown ? ' (the crown has none)' : ''}. Its own data output, or chained after the faces. Inject 5 V every ${Math.max(1, Math.floor(60 / accent.pxPerUnit))} caps.`,
  };
}

/** Wire run along a data order, mm. */
export const runMm = (pts: Vec3[]) => pts.reduce((s, p, k) => (k ? s + dist(p, pts[k - 1]) : s), 0);

/** Hardware for the cap joints (and the star chain). */
export function capHardware(plan: ShellPlan, accent: PixelType | null): HardwareLine[] {
  const corners = plan.faces.reduce((s, f) => s + f.pts.length, 0);
  const out: HardwareLine[] = [{ item: 'M3×12 countersunk self-tapping screw (plastic)', qty: corners, note: 'Vertex caps into panel corner bosses' }];
  if (accent) {
    const run = runMm(plan.vertOrder.map((vi) => plan.verts[vi].p));
    out.push({ item: '3-core 26 AWG ribbon (5 V, data, GND)', qty: Math.max(1, Math.ceil((run * 1.3) / 1000)), note: `Metres, cap to cap for the stars (${plan.vertOrder.length} PCBs)` });
    out.push({ item: 'Clear CA glue', qty: 1, note: 'One drop per accent lens' });
  }
  return out;
}

/** Crown hanging hardware. */
export function crownHardware(pixel: PixelType): HardwareLine[] {
  return [
    { item: '1/8 IPS threaded nipple, 40 mm', qty: 1, note: 'Through the crown and the top vertex' },
    { item: '1/8 IPS lock nut + Ø25 mm fender washer', qty: 1, note: 'Inside, against the top corner bosses' },
    { item: '1/8 IPS screw-collar loop', qty: 1, note: 'Hangs the shell' },
    { item: 'Chandelier chain, rated ≥ 4× the fixture weight', qty: 1, note: 'Power cable woven through the links down to the loop' },
    { item: `${pixel.volts === 5 ? '2-core 1.5 mm² (16 AWG)' : '2-core 0.75 mm² (18 AWG)'} + data pair`, qty: 1, note: 'Power down the hoist line, through the nipple' },
    { item: 'Nylon cord grip for 1/8 IPS', qty: 1, note: 'Strain relief at the nipple: the cable never carries the shell' },
  ];
}

/** Assembly for a shell hung from its crown and closed with vertex caps. */
export function crownAssembly(plan: ShellPlan, parts: PartSpec<Manifold>[], j: CapJoints, pixel: PixelType, accent: PixelType | null): AssemblyStep[] {
  const panels = ids(parts, ...plan.faceClasses.map((c) => `panel-${c.id}`));
  const caps = ids(parts, ...plan.vertexClasses.filter((c) => c.id !== 'crown').map((c) => `cap-${c.id}`));
  const corners = plan.faces.reduce((s, f) => s + f.pts.length, 0);
  const steps: AssemblyStep[] = [];
  if (accent)
    steps.push({
      title: 'Fit the vertex stars',
      parts: [...caps, 'lens'],
      hardware: `${plan.vertOrder.length}× ${accent.name}, clear CA`,
      note: 'Push a PCB into each cap spigot from the inside, LEDs out, and drop a lens into each counterbore with a drop of CA. Number the caps in vertex data order and pre-solder 150 mm tails.',
    });
  steps.push(
    {
      title: 'Seat the face pixels',
      parts: panels,
      hardware: `${plan.faces.length}× ${pixel.name}`,
      note: `${pixel.form === 'node' ? 'Push a node into every panel collar from inside' : 'Drop a PCB into every collar pocket from inside, LEDs toward the face, with a dot of hot glue'}. Mark each panel with its face number so the chain runs in data order.`,
    },
    {
      title: 'Hang the crown',
      parts: ['crown'],
      hardware: '1/8 IPS nipple, lock nut, fender washer, screw-collar loop, cord grip',
      note: 'Thread the nipple through the crown, hang it on the chain at working height and feed the power and data cable down through the pipe.',
    },
    {
      title: 'Build down from the crown',
      parts: [...panels, ...caps],
      hardware: `${corners}× M3×12 countersunk self-tapper`,
      note: `Offer the top panels up to the crown spigot, washer and nut inside. Then work band by band: at each new vertex the cap spigot drops into the round corner hole (${fmtGap(j.fit)} gap) and one screw goes into every panel corner. Leave a vertex open low down to reach in for wiring.`,
    },
    {
      title: 'Wire, test and close',
      hardware: 'Cable ties',
      note: `Plug the face chain in data order${accent ? ' and the star chain to its own output' : ''}, run a test pattern, then fit the last panels and caps from the outside.`,
    },
  );
  return steps;
}

export const ids = (parts: PartSpec<Manifold>[], ...prefixes: string[]) => parts.filter((p) => prefixes.some((x) => p.id === x || p.id.startsWith(`${x}-`))).map((p) => p.id);

export const copies = (parts: PartSpec<Manifold>[]) => parts.reduce((s, p) => s + p.instances.length, 0);

/** Hidden params every shell shares are in FIT_PARAMS and SPLIT_PARAMS; this is the accent choice. */
export function accentParam(key: string, label: string, ids_: string[], def: string, help: string): ParamSpec {
  return { key, label, type: 'select', default: def, options: pixelOptions(ids_, 'None'), group: 'Pixels', help };
}

export const ACCENT_PCBS = ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw', 'jewel-7-ws2812b'];
