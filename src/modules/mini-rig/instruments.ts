import { add, cross, dot, norm, scale } from '../../geom/vec';
import { pcbLedOffsets, type PixelType } from '../../pixels/library';
import type { Vec3 } from '../../types';
import type { InstrumentKind, MountSide } from './model';
import type { RigDims } from './params';

/**
 * Clip-on instruments, pure half: the sizes of every printed piece and where each piece sits
 * on the rig. The build models the solids from these numbers and the bench draws markers
 * from the same poses, so the two never drift.
 *
 * Every hung instrument is the same stack, the way a real one is rigged:
 *   chord → snap clamp (C-ring + stem) → [mover base] → yoke (pan screw) → body (tilt screws).
 * Body-local frame: tilt axis along X through (0, 0, zT), beam along +Z, the body printed
 * standing on its back (z = 0).
 */

/** An orthonormal frame: origin and axes, Z-up mm. */
export interface Frame {
  o: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/** Point in a frame's local coordinates → world. */
export const at = (f: Frame, p: Vec3): Vec3 => add(f.o, add(add(scale(f.x, p[0]), scale(f.y, p[1])), scale(f.z, p[2])));

/* Shared clamp and yoke sizes. */
export const CLAMP = { wall: 2, h: 7, stemW: 7, stemLen: 7, pilot: 7 };
export const YOKE = { tb: 3.5, ta: 3, h: 8, tail: 4.5 };

export interface InstDims {
  kind: InstrumentKind;
  /** Snap ring bore and outer radius, chord axis at the local origin. */
  clampRi: number;
  clampRo: number;
  /** Stem end, measured from the chord axis along the hang direction. */
  stemEnd: number;
  /** Mover base height between the clamp stem and the yoke (0 for the rest). */
  baseH: number;
  /** Yoke inner width between the arms, and the drop from the bar's underside to the tilt axis. */
  yokeWi: number;
  drop: number;
  /** Tilt axis height in body-local coordinates. */
  zT: number;
  /** Body half extents in body-local X (tilt axis), Y and the length along the beam. */
  half: [number, number];
  length: number;
  pixel: PixelType;
  px: number;
  /** Schedule "units": PCBs/nodes, or millimetres of strip. */
  units: number;
  /** Pixels in data order, body-local, where the light reads. */
  pixels: Vec3[];
  /** Screws that hold this instrument together. */
  panScrew: number;
  tiltScrew: number;
  par?: { R: number; L: number; capT: number; wall: number; lensR: number };
  mover?: { hw: number; H: number; lensR: number; jewelZ: number; baseW: number; baseD: number };
  blinder?: { cols: number; rows: number; cp: number; wH: number; dH: number; hz: number; seatZ: number; cupR: number; cells: [number, number][] };
  batten?: { Lb: number; wB: number; hB: number; pitch: number; trimmed: boolean; diffW: number };
}

/** Longest batten (body) that still prints with its yoke on this bed. */
function battenFit(dims: RigDims): number {
  return Math.max(dims.bed.x, dims.bed.y) - 2 * YOKE.ta - 3;
}

export function instDims(kind: InstrumentKind, dims: RigDims): InstDims {
  const clampRi = dims.chordR + dims.fit + 0.05;
  const clampRo = clampRi + CLAMP.wall;
  const stemEnd = clampRo + CLAMP.stemLen;
  const tol = dims.tol;
  const base = { kind, clampRi, clampRo, stemEnd, baseH: 0, panScrew: 10, tiltScrew: 6 };

  if (kind === 'par' || kind === 'mover') {
    const j = dims.jewel;
    const jd = j.shape.kind === 'round' ? j.shape.d : 23;
    const rj = jd / 2 + tol;
    const leds = pcbLedOffsets(j);
    if (kind === 'par') {
      const wall = 1.6;
      const R = rj + wall;
      const L = 34;
      const capT = j.shape.depth + 2.4;
      const zT = L * 0.45;
      return {
        ...base,
        yokeWi: 2 * (R + 1.5) + 1,
        drop: Math.hypot(zT, R) + 1,
        zT,
        half: [R, R],
        length: L,
        pixel: j,
        px: j.pxPerUnit,
        units: 1,
        pixels: leds.map(([x, y]) => [x, y, L - 0.2] as Vec3),
        par: { R, L, capT, wall, lensR: R - wall + 0.6 },
      };
    }
    const hw = Math.max(28, 2 * rj + 5);
    const H = 30;
    const zT = H * 0.45;
    const lensR = rj + 1.2;
    return {
      ...base,
      baseH: 10,
      panScrew: 20,
      yokeWi: hw + 3 + 1,
      drop: Math.hypot(zT, hw / 2) + 1,
      zT,
      half: [hw / 2, hw / 2],
      length: H,
      pixel: j,
      px: j.pxPerUnit,
      units: 1,
      pixels: leds.map(([x, y]) => [x, y, H - 0.2] as Vec3),
      mover: { hw, H, lensR, jewelZ: H - 1.2 - 2, baseW: 30, baseD: 22 },
    };
  }

  if (kind === 'blinder2' || kind === 'blinder4') {
    const c = dims.cell;
    const cd = c.shape.kind === 'round' ? c.shape.d : 10;
    const cols = 2;
    const rows = kind === 'blinder4' ? 2 : 1;
    const cp = Math.max(22, cd + 9);
    const wH = cols * cp + 4;
    const dH = rows * cp + 4;
    const cupD = 6;
    const hz = Math.max(14, cupD + c.shape.depth + 3);
    const seatZ = hz - cupD;
    const zT = hz / 2;
    // Serpentine: left → right on the first row, back on the second.
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      const y = (r - (rows - 1) / 2) * cp;
      const xs = Array.from({ length: cols }, (_, k) => (k - (cols - 1) / 2) * cp);
      for (const x of r % 2 ? xs.reverse() : xs) cells.push([x, -y]);
    }
    return {
      ...base,
      yokeWi: wH + 3 + 1,
      drop: Math.hypot(zT, dH / 2) + 1,
      zT,
      half: [wH / 2, dH / 2],
      length: hz,
      pixel: c,
      px: cells.length * c.pxPerUnit,
      units: cells.length,
      pixels: cells.map(([x, y]) => [x, y, seatZ] as Vec3),
      blinder: { cols, rows, cp, wH, dH, hz, seatZ, cupR: cp / 2 - 1.5, cells },
    };
  }

