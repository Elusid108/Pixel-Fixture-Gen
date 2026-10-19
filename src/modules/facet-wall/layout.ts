import { decodeImage, imageFrom, sampleImage, type GrayImage } from '../../fixtures/image';
import { letters } from '../../geom/vec';
import { bounds2, distToPolygon, pointInPolygon } from '../../sketch/geom';
import type { Vec2 } from '../../sketch/types';
import type { Params } from '../../types';
import { bedOf } from '../shared/params';
import type { FwArea, FwDesign, Level } from './model';
import { fwDims, type FwDims } from './params';

/**
 * M5 Facet Wall layout: pure, shared by the build, the bench and the tests.
 *
 * The grid: lattice point (a, b) sits at (a·s + b·s/2, b·h) in plane coords, h = s·√3/2.
 * Up facet (a, b, u) has corners (a,b) (a+1,b) (a,b+1); down facet (a, b, d) has corners
 * (a+1,b) (a+1,b+1) (a,b+1). Only whole triangles inside an outline (and clear of its holes)
 * become facets. Backer tiles are big triangles k facets on a side in the same lattice, so
 * up and down tiles are the same part turned 180°; tiles cut by the outline are partial
 * patches, deduped up to the lattice's 60° rotations.
 */

export const SQ3 = Math.sqrt(3);
const EPS = 1e-6;

export interface Facet {
  key: string;
  a: number;
  b: number;
  up: boolean;
  corners: [Vec2, Vec2, Vec2];
  centroid: Vec2;
  /** Driver value after start/end/invert, 0–1. */
  value: number;
  /** Depth the driver gives, and the depth used (an override wins). */
  auto: Level;
  level: Level;
  overridden: boolean;
  omitted: boolean;
  /** Backer tile id, '' when knocked out. */
  tile: string;
  /** Position in the data chain, -1 when knocked out. */
  order: number;
}

export interface PatchEdge {
  a: Vec2;
  b: Vec2;
  mid: Vec2;
  /** Unit outward normal (in the plane). */
  n: Vec2;
  /** Unit direction a → b. */
  t: Vec2;
}

/** One backer part: a patch shape, its features in its own frame, and the tiles that use it. */
export interface TileClass {
  id: string;
  key: string;
  members: string[];
  full: boolean;
  /** Canonical facet triangles and centroids, plane mm, centred on the patch's bounding box. */
  tris: [Vec2, Vec2, Vec2][];
  centroids: Vec2[];
  perimeter: PatchEdge[];
  /** Wall-screw boss centres. */
  screws: Vec2[];
  /** Bounding box of the patch (w along canonical x, h along y). */
  size: [number, number];
  /** Turn on the bed (degrees, about Z, applied to the face-down part) so it fits the printer. */
  printRot: number;
  /** Small edge pieces folded into a neighbour, so the patch is not part of a single big triangle. */
  merged: boolean;
}

export interface Tile {
  id: string;
  cls: string;
  /** Big-triangle cell (I, J) and orientation in the tile lattice. */
  I: number;
  J: number;
  bigUp: boolean;
  /** Facet keys in data order. */
  facets: string[];
  centroid: Vec2;
  /** Canonical class geometry → wall plane: p = rot(rotDeg)·(c + shift). */
  rotDeg: number;
  shift: Vec2;
  /** Perimeter edges in plane coords (the tile outline). */
  outline: [Vec2, Vec2][];
  /** Perimeter edges that meet a neighbouring tile (magnets go in pairs on these). */
  shared: number;
  screws: number;
  /** Number of facets at each depth. */
  depths: [number, number, number];
}

export interface Gap {
  from: string;
  to: string;
  mm: number;
}

