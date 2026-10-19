import { hiveTileDims, type HiveTileDims } from '../../fixtures/hive';
import { bool, num, str } from '../../fixtures/util';
import { getPixel, type PixelType } from '../../pixels/library';
import { bounds2, distToPolygon, pointInPolygon, polygonArea } from '../../sketch/geom';
import type { Vec2 } from '../../sketch/types';
import type { Params } from '../../types';
import { plural, serpentine } from '../shared/layout';
import { bedOf, resolveSpecs, type Bed } from '../shared/params';
import { slotKey, type HwDesign, type HwStart } from './model';
import { HW_PARAMS } from './params';

/**
 * M1 Hive wall layout: pure, shared by the worker build, the bench scene and the inspector.
 *
 * Tiles are flat-top hexes (the catalogue tile's shell: corners on ±X, edges facing
 * 30° + 60°·k), so they tessellate in columns: column i sits at x = i·colW, odd columns are
 * shoved up by half a tile. Rows (constant j) zig-zag but every step along a row is to an
 * edge neighbour, which is what the serpentine data order needs.
 *
 * Frames: plane coords (the design's outline) → lattice coords (rotate by -rot about the
 * lattice offset) → tile-local coords (minus the slot centre). Tile-local is also the frame the
 * tile layers are modelled in, so clip polygons computed here key the build's part dedupe.
 */

const SQ3 = Math.sqrt(3);
const RINGS: Record<HwSize, number> = { S: 1, M: 2, L: 3 };
export type HwSize = 'S' | 'M' | 'L';
const SIZES: HwSize[] = ['S', 'M', 'L'];

/** Seam between neighbouring tiles, mm. */
export const GAP = 0.4;
/** Cleat rail: thickness (tiles stand off the wall by this), width, keyhole drop. */
export const RAIL = { t: 4, w: 18, drop: 10 };
/** A tile is "whole" when the outline covers this much of it. */
const FULL = 0.999;

export interface HwDims extends HiveTileDims {
  size: HwSize;
  asked: HwSize;
  pitchAsked: number;
  /** Why the tile was made smaller than asked, if it was. */
  fallback: string | null;
  pixel: PixelType;
  /** Shell outer circumradius (corner), centre spacing D and column spacing. */
  R: number;
  D: number;
  colW: number;
  /** Cell circumradius: a cell is kept when this plus the wall fits inside a trimmed tile. */
  cellR: number;
  /** Keyhole entries at local y = ±keyY; studs end up `RAIL.drop` above. */
  keyY: number;
  rail: boolean;
  /** Tile back above the wall plane (rail thickness when railed). */
  zBack: number;
  magnets: boolean;
  bowties: boolean;
  tol: number;
  minArea: number;
  bed: Bed;
  /** Most studs one printed rail segment can carry on this bed. */
  railMax: number;
}

export const hwParams = (given: Params): Params => resolveSpecs(HW_PARAMS, given);

/** Does a flat-top tile of these dims print on the bed (corners along one axis, flats along the other)? */
export function tileFits(d: HiveTileDims, bed: Bed): boolean {
  const w = (2 * d.A) / Math.cos(Math.PI / 6) + 0.2;
  const h = 2 * d.A + 0.2;
  return d.Hs <= bed.z && ((w <= bed.x && h <= bed.y) || (h <= bed.x && w <= bed.y));
}

