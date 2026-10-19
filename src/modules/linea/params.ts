import { FIT_PARAMS, fitOf, seatOf, sideOf } from '../../fit';
import { bool, num, str } from '../../fixtures/util';
import { getPixel, type PixelType } from '../../pixels/library';
import type { ParamSpec, Params } from '../../types';
import { bedOf, DESIGN_PARAM, PRINTER_PARAM, resolveSpecs, type Bed } from '../shared/params';

export const LINEA_PIXELS = ['strip-60-ws2812b', 'strip-30-ws2812b', 'strip-144-ws2812b', 'strip-60-ws2815', 'pcb-9-ws2812b', 'pcb-9-sk6812-rgbw'];

export type Profile = 'flat' | 'dome' | 'louvered';
export type Mount = 'wall' | 'cable' | 'none';

/** Catalogue straights, nominal mm. Actual lengths are the nearest whole number of pixels. */
export const CATALOGUE_MM = [100, 150, 200, 250];
/** Catalogue corner angles, degrees between the two bars. Corners are made at the exact drawn angle. */
export const CATALOGUE_DEG = [30, 45, 60, 90, 120, 135];

export const LINEA_PARAMS: ParamSpec[] = [
  DESIGN_PARAM,
  PRINTER_PARAM,
  { key: 'pixel', label: 'Pixel', type: 'pixel', default: 'strip-60-ws2812b', pixels: LINEA_PIXELS, group: 'Pixels' },
  {
    key: 'cellPitch',
    label: 'Cell pitch',
    type: 'number',
    default: 20,
    min: 12,
    max: 60,
    step: 0.5,
    unit: 'mm',
    group: 'Pixels',
    help: 'Pixel PCBs only. Strips use their own pitch, and every straight is a whole number of pixels long.',
  },
  {
    key: 'profile',
    label: 'Diffuser',
    type: 'select',
    default: 'flat',
    options: [
      { value: 'flat', label: 'Flat opal' },
      { value: 'dome', label: 'Dome' },
      { value: 'louvered', label: 'Louvered (open grille)' },
    ],
    group: 'Profile',
    help: 'All three snap onto the same black U-channel. Louvered is an open grille: a transverse louver at every pixel boundary.',
  },
  { key: 'cells', label: 'Cell dividers', type: 'boolean', default: true, group: 'Profile', help: 'A comb insert with a divider at every pixel boundary, so each pixel reads as its own cell. Built into the louvered grille.' },
  { key: 'depth', label: 'Diffusion depth', type: 'number', default: 12, min: 6, max: 30, step: 1, unit: 'mm', group: 'Profile', help: 'LED to diffuser. Deeper is softer and more even.' },
  { key: 'diffuser', label: 'Diffuser wall', type: 'number', default: 1.2, min: 0.8, max: 2.4, step: 0.2, unit: 'mm', group: 'Profile' },
  { key: 'wall', label: 'Channel wall', type: 'number', default: 1.8, min: 1.2, max: 3, step: 0.2, unit: 'mm', group: 'Profile' },
  {
    key: 'maxStraight',
    label: 'Longest straight',
    type: 'select',
    default: '250',
    options: CATALOGUE_MM.map((v) => ({ value: String(v), label: `${v} mm` })),
    group: 'Bars',
    help: 'Long spans split into catalogue straights up to this length (and never longer than your bed allows, laid diagonally if needed).',
  },
  {
    key: 'mount',
    label: 'Mounting',
    type: 'select',
    default: 'wall',
    options: [
      { value: 'wall', label: 'Wall clips (screw)' },
      { value: 'cable', label: 'Aircraft-cable clips' },
      { value: 'none', label: 'None' },
    ],
    group: 'Mounting',
    help: 'Clips grip grooves on the outside of the channel, so bars snap in after the clips are fixed.',
  },
  { key: 'clipEvery', label: 'Clip spacing', type: 'number', default: 400, min: 150, max: 1200, step: 10, unit: 'mm', group: 'Mounting', help: 'At least one clip per span between joints.' },
  ...FIT_PARAMS,
];

