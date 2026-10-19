import type { Manifold } from 'manifold-3d';
import { fitOf } from '../../fit';
import { apply, mul } from '../../geom/mat';
import type { JointKind, SplitOpts } from '../../geom/split';
import { add, dist, norm, scale } from '../../geom/vec';
import { DEFAULT_PRINTER_ID, getPrinter, PRINTERS, type Printer } from '../../printers';
import type { BuildCtx, Mat4, ParamSpec, Params, PartSpec, Vec3 } from '../../types';
import { bool, str } from '../util';

/** Shared by every L-series fixture: the host's printer and how oversize parts split. */
export const SPLIT_PARAMS: ParamSpec[] = [
  { key: 'autosplit', label: 'Auto-split to printer', type: 'boolean', default: true, group: 'Print', help: 'Cut parts that are bigger than your bed into keyed pieces.' },
  {
    key: 'joint',
    label: 'Split joint',
    type: 'select',
    default: 'dovetail',
    options: [
      { value: 'dovetail', label: 'Dovetail + cross pin' },
      { value: 'spigot', label: 'Spigot + pins' },
    ],
    group: 'Print',
    help: 'Joint for vertical cuts. Stacking cuts always use a spigot.',
  },
  { key: 'pins', label: 'Alignment pin holes', type: 'boolean', default: true, group: 'Print', help: 'Holes for 1.75 mm filament pins at each split.' },
  { key: 'printer', label: 'Printer', type: 'select', default: DEFAULT_PRINTER_ID, options: PRINTERS.map((p) => ({ value: p.id, label: p.name })), hidden: true },
];

export interface SplitCfg {
  printer: Printer;
  on: boolean;
  opts: SplitOpts;
}

/** The split settings, with the fit gap for the split keys (the default gap when a fixture has no fit param). */
export function splitCfg(params: Params): SplitCfg {
  return {
    printer: getPrinter(str(params, 'printer')),
    on: bool(params, 'autosplit'),
    opts: { joint: str(params, 'joint') as JointKind, pins: bool(params, 'pins'), fit: fitOf(params) },
  };
}

export const fmt = (v: number, d = 0) => v.toFixed(d);

/** PETG, g/cm³. */
export const PETG = 1.27;

/** Assembled bounding box over every printed copy. */
export function assembledBounds(parts: PartSpec<Manifold>[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const b = p.solid.boundingBox();
    for (const M of p.instances)
      for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
          for (const z of [b.min[2], b.max[2]]) {
            const q = apply(M, [x, y, z]);
            for (let i = 0; i < 3; i++) {
              min[i] = Math.min(min[i], q[i]);
              max[i] = Math.max(max[i], q[i]);
            }
          }
  }
  return { min, max };
}

/** Grams of PETG over every printed copy. */
export function massG(parts: PartSpec<Manifold>[]): number {
  return parts.reduce((s, p) => s + (p.solid.volume() / 1000) * PETG * p.instances.length, 0);
}

/* ------------------------------------------------------------------ */
/* Geodesic spheres                                                    */
/* ------------------------------------------------------------------ */

/** Vertex-up icosahedron on the unit sphere: top, upper ring, lower ring (offset 36°), bottom. */
export function icosaUnit(): Vec3[] {
  const pts: Vec3[] = [[0, 0, 1]];
  const zr = 1 / Math.sqrt(5);
  const rr = 2 / Math.sqrt(5);
  for (let k = 0; k < 5; k++) pts.push([rr * Math.cos((k * 2 * Math.PI) / 5), rr * Math.sin((k * 2 * Math.PI) / 5), zr]);
  for (let k = 0; k < 5; k++) pts.push([rr * Math.cos(((k + 0.5) * 2 * Math.PI) / 5), rr * Math.sin(((k + 0.5) * 2 * Math.PI) / 5), -zr]);
  pts.push([0, 0, -1]);
  return pts;
}

export interface Geodesic {
  /** Unit vectors. */
  verts: Vec3[];
  /** CCW seen from outside. */
  faces: [number, number, number][];
}