export function hwDims(params: Params): HwDims {
  const p = hwParams(params);
  const bed = bedOf(p);
  const pixel = getPixel(str(p, 'pixel'));
  const asked = (SIZES.includes(str(p, 'size') as HwSize) ? str(p, 'size') : 'M') as HwSize;
  const pitchAsked = num(p, 'pitch');
  const base = { baffle: num(p, 'baffle'), wiring: num(p, 'wiring'), diffuser: num(p, 'diffuser'), wall: num(p, 'wall'), pixel };
  let size = asked;
  let pitch = pitchAsked;
  let d = hiveTileDims({ ...base, rings: RINGS[size], pitch });
  // Step down a size, then shrink the pitch, until the tile prints on this bed.
  while (!tileFits(d, bed) && size !== 'S') {
    size = SIZES[SIZES.indexOf(size) - 1];
    d = hiveTileDims({ ...base, rings: RINGS[size], pitch });
  }
  while (!tileFits(d, bed) && pitch > 22) {
    pitch -= 1;
    d = hiveTileDims({ ...base, rings: RINGS[size], pitch });
  }
  let fallback: string | null = null;
  if (size !== asked || pitch !== pitchAsked) {
    const what = size !== asked ? `${asked} tiles don't fit the ${bed.name} bed, so the wall uses ${size} tiles` : `${size} tiles at ${pitchAsked} mm pitch don't fit the ${bed.name} bed`;
    fallback = `${what}${pitch !== pitchAsked ? ` at ${pitch} mm cell pitch` : ''}.`;
  }
  const rail = bool(p, 'rail');
  const D = 2 * d.A + GAP;
  const colW = (D * SQ3) / 2;
  return {
    ...d,
    size,
    asked,
    pitchAsked,
    fallback,
    pixel,
    R: d.A / Math.cos(Math.PI / 6),
    D,
    colW,
    cellR: pitch / SQ3,
    keyY: D / 4,
    rail,
    zBack: rail ? RAIL.t : 0,
    magnets: bool(p, 'magnets'),
    bowties: bool(p, 'bowties'),
    tol: num(p, 'tol'),
    minArea: num(p, 'minArea') / 100,
    bed,
    railMax: Math.max(1, Math.floor((Math.max(bed.x, bed.y) - 1 + 2) / colW)),
  };
}

/* ---------------- Frames ---------------- */

export function toLattice(lat: HwDesign['lattice'], p: Vec2): Vec2 {
  const a = (-lat.rot * Math.PI) / 180;
  const x = p[0] - lat.offset[0];
  const y = p[1] - lat.offset[1];
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

export function fromLattice(lat: HwDesign['lattice'], p: Vec2): Vec2 {
  const a = (lat.rot * Math.PI) / 180;
  return [lat.offset[0] + p[0] * Math.cos(a) - p[1] * Math.sin(a), lat.offset[1] + p[0] * Math.sin(a) + p[1] * Math.cos(a)];
}

const odd = (i: number) => ((i % 2) + 2) % 2 === 1;
export const slotCenter = (i: number, j: number, d: Pick<HwDims, 'D' | 'colW'>): Vec2 => [i * d.colW, j * d.D + (odd(i) ? d.D / 2 : 0)];
export function slotAt(p: Vec2, d: Pick<HwDims, 'D' | 'colW'>): [number, number] {
  const i = Math.round(p[0] / d.colW);
  return [i, Math.round((p[1] - (odd(i) ? d.D / 2 : 0)) / d.D)];
}

/** Flat-top hex corners (CCW from +X) by apothem. */
export function hexPts(apothem: number, c: Vec2 = [0, 0]): Vec2[] {
  const R = apothem / Math.cos(Math.PI / 6);
  return Array.from({ length: 6 }, (_, k) => [c[0] + R * Math.cos((k * Math.PI) / 3), c[1] + R * Math.sin((k * Math.PI) / 3)] as Vec2);
}

/** Outward unit normal of tile edge k (30° + 60°·k). */
export const edgeNormal = (k: number): Vec2 => [Math.cos(((30 + 60 * k) * Math.PI) / 180), Math.sin(((30 + 60 * k) * Math.PI) / 180)];

/* ---------------- Clipping ---------------- */

/**
 * Sutherland–Hodgman: any simple polygon clipped by a convex CCW polygon. Concave subjects can
 * leave zero-width bridges along the clip edges; areas and point tests are unaffected, which is
 * all planning needs. The build clips exactly with CrossSection booleans.
 */
export function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  let out = subject;
  for (let e = 0; e < clip.length && out.length; e++) {
    const a = clip[e];
    const b = clip[(e + 1) % clip.length];
    const side = (p: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const sc = side(cur);
      const sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) out.push(lerp2(prev, cur, sp / (sp - sc)));
        out.push(cur);
      } else if (sp >= 0) out.push(lerp2(prev, cur, sp / (sp - sc)));
    }
  }
  return out;
}