export interface FwLayout {
  dims: FwDims;
  side: number;
  h: number;
  /** Tile size in facets per side, and the bed it was sized for. */
  k: number;
  bedName: string;
  /** Every facet inside the outlines (knocked-out ones included). */
  facets: Facet[];
  byKey: Map<string, Facet>;
  /** Live facets in data order. */
  chain: Facet[];
  tiles: Tile[];
  classes: TileClass[];
  /** Live facets at each depth. */
  counts: [number, number, number];
  /** Node-to-node distances that exceed the strand lead, in chain order. */
  longGaps: Gap[];
  maxGap: number;
  /** Centre-to-centre spacing of neighbouring facets, s/√3. */
  spacing: number;
  /** Bounds of all outlines, plane coords. */
  bounds: { min: Vec2; max: Vec2 };
  warnings: string[];
}

/* ---------------- Grid ---------------- */

export const latticePt = (a: number, b: number, s: number): Vec2 => [s * (a + b / 2), ((s * SQ3) / 2) * b];

export const facetKey = (a: number, b: number, up: boolean) => `${a},${b},${up ? 'u' : 'd'}`;

export function parseKey(key: string): { a: number; b: number; up: boolean } | null {
  const m = /^(-?\d+),(-?\d+),([ud])$/.exec(key);
  return m ? { a: Number(m[1]), b: Number(m[2]), up: m[3] === 'u' } : null;
}

/** Integer lattice corners of a facet. */
function cornerIdx(a: number, b: number, up: boolean): [number, number][] {
  return up
    ? [
        [a, b],
        [a + 1, b],
        [a, b + 1],
      ]
    : [
        [a + 1, b],
        [a + 1, b + 1],
        [a, b + 1],
      ];
}

export function facetCorners(a: number, b: number, up: boolean, s: number): [Vec2, Vec2, Vec2] {
  return cornerIdx(a, b, up).map(([x, y]) => latticePt(x, y, s)) as [Vec2, Vec2, Vec2];
}

const centroidOf = (c: Vec2[]): Vec2 => [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3];

/* ---------------- Inside test ---------------- */

const orient = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

/** Segments cross at a single interior point of both (touching and collinear overlap don't count). */
function properCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  const e = 1e-7 * (1 + Math.abs(d1) + Math.abs(d2) + Math.abs(d3) + Math.abs(d4));
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

/** Strictly inside a triangle (not on its edges). */
function strictlyInTri(p: Vec2, t: Vec2[]): boolean {
  const s = Math.sign(orient(t[0], t[1], t[2]));
  const tol = 1e-6 * Math.abs(orient(t[0], t[1], t[2]));
  return [0, 1, 2].every((i) => s * orient(t[i], t[(i + 1) % 3], p) > tol);
}

const onLoop = (p: Vec2, loop: Vec2[]) => distToPolygon(p, loop) < 1e-4;
const loopEdges = (loop: Vec2[]): [Vec2, Vec2][] => loop.map((p, i) => [p, loop[(i + 1) % loop.length]] as [Vec2, Vec2]);

/**
 * A whole triangle inside an outline and clear of its holes: all three corners inside or on
 * the outer loop and not strictly inside a hole, its centroid strictly inside the region, no
 * loop edge crossing a triangle edge and no loop vertex strictly inside the triangle.
 */
export function triangleInside(tri: Vec2[], outer: Vec2[], holes: Vec2[][] = []): boolean {
  for (const c of tri) {
    if (!(pointInPolygon(c, outer) || onLoop(c, outer))) return false;
    for (const h of holes) if (pointInPolygon(c, h) && !onLoop(c, h)) return false;
  }
  const g = centroidOf(tri);
  if (!pointInPolygon(g, outer) || holes.some((h) => pointInPolygon(g, h))) return false;
  for (const loop of [outer, ...holes]) {
    for (const v of loop) if (strictlyInTri(v, tri)) return false;
    for (const [p, q] of loopEdges(loop)) for (let i = 0; i < 3; i++) if (properCross(tri[i], tri[(i + 1) % 3], p, q)) return false;
  }
  return true;
}

