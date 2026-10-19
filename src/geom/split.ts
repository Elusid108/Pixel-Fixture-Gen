import { Matrix4 } from 'three';
import type { CrossSection, Manifold } from 'manifold-3d';
import { DEFAULT_FIT_GAP } from '../fit';
import { footprintFits, type Printer } from '../printers';
import type { Mat4, MaterialRole, PartSpec, Vec3 } from '../types';
import type { Geo } from './geo';
import { apply, mul, Rz, T } from './mat';
import { basis, cross, dot, norm } from './vec';

/**
 * Printer-aware auto-split. Takes one solid in its print orientation (Z is the print
 * vertical) and cuts it into pieces that each fit the bed, allowing a 90° turn on the plate.
 *
 * Every cut gets a keyed joint made by *exchanging material* across the cut: the key is the
 * part of the far piece's material inside the key shape, moved to the near piece, and the far
 * piece loses the same shape grown by the fit gap. So a key never adds material the part didn't
 * have, and it works for any section, not just boxes.
 *
 * Fit: the slot is the key grown by half the fit gap on every face, measured square to the face
 * (so a 15° dovetail flank gets the same gap as a straight one), and half a gap deeper than the
 * key reaches. Pin holes are hardware (1.75 mm filament) and keep their own size.
 *
 * - Vertical cuts (normal in XY) default to a sliding **dovetail**. The dovetail runs along Z,
 *   so it prints in the part's own orientation with no overhang, and drops in from above.
 *   With pins on, a 1.75 mm filament cross pin goes in from the side and locks the slide.
 * - Horizontal cuts (stacking) always use a **spigot**: a rim plug following the section,
 *   or round pegs when the walls are too thin for a rim. Pins run across the cut and fix rotation.
 * - `spigot` on a vertical cut gives horizontal pegs instead of the dovetail.
 *
 * Two layouts:
 * - `grid` cuts on axis planes (X, Y, then Z), evenly, nudged clear of keep-out points.
 * - `radial` cuts on vertical half-planes through the Z axis, for rings and crowns. Seams can
 *   keep clear of given angles. Identical sectors (a symmetric ring) dedupe into one part ×N.
 *
 * Each returned part carries instance transforms into the input solid's frame, so a fixture
 * multiplies them onto its own instances and the split part sits exactly where the whole one did.
 */

export type JointKind = 'dovetail' | 'spigot' | 'none';

export interface SplitOpts {
  /** Joint for vertical cuts. Horizontal cuts always use a spigot unless 'none'. Default 'dovetail'. */
  joint?: JointKind;
  /** 1.75 mm filament alignment pins at each cut. Default true. */
  pins?: boolean;
  /** Total fit gap between a key and its slot, mm (half of it on each face). Default 0.4. */
  fit?: number;
  /** Default 'grid'. */
  mode?: 'grid' | 'radial';
  /** Radial: which sector counts are allowed (e.g. divisors of the tube count). */
  sectors?: (n: number) => boolean;
  /** Radial: angles (deg) seams keep clear of; with `half`, a seam closer than that is not allowed. */
  avoid?: (number | { angle: number; half: number })[];
  /** Radial: fixed angle (deg) of the first seam. Overrides `avoid`. */
  phase?: number | ((n: number) => number);
  /** Grid: points in the solid's frame that cuts keep `r` mm away from. */
  keepOut?: { p: Vec3; r: number }[];
  /** Grid: allow stacking cuts across Z. Default true. */
  allowZ?: boolean;
  /** Give up past this many pieces. Default 64. */
  maxPieces?: number;
  /** Merge identical pieces into one part with several instances. Default true. */
  dedupe?: boolean;
  /** Internal: the grid layout already chose a turn on the plate. */
  turned?: boolean;
}

export interface SplitPart {
  /** Print-oriented piece: centred on XY, resting on z=0. */
  solid: Manifold;
  /** Each places one printed copy into the input solid's frame. */
  instances: Mat4[];
  /** Piece numbers this part stands for, 1-based. */
  pieces: number[];
}