const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Drop duplicate and collinear vertices and start at the lowest-left one, so equal shapes compare equal. */
export function canonical(poly: Vec2[], tol = 0.05): Vec2[] {
  let pts = poly.filter((p, i) => Math.hypot(p[0] - poly[(i + 1) % poly.length][0], p[1] - poly[(i + 1) % poly.length][1]) > tol);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cr) / L < tol) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  if (!pts.length) return pts;
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [bx, by] = pts[best];
    if (y < by - tol || (Math.abs(y - by) <= tol && x < bx)) best = i;
  }
  return [...pts.slice(best), ...pts.slice(0, best)];
}

/* ---------------- Layout ---------------- */

export type SlotState = 'full' | 'partial' | 'whole' | 'dropped' | 'out' | 'off';
export const PLACED: SlotState[] = ['full', 'partial', 'whole'];

export interface HwClip {
  /** Tile hex ∩ outline loops, and tile hex ∩ hole loops, in tile-local coords. */
  outers: Vec2[][];
  holes: Vec2[][];
}

export interface HwSlot {
  key: string;
  i: number;
  j: number;
  /** Lattice coords. */
  center: Vec2;
  state: SlotState;
  /** Placed if left alone (no override). */
  natural: boolean;
  override: 'on' | 'off' | null;
  /** Share of the tile inside the outline, 0..1. */
  ratio: number;
  /** Trimmed tiles only. */
  clip: HwClip | null;
  /** Kept cells, tile-local, catalogue serpentine order. */
  cells: Vec2[];
  /** Edge k still whole (keeps its magnets and key pocket). */
  edges: boolean[];
  /** Edge k's JST notch survives the trim, so the strand can pass to that neighbour. */
  notch: boolean[];
  /** Lower and upper keyhole still usable. */
  keyholes: [boolean, boolean];
  /** Dedupe key of the trimmed shape. */
  shape: string | null;
}

export interface HwPiece {
  /** "P1"… trimmed edge-tile types, in data order of first use. */
  id: string;
  shape: string;
  /** Slot whose exact clip the build models. */
  slot: string;
  units: string[];
  cells: number;
  ratio: number;
  /** Where the back engraving fits, tile-local, or null when there is no room. */
  labelAt: Vec2 | null;
}

export interface HwTile {
  unit: string;
  slot: HwSlot;
  kind: 'full' | 'partial';
  /** "full" or a piece id. */
  piece: string;
  row: number;
  col: number;
  position: string;
  /** Cells in data order, tile-local and lattice coords. */
  cells: Vec2[];
  cellsLat: Vec2[];
  enters: string;
  /** Distance from the previous tile's last cell, and whether the strand passes straight in from the previous tile through facing notches. */
  jumpIn: number;
  linked: boolean;
}

export interface HwSeam {
  a: string;
  b: string;
  /** Edge of `a` the seam is on. */
  k: number;
}

export interface HwRailSeg {
  m: number;
  i0: number;
  n: number;
  /** Segment centre, lattice coords. */
  x: number;
  y: number;
  len: number;
}

export interface HwLayout {
  dims: HwDims;
  slots: HwSlot[];
  bySlot: Map<string, HwSlot>;
  tiles: HwTile[];
  pieces: HwPiece[];
  seams: HwSeam[];
  rails: HwRailSeg[];
  /** How the tiles were walked. */
  order: 'rows' | 'columns';
  px: number;
  full: number;
  partial: number;
  dropped: number;
  /** Placed tiles' extent, lattice coords. */
  size: { w: number; h: number };
  warnings: string[];
}

const ptIn = (p: Vec2, c: HwClip) => c.outers.some((o) => pointInPolygon(p, o)) && !c.holes.some((h) => pointInPolygon(p, h));
const distClip = (p: Vec2, c: HwClip) => Math.min(...c.outers.map((o) => distToPolygon(p, o)), ...c.holes.map((h) => distToPolygon(p, h)));