/** Every whole facet inside one area, as lattice cells. */
export function facetsInArea(area: FwArea, s: number): { a: number; b: number; up: boolean }[] {
  if (area.outer.length < 3) return [];
  const h = (s * SQ3) / 2;
  const { min, max } = bounds2(area.outer);
  const out: { a: number; b: number; up: boolean }[] = [];
  const b0 = Math.floor(min[1] / h) - 1;
  const b1 = Math.ceil(max[1] / h) + 1;
  for (let b = b0; b <= b1; b++) {
    const a0 = Math.floor((min[0] - (b + 1) * (s / 2)) / s) - 1;
    const a1 = Math.ceil((max[0] - b * (s / 2)) / s) + 1;
    for (let a = a0; a <= a1; a++) {
      for (const up of [true, false]) {
        const tri = facetCorners(a, b, up, s);
        const bb = bounds2(tri);
        if (bb.max[0] < min[0] - EPS || bb.min[0] > max[0] + EPS || bb.max[1] < min[1] - EPS || bb.min[1] > max[1] + EPS) continue;
        if (triangleInside(tri, area.outer, area.holes)) out.push({ a, b, up });
      }
    }
  }
  return out;
}

/* ---------------- Depth ---------------- */

let defaultImage: GrayImage | null = null;
/** Built-in heightmap: concentric ripples with a slight three-lobed wobble. */
export function defaultHeightmap(): GrayImage {
  if (!defaultImage) {
    defaultImage = imageFrom(64, 64, (u, v) => {
      const x = u - 0.5;
      const y = v - 0.5;
      const r = Math.hypot(x, y) * 2;
      const th = Math.atan2(y, x);
      return 0.5 + 0.5 * Math.cos(2 * Math.PI * 1.35 * r + 0.55 * Math.sin(3 * th));
    });
  }
  return defaultImage;
}

let imageCache: { param: string; img: GrayImage } | null = null;
export function heightmapOf(param: string): GrayImage {
  if (!param) return defaultHeightmap();
  if (imageCache?.param === param) return imageCache.img;
  const img = decodeImage(param) ?? defaultHeightmap();
  imageCache = { param, img };
  return img;
}

export const quantise = (w: number): Level => (w >= 2 / 3 - 1e-9 ? 2 : w >= 1 / 3 - 1e-9 ? 1 : 0);

/** Raw driver values (0–1) for facet centroids, before start/end/invert. */
export function driverValues(design: FwDesign, centroids: Vec2[], imageParam: string, bounds: { min: Vec2; max: Vec2 }): number[] {
  if (design.driver.kind === 'image') {
    const img = heightmapOf(imageParam);
    const W = Math.max(1e-6, bounds.max[0] - bounds.min[0]);
    const H = Math.max(1e-6, bounds.max[1] - bounds.min[1]);
    return centroids.map(([x, y]) => sampleImage(img, (x - bounds.min[0]) / W, 1 - (y - bounds.min[1]) / H));
  }
  const th = (design.driver.angle * Math.PI) / 180;
  const d: Vec2 = [Math.cos(th), Math.sin(th)];
  const t = centroids.map((c) => c[0] * d[0] + c[1] * d[1]);
  const lo = Math.min(...t);
  const hi = Math.max(...t);
  return t.map((v) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0.5));
}

/** Start/end window and invert, then clamp to 0–1. */
export function shape(raw: number, start: number, end: number, invert: boolean): number {
  let w = Math.abs(end - start) > 1e-9 ? (raw - start) / (end - start) : raw >= start ? 1 : 0;
  w = Math.min(1, Math.max(0, w));
  return invert ? 1 - w : w;
}

/* ---------------- Tiles ---------------- */

/** Largest tile (facets per side) whose big triangle fits the bed, either way round. */
export function tileSize(side: number, maxK: number, bed: { x: number; y: number }): number {
  const fits = (L: number, w: number, d: number) => L <= w + 1e-9 && L * (SQ3 / 2) <= d + 1e-9;
  let k = Math.max(1, Math.min(Math.floor(maxK), 8));
  while (k > 1 && !fits(k * side, bed.x, bed.y) && !fits(k * side, bed.y, bed.x)) k--;
  return k;
}