export interface SplitResult {
  parts: SplitPart[];
  /** Physical pieces per split solid. 1 when it already fit. */
  pieces: number;
  cuts: number;
  /** Joints that fell back from the requested kind (e.g. dovetail on a horizontal cut). */
  fallbacks: number;
  /** Cuts with no room for any key: butt joint, glue only. */
  bare: number;
  /** 1.75 mm filament pins per split solid, and their total length in mm. */
  pins: number;
  pinMm: number;
  /** Every piece fits the printer. */
  fits: boolean;
  mode: 'none' | 'grid' | 'radial';
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function invert(m: Mat4): Mat4 {
  return new Matrix4().fromArray(m).invert().elements.slice();
}

const FIT_SLACK = 0.5;

export function fitsPrinter(solid: Manifold, printer: Printer): boolean {
  const b = solid.boundingBox();
  return footprintFits(b.max[0] - b.min[0] + FIT_SLACK, b.max[1] - b.min[1] + FIT_SLACK, b.max[2] - b.min[2], printer);
}

/** Usable bed size after the margin, as used by footprintFits. */
function bed(printer: Printer) {
  return { x: printer.x - 8, y: printer.y - 8, z: printer.z };
}

/** Centre on XY and drop to z=0. Returns the solid and the matrix that did it. */
function normalise(g: Geo, s: Manifold, pre: Mat4 = T(0, 0, 0)): { solid: Manifold; N: Mat4 } {
  const r = g.place(s, pre);
  const b = r.boundingBox();
  const N = mul(T(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]), pre);
  return { solid: g.place(s, N), N };
}

/**
 * Splits a straight run (a tube, a rod) into equal segments no longer than `maxLen`, where
 * each joint between segments takes `joint` mm (a coupler ridge, say). Pure arithmetic.
 */
export function splitLinear(total: number, maxLen: number, joint = 0): { count: number; length: number } {
  const count = Math.max(1, Math.ceil((total + joint) / (maxLen + joint) - 1e-9));
  return { count, length: (total - (count - 1) * joint) / count };
}

/** Largest arc (deg, at most 180) of a ring band [rIn, rOut] that lies on the bed, chord along X. */
export function maxArcDeg(rIn: number, rOut: number, height: number, printer: Printer): number {
  for (let a = 180; a >= 2; a -= 0.5) {
    const h = ((a / 2) * Math.PI) / 180;
    if (footprintFits(2 * rOut * Math.sin(h) + FIT_SLACK, rOut - rIn * Math.cos(h) + FIT_SLACK, height, printer)) return a;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Section raster                                                      */
/* ------------------------------------------------------------------ */

interface Raster {
  u0: number;
  v0: number;
  h: number;
  cols: number;
  rows: number;
  solid: Uint8Array;
  /** Approximate distance to the nearest empty cell, mm. */
  dist: Float32Array;
}

function rasterise(polys: [number, number][][], rect: { u0: number; u1: number; v0: number; v1: number }): Raster | null {
  const W = rect.u1 - rect.u0;
  const H = rect.v1 - rect.v0;
  if (!(W > 0.5 && H > 0.5)) return null;
  const h = Math.min(1, Math.max(0.25, Math.ceil((Math.max(W, H) / 160) * 16) / 16));
  const cols = Math.max(1, Math.ceil(W / h));
  const rows = Math.max(1, Math.ceil(H / h));
  const solid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const v = rect.v0 + (r + 0.5) * h;
    const xs: number[] = [];
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const [x1, y1] = p[i];
        const [x2, y2] = p[(i + 1) % p.length];
        if ((y1 <= v && v < y2) || (y2 <= v && v < y1)) xs.push(x1 + ((v - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - rect.u0) / h - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - rect.u0) / h - 0.5));
      for (let c = c0; c <= c1; c++) solid[r * cols + c] = 1;
    }
  }
  // Two-pass chamfer distance (cells), then to mm. Edges of the raster count as empty.
  const INF = 1e9;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = solid[i] ? INF : 0;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : d[r * cols + c]);
  const S2 = Math.SQRT2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(c - 1, r) + 1, at(c, r - 1) + 1, at(c - 1, r - 1) + S2, at(c + 1, r - 1) + S2);
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(c + 1, r) + 1, at(c, r + 1) + 1, at(c + 1, r + 1) + S2, at(c - 1, r + 1) + S2);
    }
  const dist = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) dist[i] = Math.max(0, d[i] - 0.5) * h;
  return { u0: rect.u0, v0: rect.v0, h, cols, rows, solid, dist };
}

/** Best rectangle of solid cells at least `minW` wide: [uCentre, width, vLow, vHigh]. */
function bestRect(R: Raster, minW: number, capW: number, capH: number): { u: number; w: number; va: number; vb: number } | null {
  const { cols, rows, h, solid } = R;
  let best: { u: number; w: number; va: number; vb: number; s: number } | null = null;
  const run = new Uint8Array(cols);
  for (let r0 = 0; r0 < rows; r0++) {
    run.set(solid.subarray(r0 * cols, r0 * cols + cols));
    for (let r1 = r0; r1 < rows; r1++) {
      if (r1 > r0) {
        let any = 0;
        for (let c = 0; c < cols; c++) {
          run[c] &= solid[r1 * cols + c];
          any |= run[c];
        }
        if (!any) break;
      }
      const H = (r1 - r0 + 1) * h;
      let c = 0;
      while (c < cols) {
        if (!run[c]) {
          c++;
          continue;
        }
        const s0 = c;
        while (c < cols && run[c]) c++;
        const W = (c - s0) * h;
        if (W + 1e-9 < minW) continue;
        // Prefer room for a full-size key, then height, then a low start (a longer key face).
        const s = Math.min(W, capW) * Math.min(H, capH) - 0.01 * r0 * h;
        if (!best || s > best.s) best = { u: R.u0 + ((s0 + c) / 2) * h, w: W, va: R.v0 + r0 * h, vb: R.v0 + (r1 + 1) * h, s };
      }
    }
  }
  return best;
}