/** Classify every lattice slot, trim edge tiles, order the data, count seams and rails. */
export function layoutWall(design: HwDesign, params: Params): HwLayout {
  const dims = hwDims(params);
  const { A, D, colW, R, wall, cellR, keyY, cells: allCells, pitch } = dims;
  const lat = design.lattice;
  const off = new Set(design.off);
  const on = new Set(design.on);
  const hex = hexPts(A);
  const hexArea = polygonArea(hex);

  // Areas in lattice coords with bounds for a quick reject.
  const areas = design.areas.map((a) => {
    const outer = a.outer.map((p) => toLattice(lat, p));
    const holes = a.holes.map((h) => h.map((p) => toLattice(lat, p)));
    return { outer, holes, b: bounds2(outer), hb: holes.map((h) => bounds2(h)) };
  });
  const inRegion = (p: Vec2) => areas.some((a) => pointInPolygon(p, a.outer) && !a.holes.some((h) => pointInPolygon(p, h)));
  /** Distance to the nearest cut (outline or hole), lattice coords. */
  const toCut = (p: Vec2) => Math.min(...areas.flatMap((a) => [distToPolygon(p, a.outer), ...a.holes.map((h) => distToPolygon(p, h))]));

  // Slot window: the areas' bounds plus a ring, and any slot switched on by hand.
  const keys = new Set<string>();
  if (areas.length) {
    const b = bounds2(areas.flatMap((a) => a.outer));
    for (let i = Math.floor((b.min[0] - R) / colW) - 1; i <= Math.ceil((b.max[0] + R) / colW) + 1; i++) {
      for (let j = Math.floor((b.min[1] - D) / D) - 1; j <= Math.ceil((b.max[1] + D) / D) + 1; j++) keys.add(slotKey(i, j));
    }
  }
  for (const k of on) keys.add(k);

  const slots: HwSlot[] = [];
  for (const key of keys) {
    const [i, j] = key.split(',').map(Number);
    const c = slotCenter(i, j, dims);
    const box = { min: [c[0] - R, c[1] - A] as Vec2, max: [c[0] + R, c[1] + A] as Vec2 };
    const hit = (b: { min: Vec2; max: Vec2 }) => b.min[0] < box.max[0] && b.max[0] > box.min[0] && b.min[1] < box.max[1] && b.max[1] > box.min[1];
    const clip: HwClip = { outers: [], holes: [] };
    let area = 0;
    for (const a of areas) {
      if (!hit(a.b)) continue;
      const o = clipConvex(
        a.outer.map((p) => [p[0] - c[0], p[1] - c[1]] as Vec2),
        hex,
      );
      if (o.length < 3) continue;
      clip.outers.push(o);
      area += Math.abs(polygonArea(o));
      a.holes.forEach((h, k) => {
        if (!hit(a.hb[k])) return;
        const hc = clipConvex(
          h.map((p) => [p[0] - c[0], p[1] - c[1]] as Vec2),
          hex,
        );
        if (hc.length < 3) return;
        clip.holes.push(hc);
        area -= Math.abs(polygonArea(hc));
      });
    }
    const ratio = Math.max(0, Math.min(1, area / hexArea));
    let natural: SlotState = ratio >= FULL ? 'full' : ratio < 1e-4 ? 'out' : 'partial';
    let cells = natural === 'full' ? allCells : [];
    let edges = Array<boolean>(6).fill(natural === 'full');
    let notch = Array<boolean>(6).fill(natural === 'full');
    let keyholes: [boolean, boolean] = [natural === 'full', natural === 'full'];
    let shape: string | null = null;
    if (natural === 'partial') {
      cells = allCells.filter((p) => ptIn(p, clip) && distClip(p, clip) >= cellR + wall);
      if (ratio < dims.minArea || !cells.length) natural = 'dropped';
      const corners = hexPts(A - 0.5);
      edges = corners.map((p0, k) => {
        const p1 = corners[(k + 1) % 6];
        return [0.08, 0.3, 0.5, 0.7, 0.92].every((t) => inRegion([c[0] + p0[0] + (p1[0] - p0[0]) * t, c[1] + p0[1] + (p1[1] - p0[1]) * t]));
      });
      // The notch footprint (edge-local: depth into the wall × ±4.5 mm) must clear the closing wall.
      notch = edges.map((_, k) => {
        const n = edgeNormal(k);
        return [A - wall - 3.5, A - 0.6].every((x) =>
          [-4.5, 0, 4.5].every((y) => {
            const p: Vec2 = [c[0] + n[0] * x - n[1] * y, c[1] + n[1] * x + n[0] * y];
            return inRegion(p) && toCut(p) >= wall + 0.3;
          }),
        );
      });
      keyholes = [-1, 1].map((s) => [0, RAIL.drop].every((dy) => ptIn([0, s * keyY + dy], clip) && distClip([0, s * keyY + dy], clip) >= wall + 5)) as [boolean, boolean];
      const r = (v: number) => Math.round(v * 5) / 5;
      const ring = (l: Vec2[]) => canonical(l).map(([x, y]) => `${r(x)} ${r(y)}`).join(',');
      shape = `${clip.outers.map(ring).sort().join('|')}#${clip.holes.map(ring).sort().join('|')}`;
    }
    const naturalPlaced = natural === 'full' || natural === 'partial';
    let state: SlotState = natural;
    let override: HwSlot['override'] = null;
    if (on.has(key)) {
      state = 'whole';
      override = 'on';
      cells = allCells;
      edges = Array<boolean>(6).fill(true);
      notch = Array<boolean>(6).fill(true);
      keyholes = [true, true];
    } else if (off.has(key)) {
      state = 'off';
      override = 'off';
    }
    slots.push({ key, i, j, center: c, state, natural: naturalPlaced, override, ratio, clip: natural === 'partial' || natural === 'dropped' ? clip : null, cells, edges, notch, keyholes, shape: state === 'partial' ? shape : null });
  }
  const bySlot = new Map(slots.map((s) => [s.key, s]));
  const placed = slots.filter((s) => PLACED.includes(s.state));

  /*
   * ---- Data order ----
   * Tiles go line by line from the start corner: rows (constant j, zig-zag) or columns
   * (constant i, straight). Each line starts at whichever end is nearer the last tile, so a
   * plain rectangle comes out as a serpentine. Both are tried; the one needing fewer extension
   * leads (then less jump length) wins, which is usually columns for hex-shaped walls and rows
   * for wide ones. Within a tile the cells run serpentine by cell rows (the catalogue tile's
   * order), flipped whichever way puts the first cell nearest the previous tile's last cell.
   * Each tile is its own JST-linked strand segment, so a global cell-row serpentine (which would
   * cross every tile several times) is never shorter.
   */
  const start: HwStart = design.start;
  const rs = start[0] === 'b' ? 1 : -1;
  const cs = start[1] === 'l' ? 1 : -1;
  const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  /** Edge of `a` that faces `b`, or -1 when they aren't neighbours. */
  const sideTo = (a: HwSlot, b: HwSlot): number => {
    for (let k = 0; k < 6; k++) {
      const n = edgeNormal(k);
      const [ni, nj] = slotAt([a.center[0] + D * n[0], a.center[1] + D * n[1]], dims);
      if (ni === b.i && nj === b.j) return k;
    }
    return -1;
  };
  /** The strand can pass straight from a to b through facing notches. */
  const linked = (a: HwSlot, b: HwSlot) => {
    const k = sideTo(a, b);
    return k >= 0 && a.notch[k] && b.notch[(k + 3) % 6];
  };
  const corner: Vec2 = placed.length
    ? [cs > 0 ? Math.min(...placed.map((s) => s.center[0])) - 2 * R : Math.max(...placed.map((s) => s.center[0])) + 2 * R, rs > 0 ? Math.min(...placed.map((s) => s.center[1])) - 2 * A : Math.max(...placed.map((s) => s.center[1])) + 2 * A]
    : [0, 0];
  const walk = (byRows: boolean): HwSlot[] => {
    const lines = new Map<number, HwSlot[]>();
    for (const s of placed) {
      const k = byRows ? s.j : s.i;
      lines.set(k, [...(lines.get(k) ?? []), s]);
    }
    const sign = byRows ? rs : cs;
    const out: HwSlot[] = [];
    let at = corner;
    let flip = false;
    for (const k of [...lines.keys()].sort((a, b) => sign * (a - b))) {
      const line = lines.get(k)!.sort((a, b) => (byRows ? a.i - b.i : a.j - b.j));
      const d0 = dist(at, line[0].center);
      const d1 = dist(at, line[line.length - 1].center);
      // Nearer end first; on a tie keep alternating.
      const rev: boolean = Math.abs(d0 - d1) < 1 ? !flip : d1 < d0;
      flip = rev;
      out.push(...(rev ? [...line].reverse() : line));
      at = out[out.length - 1].center;
    }
    return out;
  };
  const cost = (o: HwSlot[]) => {
    let breaks = 0;
    let jump = 0;
    for (let k = 1; k < o.length; k++) {
      if (!linked(o[k - 1], o[k])) breaks++;
      jump += dist(o[k - 1].center, o[k].center);
    }
    return breaks * 1e6 + jump;
  };
  const byRows = walk(true);
  const byCols = walk(false);
  const order: 'rows' | 'columns' = cost(byCols) < cost(byRows) - 1 ? 'columns' : 'rows';
  const ordered = order === 'rows' ? byRows : byCols;
  const minJ = Math.min(...placed.map((s) => s.j));
  const rowLeft = new Map<number, number[]>();
  for (const s of placed) rowLeft.set(s.j, [...(rowLeft.get(s.j) ?? []), s.i]);
  for (const v of rowLeft.values()) v.sort((a, b) => a - b);

  const rowTol = (pitch * SQ3) / 2;
  const variants = (cells: Vec2[]) =>
    [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].map(([a, b]) => serpentine(cells, (p) => a * p[1], (p) => b * p[0], rowTol));

  const pieces: HwPiece[] = [];
  const pieceOf = new Map<string, HwPiece>();
  const tiles: HwTile[] = [];
  // Each tile's cell order (one of four serpentine flips) is picked by dynamic programming over
  // the whole chain, so the hops between tiles (last cell → next tile's first) are shortest
  // overall. The first tile leans toward the start corner.
  const opts = ordered.map((s) => variants(s.cells).map((v) => ({ local: v, lat: v.map((p) => [s.center[0] + p[0], s.center[1] + p[1]] as Vec2) })));
  const costs: number[][] = [];
  const back: number[][] = [];
  opts.forEach((vs, t) => {
    costs[t] = [];
    back[t] = [];
    vs.forEach((v, k) => {
      if (t === 0) {
        costs[t][k] = 0.25 * dist(corner, v.lat[0]);
        back[t][k] = -1;
        return;
      }
      let best = Infinity;
      opts[t - 1].forEach((pv, j) => {
        const c = costs[t - 1][j] + dist(pv.lat[pv.lat.length - 1], v.lat[0]);
        if (c < best - 1e-9) {
          best = c;
          back[t][k] = j;
        }
      });
      costs[t][k] = best;
    });
  });
  const pick: number[] = [];
  if (opts.length) {
    const last = costs[opts.length - 1];
    let k = last.indexOf(Math.min(...last));
    for (let t = opts.length - 1; t >= 0; t--) {
      pick[t] = k;
      k = back[t][k];
    }
  }

  ordered.forEach((s, idx) => {
    const unit = `T${String(idx + 1).padStart(2, '0')}`;
    const { local: best, lat: cellsLat } = opts[idx][pick[idx]];
    const prev = idx ? ordered[idx - 1] : null;
    const prevCells = idx ? opts[idx - 1][pick[idx - 1]].lat : null;
    const jumpIn = prevCells ? dist(prevCells[prevCells.length - 1], cellsLat[0]) : 0;
    let piece = 'full';
    if (s.state === 'partial' && s.shape) {
      let pc = pieceOf.get(s.shape);
      if (!pc) {
        pc = { id: `P${pieces.length + 1}`, shape: s.shape, slot: s.key, units: [], cells: s.cells.length, ratio: s.ratio, labelAt: labelSpot(s, dims) };
        pieces.push(pc);
        pieceOf.set(s.shape, pc);
      }
      pc.units.push(unit);
      piece = pc.id;
    }
    const f = best[0] ?? [0, 0];
    const enters = `${f[1] < -1 ? 'lower' : f[1] > 1 ? 'upper' : 'middle'} ${f[0] < 0 ? 'left' : 'right'}`;
    const row = s.j - minJ + 1;
    const col = rowLeft.get(s.j)!.indexOf(s.i) + 1;
    tiles.push({
      unit,
      slot: s,
      kind: s.state === 'partial' ? 'partial' : 'full',
      piece,
      row,
      col,
      position: `row ${row}, tile ${col}`,
      cells: best,
      cellsLat,
      enters,
      jumpIn,
      linked: prev ? linked(prev, s) : true,
    });
  });

  /* ---- Seams (each pair once) ---- */
  const seams: HwSeam[] = [];
  for (const s of placed) {
    for (const k of [0, 1, 5]) {
      const n = edgeNormal(k);
      const [ni, nj] = slotAt([s.center[0] + D * n[0], s.center[1] + D * n[1]], dims);
      const o = bySlot.get(slotKey(ni, nj));
      if (o && PLACED.includes(o.state) && s.edges[k] && o.edges[(k + 3) % 6]) seams.push({ a: s.key, b: o.key, k });
    }
  }

  /* ---- Cleat rails: one stud per usable keyhole, runs of neighbouring columns, split to the bed ---- */
  const rails: HwRailSeg[] = [];
  if (dims.rail) {
    const byRail = new Map<number, Set<number>>();
    for (const s of placed) {
      [-1, 1].forEach((sg, h) => {
        if (!s.keyholes[h]) return;
        const y = s.center[1] + sg * keyY;
        const m = Math.round((y - keyY) / (D / 2));
        if (!byRail.has(m)) byRail.set(m, new Set());
        byRail.get(m)!.add(s.i);
      });
    }
    for (const [m, set] of [...byRail.entries()].sort((a, b) => a[0] - b[0])) {
      const is = [...set].sort((a, b) => a - b);
      let run: number[] = [];
      const flush = () => {
        let k = 0;
        while (k < run.length) {
          // Split long runs evenly rather than leaving a short tail.
          const left = run.length - k;
          const n = Math.ceil(left / Math.ceil(left / dims.railMax));
          const i0 = run[k];
          rails.push({ m, i0, n, x: (i0 + (n - 1) / 2) * colW, y: m * (D / 2) + keyY + RAIL.drop, len: n * colW - 2 });
          k += n;
        }
        run = [];
      };
      for (const i of is) {
        if (run.length && i !== run[run.length - 1] + 1) flush();
        run.push(i);
      }
      flush();
    }
  }

  /* ---- Totals and warnings ---- */
  const px = tiles.reduce((n, t) => n + t.cells.length, 0);
  const warnings: string[] = [];
  if (dims.fallback) warnings.push(dims.fallback);
  if (dims.cellIn < dims.nodeD / 2 + 1) warnings.push(`Cells are tight for a ${dims.nodeD} mm node at ${pitch} mm pitch. Try ${Math.ceil(dims.nodeD + 2 + dims.bw)} mm or more.`);
  if (dims.pixel.leadLength && pitch > dims.pixel.leadLength) warnings.push(`Cell pitch ${pitch} mm is longer than the ${dims.pixel.leadLength} mm node lead.`);
  const dropped = slots.filter((s) => s.state === 'dropped').length;
  if (dropped) warnings.push(`${plural(dropped, 'edge sliver')} left out (under ${Math.round(dims.minArea * 100)} % of a tile or no whole cell). Switch one on with the Tile tool to use a whole tile there.`);
  for (const t of tiles) {
    if (t.kind === 'partial' && !t.slot.edges.some(Boolean)) warnings.push(`${t.unit} (${t.piece}) has no whole edge left, so no wire notch: drill one in its closing wall or switch it off.`);
  }
  for (let k = 1; k < tiles.length; k++) {
    const t = tiles[k];
    if (!t.linked) warnings.push(`Data jumps from ${tiles[k - 1].unit} to ${t.unit} (${Math.round(t.jumpIn)} mm, no shared notch): add an extension lead.`);
  }
  if (dims.rail) {
    const loose = tiles.filter((t) => !t.slot.keyholes[0] && !t.slot.keyholes[1]);
    if (loose.length) warnings.push(`${loose.map((t) => t.unit).join(', ')} ${loose.length === 1 ? 'has' : 'have'} no keyhole on a rail stud and ${loose.length === 1 ? 'hangs' : 'hang'} from neighbours' magnets and keys.`);
    const tilt = ((lat.rot % 360) + 360) % 360;
    if (placed.length && Math.min(tilt, 360 - tilt) > 15) warnings.push(`The lattice is turned ${Math.round(lat.rot)}°: keyholes only lock by gravity when tiles hang upright. Screw through the stud slots or keep the turn within ±15°.`);
  }
  if (!placed.length) warnings.push('No tiles yet. Draw a closed shape and generate a Hive wall, or switch slots on with the Tile tool.');

  // Wall extent: whole tiles' hexes and trimmed tiles' clip outlines.
  let size = { w: 0, h: 0 };
  const extent = placed.flatMap((s) => (s.state === 'partial' && s.clip ? s.clip.outers.flat() : hexPts(A)).map((p) => [p[0] + s.center[0], p[1] + s.center[1]] as Vec2));
  if (extent.length) {
    const b = bounds2(extent);
    size = { w: b.max[0] - b.min[0], h: b.max[1] - b.min[1] };
  }

  return {
    dims,
    slots,
    bySlot,
    tiles,
    pieces,
    seams,
    rails,
    order,
    px,
    full: tiles.filter((t) => t.kind === 'full').length,
    partial: tiles.filter((t) => t.kind === 'partial').length,
    dropped,
    size,
    warnings,
  };
}

