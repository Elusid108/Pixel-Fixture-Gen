import { num, str } from '../../fixtures/util';
import { getPixel, type PixelType } from '../../pixels/library';
import type { ParamSpec, Params } from '../../types';
import { bedOf, DESIGN_PARAM, PRINTER_PARAM, resolveSpecs, type Bed } from '../shared/params';

/** Pixel choices per segment kind. The `pixel` param is the lattice strip. */
export const STRIP_PIXELS = ['strip-60-ws2812b', 'strip-30-ws2812b', 'strip-144-ws2812b', 'strip-60-ws2815'];
export const DOT_PIXELS = ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw'];
export const NODE_PIXELS = ['node-12-bullet', 'node-12-bullet-12v'];
export const RING_PIXELS = ['ring-16-ws2812b', 'ring-12-ws2812b', 'ring-24-ws2812b'];
export const JEWEL_PIXELS = ['jewel-7-ws2812b', 'jewel-7-sk6812-rgbw'];

export const CS_PARAMS: ParamSpec[] = [
  DESIGN_PARAM,
  PRINTER_PARAM,
  { key: 'pixel', label: 'Lattice strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: STRIP_PIXELS, group: 'Pixels', help: 'Strip runs stuck on the lattice core, cut to length per run.' },
  { key: 'dotPixel', label: 'Dots (helix, louver)', type: 'pixel', default: 'pcb-9-ws2812b', pixels: DOT_PIXELS, group: 'Pixels', help: 'Round pixel PCBs pressed into seats, wired in series.' },
  { key: 'nodePixel', label: 'Pixel ring nodes', type: 'pixel', default: 'node-12-bullet', pixels: NODE_PIXELS, group: 'Pixels', help: 'Bullet nodes push through 12 mm holes in the shell.' },
  { key: 'ringPixel', label: 'Ring band PCB', type: 'pixel', default: 'ring-16-ws2812b', pixels: RING_PIXELS, group: 'Pixels' },
  { key: 'capPixel', label: 'Cap jewel', type: 'pixel', default: 'jewel-7-ws2812b', pixels: JEWEL_PIXELS, group: 'Pixels', help: 'Lights the dome and the Fresnel cap.' },
  { key: 'dia', label: 'Column Ø', type: 'number', default: 90, min: 80, max: 120, step: 5, unit: 'mm', group: 'Column', help: 'Every segment and cap shares this diameter, so they stack in any order.' },
  { key: 'wall', label: 'Shell wall', type: 'number', default: 3, min: 2.4, max: 4, step: 0.2, unit: 'mm', group: 'Column' },
  { key: 'louverAngle', label: 'Louver angle', type: 'number', default: 45, min: 45, max: 60, step: 1, unit: '°', group: 'Column', help: 'From horizontal. 45° and steeper print without supports.' },
  { key: 'louverPitch', label: 'Louver pitch', type: 'number', default: 16, min: 14, max: 28, step: 1, unit: 'mm', group: 'Column', help: 'Vertical distance between louvers: one pixel cell per gap.' },
  { key: 'baseD', label: 'Base Ø', type: 'number', default: 150, min: 120, max: 170, step: 5, unit: 'mm', group: 'Base', help: 'Clamped to your bed. Wider is steadier.' },
  { key: 'bayH', label: 'Bay height', type: 'number', default: 70, min: 50, max: 110, step: 5, unit: 'mm', group: 'Base', help: 'Room for the PSU and controller under the 45° shoulder.' },
  { key: 'fit', label: 'Spigot clearance', type: 'number', default: 0.25, min: 0.1, max: 0.5, step: 0.05, unit: 'mm', group: 'Fit', help: 'Radial gap between a spigot and the socket above it.' },
  { key: 'tol', label: 'Pixel seat clearance', type: 'number', default: 0.15, min: 0, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit' },
];

export function csParams(given: Params = {}): Params {
  return resolveSpecs(CS_PARAMS, given);
}

export interface CsDims {
  strip: PixelType;
  dot: PixelType;
  node: PixelType;
  ring: PixelType;
  jewel: PixelType;
  /** Column outer radius, shell wall, shell inner radius. */
  R: number;
  wall: number;
  Ri: number;
  fit: number;
  tol: number;
  /** Joint: spigot height, spigot outer/inner radius, key rib, M3 screw height in the socket. */
  J: number;
  rs: number;
  rsi: number;
  keyW: number;
  keyD: number;
  /** Central wire chase radius through every carrier and core. */
  chaseR: number;
  /** Carrier discs (ring band, cap jewel): thickness; they rest on the spigot below. */
  carrierT: number;
  /** Ridge that traps a carrier, z in the segment's own frame. */
  ridgeZ: number;
  louverAngle: number;
  louverPitch: number;
  /** Base: radius, bay height, plate, feet, where the bay starts and the column starts. */
  baseR: number;
  bayH: number;
  plateT: number;
  footH: number;
  bayZ: number;
  baseTop: number;
  /** Hanging: hanger disc thickness, canopy radius and height. */
  hangerT: number;
  canopyR: number;
  canopyH: number;
  maxSegH: number;
  bed: Bed;
}

export function csDims(p: Params): CsDims {
  const bed = bedOf(p);
  const R = num(p, 'dia') / 2;
  const wall = num(p, 'wall');
  const Ri = R - wall;
  const fit = num(p, 'fit');
  const J = 8;
  const rs = Ri - fit;
  const rsi = rs - 3;
  const carrierT = 4;
  const baseR = Math.min(num(p, 'baseD') / 2, bed.short / 2 - 1);
  const plateT = 3;
  const footH = 4;
  // The bay prints upright: bay wall, 45° shoulder, then the spigot. Keep it under the bed's Z.
  const bayH = Math.min(num(p, 'bayH'), bed.z - 2 - (baseR - R) - J);
  const bayZ = footH + plateT;
  return {
    strip: getPixel(str(p, 'pixel')),
    dot: getPixel(str(p, 'dotPixel')),
    node: getPixel(str(p, 'nodePixel')),
    ring: getPixel(str(p, 'ringPixel')),
    jewel: getPixel(str(p, 'capPixel')),
    R,
    wall,
    Ri,
    fit,
    tol: num(p, 'tol'),
    J,
    rs,
    rsi,
    keyW: 4,
    keyD: 1.2,
    chaseR: 8,
    carrierT,
    ridgeZ: J + carrierT + 0.3,
    louverAngle: num(p, 'louverAngle'),
    louverPitch: num(p, 'louverPitch'),
    baseR,
    bayH,
    plateT,
    footH,
    bayZ,
    baseTop: bayZ + bayH + (baseR - R),
    hangerT: 6,
    canopyR: Math.min(R + 22, bed.short / 2 - 1),
    canopyH: 36,
    maxSegH: Math.min(120, bed.z - J - 2),
    bed,
  };
}