/** First turn (0–165°, 15° steps) at which the points' bounding box fits the bed, or null. */
export function fitAngle(pts: Vec2[], bed: { x: number; y: number }): number | null {
  for (let deg = 0; deg < 180; deg += 15) {
    const bb = bounds2(pts.map((p) => rotate(p, deg)));
    if (bb.max[0] - bb.min[0] <= bed.x + 1e-6 && bb.max[1] - bb.min[1] <= bed.y + 1e-6) return deg;
  }
  return null;
}

const edgeKeys = (f: { a: number; b: number; up: boolean }): string[] => {
  const c = cornerIdx(f.a, f.b, f.up);
  return [0, 1, 2].map((i) => [c[i].join(','), c[(i + 1) % 3].join(',')].sort().join('|'));
};

/**
 * Edge slivers (partial tiles of fewer than `small` facets, where the outline clips a big triangle)
 * join the neighbour they share most edges with, when the pair still fits the bed. Fewer tiny
 * parts, and no strand detour out to a lone facet and back.
 */
function mergeSlivers(groups: Map<string, Group>, small: number, full: number, bed: { x: number; y: number }) {
  for (let guard = 0; guard < 500; guard++) {
    const list = [...groups.entries()].filter(([, g]) => g.fs.length < small && g.fs.length < full).sort((p, q) => p[1].fs.length - q[1].fs.length);
    let merged = false;
    for (const [gk, g] of list) {
      const mine = new Set(g.fs.flatMap(edgeKeys));
      const shared: [string, number][] = [];
      for (const [ok, o] of groups) {
        if (ok === gk) continue;
        const n = o.fs.flatMap(edgeKeys).filter((e) => mine.has(e)).length;
        if (n) shared.push([ok, n]);
      }
      shared.sort((p, q) => q[1] - p[1] || groups.get(p[0])!.fs.length - groups.get(q[0])!.fs.length);
      for (const [ok] of shared) {
        const o = groups.get(ok)!;
        const all = [...o.fs, ...g.fs];
        if (fitAngle(all.flatMap((f) => f.corners), bed) === null) continue;
        o.fs = all;
        o.merged = true;
        groups.delete(gk);
        merged = true;
        break;
      }
      if (merged) break;
    }
    if (!merged) return;
  }
}

/** Big-triangle cell of a facet in the k-scaled lattice. */
function tileOf(a: number, b: number, up: boolean, k: number): { I: number; J: number; bigUp: boolean } {
  const A = (a + (up ? 1 / 3 : 2 / 3)) / k;
  const B = (b + (up ? 1 / 3 : 2 / 3)) / k;
  const I = Math.floor(A);
  const J = Math.floor(B);
  return { I, J, bigUp: A - I + (B - J) < 1 };
}

/** Facet centroid in thirds of the lattice (exact integers): up (3a+1, 3b+1), down (3a+2, 3b+2). */
const third = (f: { a: number; b: number; up: boolean }): [number, number] => (f.up ? [3 * f.a + 1, 3 * f.b + 1] : [3 * f.a + 2, 3 * f.b + 2]);
/** 60° lattice rotation about the origin, in lattice coords. */
const rot60 = ([A, B]: [number, number]): [number, number] => [-B, A + B];

interface Canon {
  key: string;
  r: number;
  /** Lattice translation (thirds) applied after rotation. */
  t: [number, number];
  pts: [number, number][];
}

/** Rotation/translation-invariant key of a patch, exact in integer lattice thirds. */
export function canonicalPatch(cells: { a: number; b: number; up: boolean }[]): Canon {
  let best: Canon | null = null;
  let pts = cells.map(third);
  for (let r = 0; r < 6; r++) {
    if (r) pts = pts.map(rot60);
    const t: [number, number] = [3 * Math.floor(Math.min(...pts.map((p) => p[0])) / 3), 3 * Math.floor(Math.min(...pts.map((p) => p[1])) / 3)];
    const moved = pts.map(([A, B]) => [A - t[0], B - t[1]] as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const key = moved.map((p) => p.join(',')).join(';');
    if (!best || key < best.key) best = { key, r, t, pts: moved };
  }
  return best!;
}

const rotate = ([x, y]: Vec2, deg: number): Vec2 => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [c * x - s * y, s * x + c * y];
};
const add2 = (p: Vec2, q: Vec2): Vec2 => [p[0] + q[0], p[1] + q[1]];
const sub2 = (p: Vec2, q: Vec2): Vec2 => [p[0] - q[0], p[1] - q[1]];
const len2 = (p: Vec2) => Math.hypot(p[0], p[1]);
const unit2 = (p: Vec2): Vec2 => {
  const l = len2(p) || 1;
  return [p[0] / l, p[1] / l];
};