/** Deepest cells first, keeping `sep` mm apart and outside `exclude`. */
function deepPoints(R: Raster, minDist: number, count: number, sep: number, exclude: (u: number, v: number) => boolean): { u: number; v: number; d: number }[] {
  const cand: { u: number; v: number; d: number }[] = [];
  for (let r = 0; r < R.rows; r++)
    for (let c = 0; c < R.cols; c++) {
      const d = R.dist[r * R.cols + c];
      if (d < minDist) continue;
      const u = R.u0 + (c + 0.5) * R.h;
      const v = R.v0 + (r + 0.5) * R.h;
      if (!exclude(u, v)) cand.push({ u, v, d });
    }
  // Saturate depth so spread wins over a slightly deeper spot right next to the first pick.
  cand.sort((a, b) => Math.min(b.d, minDist * 1.6) - Math.min(a.d, minDist * 1.6) || a.v - b.v);
  const out: { u: number; v: number; d: number }[] = [];
  for (const p of cand) {
    if (out.length >= count) break;
    if (out.every((q) => Math.hypot(q.u - p.u, q.v - p.v) >= sep)) out.push(p);
  }
  if (out.length > 1) {
    // Spread the second pick as far from the first as the section allows.
    const far = cand.filter((p) => Math.min(p.d, minDist * 1.6) >= Math.min(out[0].d, minDist * 1.6) * 0.8);
    far.sort((a, b) => Math.hypot(b.u - out[0].u, b.v - out[0].v) - Math.hypot(a.u - out[0].u, a.v - out[0].v));
    if (far.length && Math.hypot(far[0].u - out[0].u, far[0].v - out[0].v) >= sep) out[1] = far[0];
  }
  return out;
}

/** Distance from (u, v) to the raster's last solid cell along +u or -u in that row. */
function rowExtent(R: Raster, u: number, v: number, dir: 1 | -1): number {
  const r = Math.min(R.rows - 1, Math.max(0, Math.floor((v - R.v0) / R.h)));
  let c = Math.min(R.cols - 1, Math.max(0, Math.floor((u - R.u0) / R.h)));
  let last = c;
  for (; c >= 0 && c < R.cols; c += dir) if (R.solid[r * R.cols + c]) last = c;
  return Math.abs(R.u0 + (last + (dir > 0 ? 1 : 0)) * R.h - u);
}

/* ------------------------------------------------------------------ */
/* Joints                                                              */
/* ------------------------------------------------------------------ */