/** Class I geodesic sphere of frequency f: every icosahedron face cut into f² triangles. 20f² faces. */
export function geodesic(f: number): Geodesic {
  const ico = icosaUnit();
  let min = Infinity;
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) min = Math.min(min, dist(ico[i], ico[j]));
  const adj = (a: number, b: number) => dist(ico[a], ico[b]) < min * 1.001;
  const icoFaces: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) if (adj(i, j) && adj(j, k) && adj(i, k)) icoFaces.push([i, j, k]);

  const verts: Vec3[] = [];
  const index = new Map<string, number>();
  const vid = (p: Vec3) => {
    const q = norm(p);
    const key = q.map((v) => Math.round(v * 1e6)).join(',');
    let i = index.get(key);
    if (i === undefined) {
      i = verts.length;
      index.set(key, i);
      verts.push(q);
    }
    return i;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of icoFaces) {
    const [A, B, C] = [ico[a], ico[b], ico[c]];
    const P = (i: number, j: number) => vid(add(add(scale(A, (f - i - j) / f), scale(B, i / f)), scale(C, j / f)));
    for (let i = 0; i < f; i++)
      for (let j = 0; j < f - i; j++) {
        faces.push([P(i, j), P(i + 1, j), P(i, j + 1)]);
        if (i + j < f - 1) faces.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
      }
  }
  // Wind every face CCW from outside.
  for (const fc of faces) {
    const [p, q, r] = fc.map((i) => verts[i]);
    const n = [(q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]), (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]), (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])];
    if (n[0] * (p[0] + q[0] + r[0]) + n[1] * (p[1] + q[1] + r[1]) + n[2] * (p[2] + q[2] + r[2]) < 0) [fc[1], fc[2]] = [fc[2], fc[1]];
  }
  return { verts, faces };
}

/** Composes instance lists: every placement in `outer` times every one in `inner`. */
export function compose(outer: Mat4[], inner: Mat4[]): Mat4[] {
  return outer.flatMap((M) => inner.map((P) => mul(M, P)));
}

/** Small seeded PRNG (mulberry32) so "random" patterns are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Battery runtime for a pixel load, hours. */
export function runtimeHours(opts: { cells: number; mAh: number; px: number; wattsPerPx: number; level: number; controllerW?: number; idleWPerPx?: number }): { hours: number; watts: number; wh: number } {
  // 3.6 V nominal, 90% usable depth, 85% boost converter to 5 V.
  const wh = (opts.cells * opts.mAh * 3.6 * 0.9 * 0.85) / 1000;
  const watts = opts.px * opts.wattsPerPx * opts.level + opts.px * (opts.idleWPerPx ?? 0.005) + (opts.controllerW ?? 0.5);
  return { hours: wh / watts, watts, wh };
}

/**
 * Lofts a closed solid through layers of a band outline. Every layer is one closed loop of the
 * same length: N points along the outer edge, then the inner edge back (so point i pairs with
 * 2N-1-i). Caps are triangulated across the band, so the outline may be curved (non-convex).
 */
export function loftBand(ctx: BuildCtx, layers: Vec3[][]): Manifold {
  const L = layers.length;
  const M = layers[0].length;
  const N = M / 2;
  const verts = new Float32Array(L * M * 3);
  layers.forEach((ring, j) => ring.forEach((p, i) => verts.set(p, (j * M + i) * 3)));
  const tris: number[] = [];
  const id = (j: number, i: number) => j * M + (i % M);
  for (let j = 0; j + 1 < L; j++)
    for (let i = 0; i < M; i++) tris.push(id(j, i), id(j, i + 1), id(j + 1, i + 1), id(j, i), id(j + 1, i + 1), id(j + 1, i));
  for (let i = 0; i + 1 < N; i++) {
    const [a, b, c, d] = [i, i + 1, M - 2 - i, M - 1 - i];
    tris.push(id(L - 1, a), id(L - 1, b), id(L - 1, c), id(L - 1, a), id(L - 1, c), id(L - 1, d));
    tris.push(id(0, a), id(0, c), id(0, b), id(0, a), id(0, d), id(0, c));
  }
  // Flip everything if the loops ran clockwise.
  let vol = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const [p, q, r] = [tris[t], tris[t + 1], tris[t + 2]].map((k) => [verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]]);
    vol += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  if (vol < 0) for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  const mesh = new ctx.wasm.Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) });
  return ctx.Manifold.ofMesh(mesh);
}