/** Canonical class → wall plane for one tile. */
export const tileToPlane = (tile: Pick<Tile, 'rotDeg' | 'shift'>, p: Vec2): Vec2 => rotate(add2(p, tile.shift), tile.rotDeg);

/** Patch features from its triangles (lattice-integer corners): perimeter edges and screw points. */
function patchFeatures(cells: [number, number][][], s: number): { perimeter: PatchEdge[]; screws: Vec2[]; tris: [Vec2, Vec2, Vec2][]; centroids: Vec2[] } {
  const tris = cells.map((c) => c.map(([a, b]) => latticePt(a, b, s)) as [Vec2, Vec2, Vec2]);
  const centroids = tris.map(centroidOf);
  const vkey = (p: [number, number]) => `${p[0]},${p[1]}`;
  const edges = new Map<string, { a: [number, number]; b: [number, number]; tri: number; n: number }>();
  const verts = new Map<string, { p: [number, number]; tris: number[] }>();
  cells.forEach((c, ti) => {
    for (let i = 0; i < 3; i++) {
      const p = c[i];
      const q = c[(i + 1) % 3];
      const k = [vkey(p), vkey(q)].sort().join('|');
      const e = edges.get(k);
      if (e) e.n++;
      else edges.set(k, { a: p, b: q, tri: ti, n: 1 });
      const v = verts.get(vkey(p)) ?? { p, tris: [] };
      v.tris.push(ti);
      verts.set(vkey(p), v);
    }
  });
  const perimeter: PatchEdge[] = [];
  const perimAt = new Map<string, Vec2[]>();
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    const a = latticePt(e.a[0], e.a[1], s);
    const b = latticePt(e.b[0], e.b[1], s);
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const t = unit2(sub2(b, a));
    let n: Vec2 = [t[1], -t[0]];
    const toC = sub2(centroids[e.tri], mid);
    if (n[0] * toC[0] + n[1] * toC[1] > 0) n = [-n[0], -n[1]];
    perimeter.push({ a, b, mid, n, t });
    for (const v of [e.a, e.b]) perimAt.set(vkey(v), [...(perimAt.get(vkey(v)) ?? []), t]);
  }
  const inward = (v: { p: [number, number]; tris: number[] }): Vec2 => {
    const P = latticePt(v.p[0], v.p[1], s);
    return unit2(v.tris.reduce<Vec2>((acc, ti) => add2(acc, sub2(centroids[ti], P)), [0, 0]));
  };
  const interior: Vec2[] = [];
  const straight: Vec2[] = [];
  const sharp: Vec2[] = [];
  const at = (v: { p: [number, number] }) => latticePt(v.p[0], v.p[1], s);
  const sorted = [...verts.values()].sort((p, q) => p.p[1] - q.p[1] || p.p[0] - q.p[0]);
  for (const v of sorted) {
    const P = at(v);
    if (v.tris.length === 6) interior.push(P);
    else if (v.tris.length === 3) {
      const ts = perimAt.get(vkey(v.p)) ?? [];
      if (ts.length === 2 && Math.abs(ts[0][0] * ts[1][1] - ts[0][1] * ts[1][0]) < 1e-6) straight.push(add2(P, scaleV(inward(v), 10)));
    } else if (v.tris.length === 1) sharp.push(add2(P, scaleV(inward(v), 14)));
  }
  let screws = interior;
  if (screws.length < 3) screws = [...screws, ...straight];
  if (!screws.length) screws = sharp;
  return { perimeter, screws, tris, centroids };
}