export function lineaParams(given: Params = {}): Params {
  return resolveSpecs(LINEA_PARAMS, given);
}

export interface LinDims {
  pixel: PixelType;
  strip: boolean;
  /** Pixel pitch along the bar, mm. Every straight is a whole number of these. */
  pitch: number;
  /** Strip (or PCB) width and the seat it drops into. */
  sw: number;
  seatW: number;
  seatD: number;
  /** Light chamber width above the seat. */
  wc: number;
  /** Wall thickness and outer width. */
  t: number;
  W: number;
  /** Back floor under the seat. */
  F: number;
  /** Seat top (LED face). */
  zSh: number;
  /** Top of the walls at the inner edge; the wall tops are chamfered 45° outward-down. */
  H: number;
  depth: number;
  td: number;
  /** Fit gap between mating printed parts. */
  fit: number;
  /** Half the fit gap: cover legs to channel walls, part ends to the seam, key in pocket. */
  clr: number;
  /** Pixel seat clearance (strip seat and PCB pockets). */
  tol: number;
  /** How far a snap barb reaches past the face it snaps over, on top of the fit gap. */
  snap: number;
  /** Diffuser snap legs: thickness, length; barb size; groove in the inner wall. */
  legT: number;
  legL: number;
  barb: number;
  groove: { z0: number; z1: number; d: number };
  /** Outer grooves the clips grip. */
  clipGroove: { z0: number; z1: number; d: number };
  /** Wire groove along the back (return runs). */
  back: { w: number; d: number };
  /** Bowtie key: neck, wide, half-length, thickness, pocket depth, y offset of each of the pair. */
  key: { neck: number; wide: number; half: number; thick: number; pocket: number; y: number; tol: number };
  profile: Profile;
  domeRise: number;
  cells: boolean;
  blade: number;
  /** Where the light reads, above the bar back. */
  topZ: number;
  endArm: number;
  /** Largest straight count allowed (catalogue cap and bed). */
  maxCount: number;
  /** Catalogue straight counts that fit, ascending. */
  counts: number[];
  maxStraight: number;
  bed: Bed;
  mount: Mount;
  clipEvery: number;
}

/** Longest bar of width w that fits the bed at some angle, and the smallest angle (deg) that fits length L. */
export function bedAngle(bed: { x: number; y: number }, L: number, w: number): number | null {
  for (let a = 0; a <= 90; a += 0.5) {
    const r = (a * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    if (L * c + w * s <= bed.x - 1 && L * s + w * c <= bed.y - 1) return a;
  }
  return null;
}

export function maxBarLength(bed: { x: number; y: number }, w: number): number {
  let lo = 0;
  let hi = Math.hypot(bed.x, bed.y);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (bedAngle(bed, m, w) !== null) lo = m;
    else hi = m;
  }
  return lo;
}