interface Cut {
  /** Plane frame: columns u, v, n and origin. w = coordinate along n. A is w<0, B is w>0. */
  F: Mat4;
  vertical: boolean;
  /** Face region in plane coords where keys may go. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  a: number;
  b: number;
}

interface JointOut {
  add: Manifold | null;
  subA: Manifold[];
  subB: Manifold[];
  pins: number;
  pinMm: number;
  fallback: boolean;
  bare: boolean;
}

const WALL = 1.6;
const PIN_R = 1.05; // 1.75 mm filament in a Ø2.1 hole: a hardware size, not a part-to-part fit
const PIN_DEPTH = 8;
const TAN15 = Math.tan((15 * Math.PI) / 180);

function planeFrame(p: Vec3, n: Vec3): { F: Mat4; vertical: boolean } {
  const nn = norm(n);
  const vertical = Math.abs(nn[2]) < 1e-6;
  if (vertical) {
    const v: Vec3 = [0, 0, 1];
    const u = norm(cross(v, nn));
    return { F: basis(u, v, nn, p), vertical };
  }
  const u: Vec3 = [1, 0, 0];
  const v = norm(cross(nn, u));
  return { F: basis(u, v, nn, p), vertical };
}

/**
 * Dovetail slot half-width at depth `w` for a key that is `a` wide at the face (w=0) and `b` wide
 * at its full depth `d`, grown by `side` square to the flank.
 */
export function dovetailSlotHalf(a: number, b: number, d: number, side: number, w: number): number {
  const phi = Math.atan((b - a) / (2 * d));
  return a / 2 + w * Math.tan(phi) + side / Math.cos(phi);
}

function makeJoint(g: Geo, S: Manifold, cut: Cut, kind: JointKind, pins: boolean, side: number): JointOut {
  const out: JointOut = { add: null, subA: [], subB: [], pins: 0, pinMm: 0, fallback: false, bare: false };
  if (kind === 'none' && !pins) return out;
  const Finv = invert(cut.F);
  const local = g.place(S, Finv);
  const r = cut.rect;
  const clip = g.CS.square([r.u1 - r.u0, r.v1 - r.v0]).translate([r.u0, r.v0]);
  const section: CrossSection = local.slice(0).intersect(clip);
  if (section.isEmpty() || section.area() < 4) {
    out.bare = true;
    return out;
  }
  // Round the section and snap the raster to a fixed lattice, so cuts that are the same up to
  // float noise (every seam of a symmetric ring) get exactly the same keys and pins.
  const q = (x: number) => Math.round(x * 1e4) / 1e4;
  const polys = (section.toPolygons() as unknown as [number, number][][]).map((p) => p.map(([x, y]) => [q(x), q(y)] as [number, number]));
  const sb = section.bounds();
  const snap = (x: number) => Math.floor(x * 8) / 8 + 0.0137;
  const R = rasterise(polys, { u0: snap(sb.min[0] - 0.5), u1: sb.max[0] + 0.5, v0: snap(sb.min[1] - 0.5), v1: sb.max[1] + 0.5 });
  if (!R) {
    out.bare = true;
    return out;
  }
  const toS = (m: Manifold) => g.place(m, cut.F);
  let want = kind;
  if (want === 'dovetail' && !cut.vertical) {
    want = 'spigot';
    out.fallback = true;
  }
  if (want === 'dovetail') {
    const rect = bestRect(R, 3 + 2 * TAN15 * 5 + 2 * WALL, 22, 30);
    if (rect) {
      const b = Math.min(16, rect.w - 2 * WALL);
      const d = Math.max(4, Math.min(10, b * 0.7));
      const a = Math.max(2.5, b - 2 * d * TAN15);
      const u = rect.u;
      const va = rect.va;
      const prism = (wa: number, wb: number, w0: number, w1: number, v0: number, v1: number) =>
        g.M.hull(
          [v0, v1].flatMap((vv) => [
            [u - wa / 2, vv, w0] as Vec3,
            [u + wa / 2, vv, w0] as Vec3,
            [u - wb / 2, vv, w1] as Vec3,
            [u + wb / 2, vv, w1] as Vec3,
          ]),
        );
      // The key reaches 0.5 back into A so the union overlaps instead of touching, and runs to the
      // top of the face so it drops in from above. The slot is open at the top for the same reason.
      const extA = a - (b - a) * (0.5 / d);
      out.add = toS(prism(extA, b, -0.5, d, va, r.v1)).intersect(S);
      // The slot: every flank half a gap off the key square to the face, half a gap past the key's
      // tip, and half a gap under its foot so the key never bottoms out before the faces meet.
      const floorless = va <= sb.min[1] + 0.3;
      const half = (w: number) => dovetailSlotHalf(a, b, d, side, w);
      out.subB.push(toS(prism(2 * half(-1), 2 * half(d + side), -1, d + side, va - (floorless ? 1 : side), r.v1 + 1)));
      if (pins) {
        // Cross pin along u through the seated key, in from the nearer side face: it locks the slide.
        const vm = (va + Math.min(rect.vb, va + 12)) / 2;
        const ePlus = rowExtent(R, u, vm, 1);
        const eMinus = rowExtent(R, u, vm, -1);
        // A tie (a centred key) must break the same way at every seam, or symmetric pieces differ.
        const dir = ePlus <= eMinus + 0.5 ? 1 : -1;
        const reach = Math.min(ePlus, eMinus);
        if (reach < 80 && rect.vb - va >= 2 * PIN_R + 2) {
          const end = u + dir * (reach + 2);
          const start = u - dir * (a / 4);
          const hole = toS(g.cylX(PIN_R, Math.min(start, end), Math.max(start, end), vm, d / 2));
          out.subA.push(hole);
          out.subB.push(hole);
          out.pins += 1;
          out.pinMm += Math.ceil(Math.abs(end - start) - 2);
        }
      }
      return out;
    }
    want = 'spigot';
    out.fallback = true;
  }

  // Spigot: a rim plug following the section when the walls allow, else round pegs.
  const ring = 3;
  const depth = 6;
  let pegs: { u: number; v: number; r: number }[] = [];
  let rim = false;
  if (want === 'spigot') {
    const plug2 = section.offset(-WALL, 'Round').subtract(section.offset(-WALL - ring, 'Round'));
    rim = !plug2.isEmpty() && !plug2.offset(-0.6).isEmpty() && plug2.area() > 12;
    if (rim) {
      out.add = toS(g.extrude(plug2, -0.5, depth)).intersect(S);
      const sock = section.offset(-WALL + side, 'Round').subtract(section.offset(-WALL - ring - side, 'Round'));
      out.subB.push(toS(g.extrude(sock, -1, depth + side)));
    } else {
      pegs = deepPoints(R, WALL + 1.5, 2, 10, () => false).map((p) => ({ u: p.u, v: p.v, r: Math.min(5, p.d - WALL) }));
      if (pegs.length) {
        out.add = g.union(pegs.map((p) => toS(g.cylZ(p.r, -0.5, depth, p.u, p.v)))).intersect(S);
        for (const p of pegs) out.subB.push(toS(g.cylZ(p.r + side, -1, depth + side, p.u, p.v)));
      } else if (kind !== 'none') {
        out.fallback = true;
      }
    }
  }
  if (pins) {
    // Across the cut, clear of the rim band and of any pegs. Two when there's room, to fix rotation.
    const minD = rim ? WALL + ring + side + PIN_R + 0.8 : PIN_R + 1.4;
    const nearPeg = (u: number, v: number) => pegs.some((p) => Math.hypot(p.u - u, p.v - v) < p.r + PIN_R + 2);
    for (const p of deepPoints(R, minD, 2, 12, nearPeg)) {
      const hole = toS(g.cylZ(PIN_R, -PIN_DEPTH, PIN_DEPTH, p.u, p.v));
      out.subA.push(hole);
      out.subB.push(hole);
      out.pins += 1;
      out.pinMm += 2 * PIN_DEPTH - 1;
    }
  }
  if (!out.add && !out.pins) out.bare = kind !== 'none';
  return out;
}

/* ------------------------------------------------------------------ */
/* The splitter                                                        */
/* ------------------------------------------------------------------ */

interface Cell {
  /** Region of space this piece owns (a box or a wedge). */
  region: Manifold;
  /** Orientation applied before normalising, so the piece lies its best way on the bed. */
  pre: Mat4;
}

function wedge(g: Geo, a0: number, a1: number, R: number, z0: number, z1: number): Manifold {
  const pts: [number, number][] = [[0, 0]];
  const steps = Math.max(1, Math.ceil((a1 - a0) / 30));
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return g.extrude(g.poly(pts), z0, z1);
}

function samePiece(a: Manifold, b: Manifold): boolean {
  const va = a.volume();
  const vb = b.volume();
  if (Math.abs(va - vb) > 1e-3 * va + 0.05) return false;
  const ba = a.boundingBox();
  const bb = b.boundingBox();
  for (let i = 0; i < 3; i++) if (Math.abs(ba.max[i] - ba.min[i] - (bb.max[i] - bb.min[i])) > 0.05) return false;
  // Same envelope: confirm they overlap almost entirely (a mirror image would not).
  return a.intersect(b).volume() > va * (1 - 2e-3) - 0.05;
}

/**
 * Split `solid` (print orientation, Z up) so every piece fits `printer`. See the file comment.
 * Returns the whole solid untouched when it already fits.
 */
export function splitToBed(g: Geo, solid: Manifold, printer: Printer, opts: SplitOpts = {}): SplitResult {
  const kind = opts.joint ?? 'dovetail';
  const pins = opts.pins ?? true;
  const side = (opts.fit ?? DEFAULT_FIT_GAP) / 2;
  const maxPieces = opts.maxPieces ?? 64;
  const whole: SplitResult = { parts: [{ solid, instances: [T(0, 0, 0)], pieces: [1] }], pieces: 1, cuts: 0, fallbacks: 0, bare: 0, pins: 0, pinMm: 0, fits: true, mode: 'none' };
  if (fitsPrinter(solid, printer)) return whole;
  // A turn on the plate may be all it needs.
  for (let a = 15; a < 180; a += 15) {
    const { solid: s, N } = normalise(g, solid, Rz(a));
    if (fitsPrinter(s, printer)) return { ...whole, parts: [{ solid: s, instances: [invert(N)], pieces: [1] }] };
  }
  const bb = solid.boundingBox();
  const B = bed(printer);
  const allowance = 12; // key protrusion plus slack

  const attempt = (cells: Cell[], cutList: Cut[]): { parts: SplitPart[]; fits: boolean; extra: Omit<SplitResult, 'parts' | 'fits' | 'mode'> } => {
    const base = cells.map((c) => solid.intersect(c.region));
    // Fold slivers (a grid cell that only clips a corner) into their biggest neighbour.
    const vols = base.map((b) => b.volume());
    const total = vols.reduce((x, y) => x + y, 0);
    const owner = cells.map((_, i) => i);
    const find = (i: number): number => (owner[i] === i ? i : find(owner[i]));
    for (let i = 0; i < cells.length; i++) {
      if (vols[i] <= 0.01 || vols[i] > Math.max(500, 0.02 * total)) continue;
      const nbrs = cutList.filter((c) => c.a === i || c.b === i).map((c) => find(c.a === i ? c.b : c.a)).filter((j) => j !== i && vols[j] > 0.01);
      if (!nbrs.length) continue;
      const j = nbrs.reduce((x, y) => (vols[y] > vols[x] ? y : x));
      base[j] = g.union([base[j], base[i]]);
      vols[j] += vols[i];
      base[i] = g.M.union([]);
      vols[i] = 0;
      owner[i] = j;
    }
    const cuts = cutList.map((c) => ({ ...c, a: find(c.a), b: find(c.b) })).filter((c) => c.a !== c.b);
    const adds: Manifold[][] = cells.map(() => []);
    const subs: Manifold[][] = cells.map(() => []);
    let fallbacks = 0;
    let bare = 0;
    let pinCount = 0;
    let pinMm = 0;
    for (const c of cuts) {
      const pair = g.union([base[c.a], base[c.b]]);
      if (pair.isEmpty() || base[c.a].isEmpty() || base[c.b].isEmpty()) continue;
      const j = makeJoint(g, pair, c, kind, pins, side);
      if (j.add && !j.add.isEmpty()) adds[c.a].push(j.add);
      subs[c.a].push(...j.subA);
      subs[c.b].push(...j.subB);
      if (j.fallback) fallbacks++;
      if (j.bare) bare++;
      pinCount += j.pins;
      pinMm += j.pinMm;
    }
    const pieces = base.map((p, i) => {
      if (p.isEmpty()) return p;
      // Keys come from the neighbour's original material, so add first, then cut slots and pin holes.
      const withKeys = adds[i].length ? g.union([p, ...adds[i]]) : p;
      return subs[i].length ? g.cut(withKeys, subs[i]) : withKeys;
    });
    const parts: SplitPart[] = [];
    let fits = true;
    let num = 0;
    pieces.forEach((p, i) => {
      if (p.isEmpty() || p.volume() < 0.01) return;
      num++;
      // Try the planned orientation, then turns of 15° on the plate.
      let best: { solid: Manifold; N: Mat4 } | null = null;
      for (let a = 0; a < 180; a += 15) {
        const n = normalise(g, p, mul(Rz(a), cells[i].pre));
        if (fitsPrinter(n.solid, printer)) {
          best = n;
          break;
        }
        if (!best) best = n;
      }
      if (!fitsPrinter(best!.solid, printer)) fits = false;
      const inst = invert(best!.N);
      if (opts.dedupe ?? true) {
        const hit = parts.find((q) => samePiece(q.solid, best!.solid));
        if (hit) {
          hit.instances.push(inst);
          hit.pieces.push(num);
          return;
        }
      }
      parts.push({ solid: best!.solid, instances: [inst], pieces: [num] });
    });
    const count = parts.reduce((s, q) => s + q.instances.length, 0);
    return { parts, fits, extra: { pieces: count, cuts: cuts.length, fallbacks, bare, pins: pinCount, pinMm } };
  };

  /* ---- Radial ---- */
  if (opts.mode === 'radial') {
    const rOut = Math.max(Math.abs(bb.min[0]), Math.abs(bb.max[0]), Math.abs(bb.min[1]), Math.abs(bb.max[1]));
    const Rbig = rOut * 1.5 + 10;
    const z0 = bb.min[2] - 1;
    const z1 = bb.max[2] + 1;
    let last: ReturnType<typeof attempt> | null = null;
    // First pass keeps every seam clear of the avoid zones. If no sector count can, the second
    // pass takes the best clearance it can get: a key in half a lap is still a key.
    for (let pass = 0; pass < (opts.avoid?.length ? 2 : 1); pass++)
    for (let n = 2; n <= maxPieces; n++) {
      if (opts.sectors && !opts.sectors(n)) continue;
      const step = 360 / n;
      let phase = typeof opts.phase === 'function' ? opts.phase(n) : (opts.phase ?? 0);
      if (opts.phase === undefined && opts.avoid?.length) {
        const av = opts.avoid.map((a) => (typeof a === 'number' ? { angle: a, half: 0 } : a));
        let bestClear = -Infinity;
        for (let p = 0; p < step; p += 0.25) {
          let clear = Infinity;
          for (let k = 0; k < n; k++)
            for (const a of av) {
              const d = Math.abs(((((p + k * step - a.angle) % 360) + 540) % 360) - 180);
              clear = Math.min(clear, d - a.half);
            }
          if (clear > bestClear + 1e-9) {
            bestClear = clear;
            phase = p;
          }
        }
        if (bestClear < 0 && pass === 0) continue;
      }
      // Quick reject on the sector's chord before building anything.
      const chord = 2 * rOut * Math.sin(Math.min(Math.PI / 2, (step / 2) * (Math.PI / 180)));
      if (chord + allowance > Math.max(B.x, B.y) + 1) continue;
      const cells: Cell[] = [];
      const cuts: Cut[] = [];
      for (let k = 0; k < n; k++) {
        const a0 = phase + k * step;
        const mid = a0 + step / 2;
        cells.push({ region: wedge(g, a0, a0 + step, Rbig, z0, z1), pre: Rz(90 - mid) });
      }
      for (let k = 0; k < n; k++) {
        const th = ((phase + ((k + 1) % n) * step) * Math.PI) / 180;
        const radial: Vec3 = [Math.cos(th), Math.sin(th), 0];
        const tangent: Vec3 = [-Math.sin(th), Math.cos(th), 0];
        const { F, vertical } = planeFrame([0, 0, 0], tangent);
        // u points away from the axis on one side; keys go on the half-plane the seam is on.
        const uDir = dot([F[0], F[1], F[2]], radial) > 0 ? 1 : -1;
        const rect = uDir > 0 ? { u0: 0.01, u1: Rbig, v0: z0, v1: z1 } : { u0: -Rbig, u1: -0.01, v0: z0, v1: z1 };
        cuts.push({ F, vertical, rect, a: k, b: (k + 1) % n });
      }
      const r = attempt(cells, cuts);
      last = r;
      if (r.fits) return { parts: r.parts, fits: true, mode: 'radial', ...r.extra };
    }
    return last ? { parts: last.parts, fits: false, mode: 'radial', ...last.extra } : { ...whole, fits: false };
  }

  /* ---- Grid ---- */
  // Turn the part on the plate first if that needs fewer pieces (a triangle splits better along
  // an edge), then split the turned part and turn the instances back.
  if (!opts.turned) {
    const count = (b: { min: number[]; max: number[] }) => {
      const w = b.max[0] - b.min[0];
      const d = b.max[1] - b.min[1];
      let best = Infinity;
      for (let nx = 1; nx <= 12; nx++)
        for (let ny = 1; ny <= 12; ny++) {
          const cw = w / nx + (nx > 1 ? allowance : 0);
          const cd = d / ny + (ny > 1 ? allowance : 0);
          if ((cw <= B.x && cd <= B.y) || (cw <= B.y && cd <= B.x)) best = Math.min(best, nx * ny);
        }
      return { n: best, fill: 1 / (w * d) };
    };
    let bestA = 0;
    let bestC = count(bb);
    for (let a = 15; a < 180; a += 15) {
      const c = count(g.place(solid, Rz(a)).boundingBox());
      if (c.n < bestC.n || (c.n === bestC.n && c.fill > bestC.fill * 1.08)) {
        bestA = a;
        bestC = c;
      }
    }
    if (bestA) {
      const r = splitToBed(g, g.place(solid, Rz(bestA)), printer, { ...opts, turned: true, keepOut: opts.keepOut?.map((k) => ({ ...k, p: apply(Rz(bestA), k.p) })) });
      const back = Rz(-bestA);
      return { ...r, parts: r.parts.map((p) => ({ ...p, instances: p.instances.map((M) => mul(back, M)) })) };
    }
  }
  const W = bb.max[0] - bb.min[0];
  const D = bb.max[1] - bb.min[1];
  const H = bb.max[2] - bb.min[2];
  const allowZ = opts.allowZ ?? true;
  let nz = 1;
  if (H > B.z) {
    if (!allowZ) return { ...whole, fits: false };
    nz = Math.ceil(H / (B.z - allowance));
  }
  const cellFits = (nx: number, ny: number) => {
    const cw = W / nx + (nx > 1 ? allowance : 0);
    const cd = D / ny + (ny > 1 ? allowance : 0);
    return (cw <= B.x && cd <= B.y) || (cw <= B.y && cd <= B.x);
  };
  const layouts: [number, number][] = [];
  for (let nx = 1; nx <= 12; nx++) for (let ny = 1; ny <= 12; ny++) if (nx * ny * nz <= maxPieces && cellFits(nx, ny)) layouts.push([nx, ny]);
  layouts.sort((p, q) => p[0] * p[1] - q[0] * q[1] || Math.abs(p[0] - p[1]) - Math.abs(q[0] - q[1]));
  if (!layouts.length) layouts.push([Math.ceil(W / (B.x - allowance)), Math.ceil(D / (B.y - allowance))]);

  const positions = (lo: number, hi: number, n: number, axis: 0 | 1 | 2): number[] => {
    const L = (hi - lo) / n;
    const out: number[] = [];
    for (let k = 1; k < n; k++) {
      let best = lo + k * L;
      if (opts.keepOut?.length && axis < 2) {
        let bestScore = -Infinity;
        for (let s = -0.3; s <= 0.3 + 1e-9; s += 0.02) {
          const x = lo + (k + s) * L;
          const score = Math.min(...opts.keepOut.map((o) => Math.abs(o.p[axis] - x) - o.r)) - Math.abs(s) * 0.5;
          if (score > bestScore) {
            bestScore = score;
            best = x;
          }
        }
      }
      out.push(best);
    }
    return out;
  };

  let last: ReturnType<typeof attempt> | null = null;
  const tried = new Set<string>();
  const queue = layouts.slice(0, 4);
  while (queue.length) {
    const [nx, ny] = queue.shift()!;
    const key = `${nx}x${ny}x${nz}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const xs = [bb.min[0] - 1, ...positions(bb.min[0], bb.max[0], nx, 0), bb.max[0] + 1];
    const ys = [bb.min[1] - 1, ...positions(bb.min[1], bb.max[1], ny, 1), bb.max[1] + 1];
    const zs = [bb.min[2] - 1, ...positions(bb.min[2], bb.max[2], nz, 2), bb.max[2] + 1];
    const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
    const cells: Cell[] = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push({ region: g.box([xs[i], ys[j], zs[k]], [xs[i + 1], ys[j + 1], zs[k + 1]]), pre: T(0, 0, 0) });
    const cuts: Cut[] = [];
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          if (i + 1 < nx) {
            const { F, vertical } = planeFrame([xs[i + 1], 0, 0], [1, 0, 0]);
            // u = z × x = +y, v = z.
            cuts.push({ F, vertical, rect: { u0: ys[j] + 0.01, u1: ys[j + 1] - 0.01, v0: zs[k] + 0.01, v1: zs[k + 1] - 0.01 }, a: idx(i, j, k), b: idx(i + 1, j, k) });
          }
          if (j + 1 < ny) {
            const { F, vertical } = planeFrame([0, ys[j + 1], 0], [0, 1, 0]);
            // u = z × y = -x, v = z.
            cuts.push({ F, vertical, rect: { u0: -xs[i + 1] + 0.01, u1: -xs[i] - 0.01, v0: zs[k] + 0.01, v1: zs[k + 1] - 0.01 }, a: idx(i, j, k), b: idx(i, j + 1, k) });
          }
          if (k + 1 < nz) {
            const { F, vertical } = planeFrame([0, 0, zs[k + 1]], [0, 0, 1]);
            cuts.push({ F, vertical, rect: { u0: xs[i] + 0.01, u1: xs[i + 1] - 0.01, v0: ys[j] + 0.01, v1: ys[j + 1] - 0.01 }, a: idx(i, j, k), b: idx(i, j, k + 1) });
          }
        }
    const r = attempt(cells, cuts);
    last = r;
    if (r.fits) return { parts: r.parts, fits: true, mode: 'grid', ...r.extra };
    // Grow the layout and try again.
    if (nx * ny * nz < maxPieces) queue.push(W / nx >= D / ny ? [nx + 1, ny] : [nx, ny + 1]);
  }
  return last ? { parts: last.parts, fits: false, mode: 'grid', ...last.extra } : { ...whole, fits: false };
}

/* ------------------------------------------------------------------ */
/* Fixture glue                                                        */
/* ------------------------------------------------------------------ */

export interface PartBase {
  id: string;
  name: string;
  role: MaterialRole;
  explode?: Vec3;
  note?: string;
}

/**
 * Turns a split into PartSpecs. `instances` are the fixture's placements of the whole solid;
 * each piece instance is composed onto them, so the pieces assemble where the whole part was.
 */
export function splitParts(sp: SplitResult, base: PartBase, instances: Mat4[]): PartSpec<Manifold>[] {
  if (sp.pieces === 1) {
    return [{ ...base, solid: sp.parts[0].solid, instances: instances.map((M) => mul(M, sp.parts[0].instances[0])) }];
  }
  const total = sp.pieces;
  const many = sp.parts.length > 1;
  return sp.parts.map((p, i) => ({
    ...base,
    id: `${base.id}-p${i + 1}`,
    name: `${base.name} · ${many ? `piece ${i + 1}/${sp.parts.length}` : 'piece'}`,
    solid: p.solid,
    instances: instances.flatMap((M) => p.instances.map((P) => mul(M, P))),
    note: [base.note, p.pieces.length > 1 ? `${p.pieces.length} of the ${total} pieces are this one.` : `Piece ${p.pieces[0]} of ${total}.`, i === 0 ? splitNote(sp) : ''].filter(Boolean).join(' '),
  }));
}

export function splitNote(sp: SplitResult): string {
  if (sp.pieces <= 1) return '';
  const bits = [`Split in ${sp.pieces} to fit the bed (${sp.cuts} keyed joint${sp.cuts === 1 ? '' : 's'}).`];
  if (sp.pins) bits.push(`${sp.pins} × 1.75 mm filament pin${sp.pins === 1 ? '' : 's'}.`);
  if (sp.bare) bits.push(`${sp.bare} joint${sp.bare === 1 ? ' has' : 's have'} no room for a key: glue.`);
  return bits.join(' ');
}