const scaleV = (p: Vec2, k: number): Vec2 => [p[0] * k, p[1] * k];

/* ---------------- Data order ---------------- */

/**
 * Serpentine traversals of one tile: rows along each of the grid's three directions, starting
 * from either end and either side. Neighbours in a row share an edge (s/√3 apart).
 */
export function tileVariants(fs: Facet[], h: number): Facet[][] {
  const out: Facet[][] = [];
  const seen = new Set<string>();
  for (let dir = 0; dir < 3; dir++) {
    const rows = new Map<number, { f: Facet; x: number }[]>();
    for (const f of fs) {
      const p = rotate(f.centroid, -60 * dir);
      const r = Math.floor(p[1] / h + 1e-6);
      rows.set(r, [...(rows.get(r) ?? []), { f, x: p[0] }]);
    }
    const keys = [...rows.keys()].sort((p, q) => p - q);
    for (const asc of [true, false]) {
      for (const ltr of [true, false]) {
        const ks = asc ? keys : [...keys].reverse();
        const seq = ks.flatMap((k, i) => {
          const r = [...rows.get(k)!].sort((p, q) => p.x - q.x).map((x) => x.f);
          return (i % 2 === 0) === ltr ? r : r.reverse();
        });
        const id = seq.map((f) => f.key).join(' ');
        if (!seen.has(id)) {
          seen.add(id);
          out.push(seq);
        }
      }
    }
  }
  return out;
}

/**
 * Pick one traversal per tile (tiles in a fixed order) to keep the strand short: a DP over
 * the variants, where every node-to-node run costs its length and runs past the lead cost ten
 * times more, so extension leads are the last resort.
 */
export function orderTiles(tiles: Facet[][], h: number, lead: number): Facet[][] {
  const cost = (p: Facet, q: Facet) => {
    const d = len2(sub2(p.centroid, q.centroid));
    return d > lead ? 11 * d : d;
  };
  const vars = tiles.map((fs) => tileVariants(fs, h));
  const inner = vars.map((vs) => vs.map((seq) => seq.slice(1).reduce((acc, f, i) => acc + cost(seq[i], f), 0)));
  let best = inner[0] ?? [];
  const back: number[][] = [];
  for (let i = 1; i < vars.length; i++) {
    const row: number[] = [];
    const nb = vars[i].map((seq, v) => {
      let m = Infinity;
      let arg = 0;
      vars[i - 1].forEach((prev, u) => {
        const c = best[u] + cost(prev[prev.length - 1], seq[0]);
        if (c < m) {
          m = c;
          arg = u;
        }
      });
      row[v] = arg;
      return m + inner[i][v];
    });
    back.push(row);
    best = nb;
  }
  if (!vars.length) return [];
  let v = best.indexOf(Math.min(...best));
  const pick: number[] = [];
  for (let i = vars.length - 1; i >= 0; i--) {
    pick[i] = v;
    if (i > 0) v = back[i - 1][v];
  }
  return vars.map((vs, i) => vs[pick[i]]);
}

/* ---------------- The layout ---------------- */

interface Group {
  I: number;
  J: number;
  bigUp: boolean;
  fs: Facet[];
  merged?: boolean;
}