/**
 * Outline of a cluster of slots (lattice coords): the union of their hexes grown by half a
 * seam, traced edge by edge. Shared edges cancel; what's left chains into one loop (CCW).
 * Used for presets and "outline = these tiles". Assumes the cluster has no holes.
 */
export function clusterOutline(slots: [number, number][], d: Pick<HwDims, 'A' | 'D' | 'colW'>): Vec2[] {
  const k = (p: Vec2) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const edges = new Map<string, [Vec2, Vec2]>();
  for (const [i, j] of slots) {
    const h = hexPts(d.A + GAP / 2, slotCenter(i, j, d));
    for (let e = 0; e < 6; e++) {
      const a = h[e];
      const b = h[(e + 1) % 6];
      const rev = `${k(b)}>${k(a)}`;
      if (edges.has(rev)) edges.delete(rev);
      else edges.set(`${k(a)}>${k(b)}`, [a, b]);
    }
  }
  const from = new Map([...edges.values()].map((e) => [k(e[0]), e]));
  const first = [...edges.values()][0];
  if (!first) return [];
  const loop: Vec2[] = [];
  let cur = first;
  for (let n = 0; n <= edges.size; n++) {
    loop.push(cur[0]);
    const next = from.get(k(cur[1]));
    if (!next || next === first) break;
    cur = next;
  }
  return canonical(loop, 0.01);
}

/** Roomiest spot on a trimmed tile's back for its engraving, clear of keyholes and the centre hole. */
function labelSpot(s: HwSlot, d: HwDims): Vec2 | null {
  if (!s.clip) return null;
  const avoid: Vec2[] = [
    [0, 0],
    [0, -d.keyY],
    [0, d.keyY],
    [0, -d.keyY + RAIL.drop],
    [0, d.keyY + RAIL.drop],
  ];
  let best: Vec2 | null = null;
  let score = 9;
  for (let x = -d.Al; x <= d.Al; x += 5) {
    for (let y = -d.Al; y <= d.Al; y += 5) {
      const p: Vec2 = [x, y];
      if (!ptIn(p, s.clip)) continue;
      const sc = Math.min(distClip(p, s.clip) - d.wall, ...avoid.map((a) => Math.hypot(p[0] - a[0], p[1] - a[1]) - 3)) - Math.abs(y) * 0.01;
      if (sc > score) {
        score = sc;
        best = p;
      }
    }
  }
  return best;
}