export function linDims(p: Params): LinDims {
  const pixel = getPixel(str(p, 'pixel'));
  const strip = pixel.shape.kind === 'strip';
  const pitch = pixel.shape.kind === 'strip' ? pixel.shape.pitch : num(p, 'cellPitch');
  const sw = pixel.shape.kind === 'strip' ? pixel.shape.width : pixel.shape.kind === 'round' ? pixel.shape.d + 0.5 : 10;
  const seatD = pixel.shape.kind === 'strip' ? pixel.shape.depth : 3;
  const tol = seatOf(p);
  const seatW = sw + 2 * tol;
  const wc = seatW + 2;
  const t = num(p, 'wall');
  const W = wc + 2 * t;
  const F = 3;
  const zSh = F + seatD;
  const depth = num(p, 'depth');
  const H = zSh + depth;
  const td = num(p, 'diffuser');
  const fit = fitOf(p);
  const clr = sideOf(p);
  const snap = 0.3;
  const legT = 1;
  // Legs hang from the wall-top chamfer (inner corner at H - t); keep them clear of the seat.
  const legL = Math.max(2.2, Math.min(3.4, depth - t - 1.5));
  // Snap: the barb reaches `snap` past the channel wall over the leg's fit gap; the groove is
  // the barb plus the fit gap.
  const barb = clr + snap;
  const bz0 = H - t - legL + 0.4;
  const groove = { z0: bz0 - clr, z1: bz0 + 2 * barb + clr, d: barb };
  // Clip lips reach 0.45 into the wall face; the groove is that plus the fit gap.
  const clipGroove = { z0: F + 0.5, z1: F + 1.9, d: 0.45 + clr };
  const back = { w: 4.4, d: 1.6 };
  const room = W / 2 - back.w / 2;
  const wide = Math.min(5, room - 1.4);
  // Key pockets are the key grown by half the fit gap, and half a gap deeper than the key is thick.
  const key = { neck: wide * 0.55, wide, half: 6, thick: 1.4, pocket: 1.4 + clr, y: back.w / 2 + room / 2, tol: clr };
  const profile = (['flat', 'dome', 'louvered'].includes(str(p, 'profile')) ? str(p, 'profile') : 'flat') as Profile;
  const domeRise = Math.max(3, Math.min(wc * 0.45, depth * 0.6));
  const topZ = profile === 'dome' ? H + domeRise + td : H + td;
  const bed = bedOf(p);
  const maxStraight = Number(str(p, 'maxStraight')) || 250;
  const maxLen = maxBarLength(bed, W);
  let counts = CATALOGUE_MM.filter((mm) => mm <= maxStraight)
    .map((mm) => Math.max(1, Math.round(mm / pitch)))
    .filter((c) => c * pitch <= maxLen);
  if (!counts.length) counts = [Math.max(1, Math.floor(Math.min(maxLen, maxStraight) / pitch))];
  counts = [...new Set(counts)].sort((a, b) => a - b);
  const mount = (['wall', 'cable', 'none'].includes(str(p, 'mount')) ? str(p, 'mount') : 'wall') as Mount;
  return {
    pixel,
    strip,
    pitch,
    sw,
    seatW,
    seatD,
    wc,
    t,
    W,
    F,
    zSh,
    H,
    depth,
    td,
    fit,
    clr,
    tol,
    snap,
    legT,
    legL,
    barb,
    groove,
    clipGroove,
    back,
    key,
    profile,
    domeRise,
    cells: bool(p, 'cells') && profile !== 'louvered',
    blade: 1,
    topZ,
    // Clear of the rounded end (radius W/2) and long enough for the key pocket.
    endArm: Math.max(key.half + 4, W / 2 + 1.5),
    maxCount: counts[counts.length - 1],
    counts,
    maxStraight,
    bed,
    mount,
    clipEvery: num(p, 'clipEvery'),
  };
}

/**
 * Arm length a joint needs, from the smallest angle between its arms: clear of the hub, the key
 * pocket and the neighbouring arm, rounded up to half a pitch so pixel spacing stays even
 * across the joint. Near-straight joins (>= 179°) need no joint piece at all.
 */
export function jointArm(D: LinDims, minAngleDeg: number): number {
  if (minAngleDeg >= 179) return 0;
  const half = (Math.max(1, minAngleDeg) * Math.PI) / 360;
  const tan = Math.tan(half);
  const need = Math.max(
    // Past the round hub.
    D.W / 2 + 1.5,
    // The next straight's inner corner clears the neighbouring arm.
    (D.W / 2 + 0.5) / tan + 1,
    // Key pockets of neighbouring arms stay apart on the inside of the angle.
    D.key.half + D.key.tol + 0.6 + (D.key.y + D.key.wide / 2 + 0.5) / tan,
  );
  const step = D.pitch / 2;
  return Math.ceil(need / step - 1e-9) * step;
}