export function layoutFacets(design: FwDesign, params: Params): FwLayout {
  const dims = fwDims(params);
  const s = dims.side;
  const h = (s * SQ3) / 2;
  const bed = bedOf(params);
  const k = tileSize(s, Number(params.patch ?? 8), bed);
  const warnings: string[] = [];

  /* Facets: whole triangles inside any area, deduped by key. */
  const cells = new Map<string, { a: number; b: number; up: boolean }>();
  for (const area of design.areas) for (const c of facetsInArea(area, s)) cells.set(facetKey(c.a, c.b, c.up), c);
  const allPts = design.areas.flatMap((a) => a.outer);
  const bounds = allPts.length ? bounds2(allPts) : { min: [0, 0] as Vec2, max: [0, 0] as Vec2 };
  const omit = new Set(design.omit);

  const list = [...cells.entries()].map(([key, c]) => {
    const corners = facetCorners(c.a, c.b, c.up, s);
    return { key, ...c, corners, centroid: centroidOf(corners) };
  });
  const raw = list.length ? driverValues(design, list.map((f) => f.centroid), typeof params.image === 'string' ? params.image : '', bounds) : [];
  const { start, end, invert } = design.driver;
  const facets: Facet[] = list.map((f, i) => {
    // Invert flips the quantised level, so ties at the band edges swap exactly too.
    const w = shape(raw[i], start, end, false);
    const value = invert ? 1 - w : w;
    const auto = (invert ? 2 - quantise(w) : quantise(w)) as Level;
    const ov = design.overrides[f.key];
    const overridden = ov === 0 || ov === 1 || ov === 2;
    return { ...f, value, auto, level: overridden ? ov : auto, overridden, omitted: omit.has(f.key), tile: '', order: -1 };
  });
  const byKey = new Map(facets.map((f) => [f.key, f]));
  const live = facets.filter((f) => !f.omitted);

  /* Tiles: group live facets by big-triangle cell. */
  const groups = new Map<string, Group>();
  for (const f of live) {
    const t = tileOf(f.a, f.b, f.up, k);
    const gk = `${t.I},${t.J},${t.bigUp ? 'u' : 'd'}`;
    const g = groups.get(gk) ?? { ...t, fs: [] };
    g.fs.push(f);
    groups.set(gk, g);
  }
  mergeSlivers(groups, Math.max(2, Math.ceil((k * k) / 4)), k * k, bed);
  const tileCentre = (g: { fs: Facet[] }): Vec2 => scaleV(g.fs.reduce<Vec2>((acc, f) => add2(acc, f.centroid), [0, 0]), 1 / g.fs.length);
  // Tile rows run along the big lattice rows; serpentine so the strand never doubles back far.
  const rowsOfTiles = new Map<number, Group[]>();
  for (const g of groups.values()) rowsOfTiles.set(g.J, [...(rowsOfTiles.get(g.J) ?? []), g]);
  const tileSeq = [...rowsOfTiles.keys()]
    .sort((p, q) => p - q)
    .flatMap((J, i) => {
      const r = rowsOfTiles.get(J)!.sort((p, q) => tileCentre(p)[0] - tileCentre(q)[0]);
      return i % 2 ? r.reverse() : r;
    });

  const chain: Facet[] = [];
  const tiles: Tile[] = [];
  const classByKey = new Map<string, { canon: Canon; members: { tile: Tile; canon: Canon }[]; size: number; merged: boolean }>();
  const orders = orderTiles(tileSeq.map((g) => g.fs), h, dims.lead);
  tileSeq.forEach((g, i) => {
    const id = `T${String(i + 1).padStart(2, '0')}`;
    const ordered = orders[i];
    for (const f of ordered) {
      f.tile = id;
      f.order = chain.length;
      chain.push(f);
    }
    const canon = canonicalPatch(g.fs);
    const depths: [number, number, number] = [0, 0, 0];
    for (const f of g.fs) depths[f.level]++;
    const tile: Tile = { id, cls: '', I: g.I, J: g.J, bigUp: g.bigUp, facets: ordered.map((f) => f.key), centroid: tileCentre(g), rotDeg: 0, shift: [0, 0], outline: [], shared: 0, screws: 0, depths };
    tiles.push(tile);
    const c = classByKey.get(canon.key) ?? { canon, members: [], size: g.fs.length, merged: !!g.merged };
    c.members.push({ tile, canon });
    classByKey.set(canon.key, c);
  });

  /* Classes: canonical geometry, then each member's transform back onto the wall. */
  const ranked = [...classByKey.values()].sort((p, q) => q.size - p.size || q.members.length - p.members.length || (p.canon.key < q.canon.key ? -1 : 1));
  const classes: TileClass[] = ranked.map((c, ci) => {
    const id = letters(ci);
    const cellsIdx = c.canon.pts.map(([A, B]) => {
      const up = ((A % 3) + 3) % 3 === 1;
      const a = (A - (up ? 1 : 2)) / 3;
      const b = (B - (up ? 1 : 2)) / 3;
      return cornerIdx(a, b, up);
    });
    const feat = patchFeatures(cellsIdx, s);
    const all = feat.tris.flat();
    const bb = bounds2(all);
    const ctr: Vec2 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2];
    const mv = (p: Vec2) => sub2(p, ctr);
    for (const m of c.members) {
      m.tile.cls = id;
      // Thirds → plane: (A, B)/3 through the lattice basis.
      const tPlane = latticePt(m.canon.t[0] / 3, m.canon.t[1] / 3, s);
      m.tile.rotDeg = -60 * m.canon.r;
      m.tile.shift = add2(ctr, tPlane);
      m.tile.screws = feat.screws.length;
    }
    return {
      id,
      key: c.canon.key,
      members: c.members.map((m) => m.tile.id),
      full: c.size === k * k && !c.merged,
      tris: feat.tris.map((t) => t.map(mv) as [Vec2, Vec2, Vec2]),
      centroids: feat.centroids.map(mv),
      perimeter: feat.perimeter.map((e) => ({ ...e, a: mv(e.a), b: mv(e.b), mid: mv(e.mid) })),
      screws: feat.screws.map(mv),
      size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]],
      // Turn found on the face-down (mirrored) outline, as the build prints it.
      printRot: fitAngle(all.map((p) => [p[0], -p[1]] as Vec2), bed) ?? 0,
      merged: c.merged,
    };
  });

  /* Tile outlines on the wall, and which outline edges meet another tile. */
  const edgeTiles = new Map<string, string[]>();
  const ekey = (p: [number, number], q: [number, number]) => [p.join(','), q.join(',')].sort().join('|');
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  for (const f of live) {
    const c = cornerIdx(f.a, f.b, f.up);
    for (let i = 0; i < 3; i++) {
      const e = ekey(c[i], c[(i + 1) % 3]);
      edgeTiles.set(e, [...(edgeTiles.get(e) ?? []), f.tile]);
    }
  }
  for (const f of live) {
    const c = cornerIdx(f.a, f.b, f.up);
    const t = tileById.get(f.tile)!;
    for (let i = 0; i < 3; i++) {
      const across = edgeTiles.get(ekey(c[i], c[(i + 1) % 3]))!;
      if (across.length > 1 && across.every((x) => x === f.tile)) continue;
      t.outline.push([latticePt(c[i][0], c[i][1], s), latticePt(c[(i + 1) % 3][0], c[(i + 1) % 3][1], s)]);
      if (across.length > 1) t.shared++;
    }
  }

  /* Gaps along the strand. */
  const longGaps: Gap[] = [];
  let maxGap = 0;
  for (let i = 1; i < chain.length; i++) {
    const mm = len2(sub2(chain[i].centroid, chain[i - 1].centroid));
    maxGap = Math.max(maxGap, mm);
    if (mm > dims.lead) longGaps.push({ from: chain[i - 1].key, to: chain[i].key, mm });
  }
  const spacing = s / SQ3;
  const counts: [number, number, number] = [0, 0, 0];
  for (const f of live) counts[f.level]++;

  if (design.areas.length && !facets.length) warnings.push(`No whole ${s} mm triangle fits inside the outline. Draw it bigger or make the triangles smaller.`);
  if (facets.length && !live.length) warnings.push('Every facet is knocked out.');
  if (longGaps.length)
    warnings.push(
      `${longGaps.length} node gap${longGaps.length === 1 ? '' : 's'} exceed${longGaps.length === 1 ? 's' : ''} the ${dims.lead} mm strand lead (longest ${Math.round(maxGap)} mm). Splice an extension lead there.`,
    );

  return { dims, side: s, h, k, bedName: bed.name, facets, byKey, chain, tiles, classes, counts, longGaps, maxGap, spacing, bounds, warnings };
}