  // Batten: strip in a channel under a slide-in diffuser, pivoting on its long axis.
  const s = dims.strip;
  const sw = s.shape.kind === 'strip' ? s.shape.width : 10;
  const pitch = s.shape.kind === 'strip' ? s.shape.pitch : 1000 / 60;
  const capM = 5;
  const maxPx = Math.max(1, Math.floor((battenFit(dims) - 2 * capM) / pitch));
  const px = Math.max(1, Math.min(dims.battenPxWanted, maxPx));
  const Lb = px * pitch + 2 * capM;
  const wB = sw + 0.6 + 2 * 2.4;
  const hB = 12;
  const zT = 3;
  return {
    ...base,
    yokeWi: Lb + 1,
    drop: Math.hypot(wB / 2, hB - zT) + 1,
    zT,
    half: [Lb / 2, wB / 2],
    length: hB,
    pixel: s,
    px,
    units: Math.round(px * pitch),
    pixels: Array.from({ length: px }, (_, i) => [(i - (px - 1) / 2) * pitch, 0, hB - 1.2] as Vec3),
    batten: { Lb, wB, hB, pitch, trimmed: px < dims.battenPxWanted, diffW: sw + 0.6 + 2 - 0.4 },
  };
}

/** A span's cross-section frame: axis, the truss "up" and the audience-side "front". */
export interface SpanFrame {
  A: Vec3;
  d: Vec3;
  up: Vec3;
  front: Vec3;
}

export interface InstPose {
  /** Chord centre the clamp grips, and the hang direction (away from the truss). */
  chord: Vec3;
  out: Vec3;
  /** Print-local frames (before the per-part offsets the build applies). */
  clamp: Frame;
  base: Frame | null;
  yoke: Frame;
  /** At the tilt axis; body-local points map with at(body, [x, y, z − zT]). */
  body: Frame;
  beam: Vec3;
}

export function sideSigns(side: MountSide): { sUp: number; sFront: number } {
  return { sUp: side.startsWith('below') ? -1 : 1, sFront: side.endsWith('front') ? 1 : -1 };
}

const rotAbout = (v: Vec3, k: Vec3, deg: number): Vec3 => {
  // Rodrigues, k unit.
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
};

/**
 * Where an instrument's pieces sit. `along` is mm from node a along the span axis. The yoke's
 * tilt axis runs along the truss at pan 0; positive tilt swings the beam toward the front.
 */
export function instPose(sf: SpanFrame, along: number, side: MountSide, pan: number, tilt: number, dims: RigDims, id: InstDims): InstPose {
  const { sUp, sFront } = sideSigns(side);
  const h = dims.c / 2;
  const chord = add(add(add(sf.A, scale(sf.d, along)), scale(sf.up, sUp * h)), scale(sf.front, sFront * h));
  const out = scale(sf.up, sUp);
  // Clamp: ring opening faces into the truss (horizontally), stem along out.
  const cx = scale(sf.front, sFront);
  const clamp: Frame = { o: chord, x: cx, y: out, z: cross(cx, out) };
  const stemTip = add(chord, scale(out, id.stemEnd));
  // Yoke frame: X = tilt axis (the span axis turned by pan about out), Y = out.
  const X = norm(rotAbout(sf.d, out, pan));
  const Z = cross(X, out);
  const base: Frame | null = id.baseH > 0 ? { o: stemTip, x: X, y: cross(out, X), z: out } : null;
  const yokeO = add(stemTip, scale(out, id.baseH));
  const yoke: Frame = { o: yokeO, x: X, y: out, z: Z };
  const pivot = add(yokeO, scale(out, YOKE.tb + id.drop));
  const s = dot(sf.front, Z) < -1e-6 ? -1 : 1;
  const a = (s * tilt * Math.PI) / 180;
  const Y1 = add(scale(out, Math.cos(a)), scale(Z, Math.sin(a)));
  const Z1 = add(scale(out, -Math.sin(a)), scale(Z, Math.cos(a)));
  const body: Frame = { o: pivot, x: X, y: scale(Z1, -1), z: Y1 };
  return { chord, out, clamp, base, yoke, body, beam: Y1 };
}

/** Body-local point → world, with the tilt-axis offset applied. */
export const bodyPoint = (pose: InstPose, id: InstDims, p: Vec3): Vec3 => at(pose.body, [p[0], p[1], p[2] - id.zT]);

/** Rough extent along the span, for overlap checks: the yoke at pan 0, the body side-on at 90°. */
export function footprint(id: InstDims, pan: number): number {
  const a = (pan * Math.PI) / 180;
  const yokeOuter = id.yokeWi + 2 * YOKE.ta;
  return Math.abs(Math.cos(a)) * yokeOuter + Math.abs(Math.sin(a)) * Math.max(2 * id.half[1], YOKE.h);
}
