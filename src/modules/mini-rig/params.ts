import { FIT_PARAMS, fitOf, seatOf, sideOf } from '../../fit';
import { bool, num, str } from '../../fixtures/util';
import { getPixel, type PixelType } from '../../pixels/library';
import type { ParamSpec, Params } from '../../types';
import { bedOf, DESIGN_PARAM, PRINTER_PARAM, resolveSpecs, type Bed } from '../shared/params';

/** Model scale: everything is a 1:6 F34 rig. */
export const SCALE = 6;
/** F34 is 290 mm square with 48 mm chords; at 1:6 the box is 48 mm (rounded from 48.3). */
export const TRUSS_W = 48;
/** Base plate thickness, mm. Node z of a block standing on a base plate is BASE_T + W/2. */
export const BASE_T = 4;
/** Shortest custom section the planner will make, mm. */
export const MIN_CUSTOM = 20;

export const RIG_JEWELS = ['jewel-7-ws2812b', 'jewel-7-sk6812-rgbw'];
export const RIG_CELLS = ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw', 'node-12-bullet'];
export const RIG_STRIPS = ['strip-60-ws2812b', 'strip-30-ws2812b', 'strip-144-ws2812b', 'strip-60-ws2815'];

/** Section catalogues in real metres; the planner divides by SCALE. */
export const CATALOGUES: Record<string, { label: string; metres: number[] }> = {
  f34: { label: '0.5 / 1 / 1.5 m (83 / 167 / 250 mm)', metres: [0.5, 1, 1.5] },
  short: { label: '0.25 / 0.5 / 1 m (42 / 83 / 167 mm)', metres: [0.25, 0.5, 1] },
  long: { label: '0.5 – 2 m (83 – 333 mm), tall printers', metres: [0.5, 1, 1.5, 2] },
};

export const RIG_PARAMS: ParamSpec[] = [
  DESIGN_PARAM,
  PRINTER_PARAM,
  {
    key: 'pixel',
    label: 'PAR & mover jewel',
    type: 'pixel',
    default: 'jewel-7-ws2812b',
    pixels: RIG_JEWELS,
    group: 'Pixels',
    help: 'The 7-px jewel behind the lens of every PAR and static mover.',
  },
  {
    key: 'cell',
    label: 'Blinder lamp',
    type: 'pixel',
    default: 'pcb-9-ws2812b',
    pixels: RIG_CELLS,
    group: 'Pixels',
    help: 'One pixel per blinder lamp: a 9 mm PCB at the bottom of a reflector cup, or a 12 mm bullet node pushed in from the front.',
  },
  { key: 'strip', label: 'Batten strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: RIG_STRIPS, group: 'Pixels' },
  {
    key: 'battenPx',
    label: 'Batten length',
    type: 'number',
    default: 8,
    min: 4,
    max: 16,
    step: 1,
    unit: 'px',
    group: 'Pixels',
    help: 'Pixels of strip per batten. Shortened automatically if the batten and its yoke would not fit the bed.',
  },
  {
    key: 'catalogue',
    label: 'Section lengths',
    type: 'select',
    default: 'f34',
    options: Object.entries(CATALOGUES).map(([value, c]) => ({ value, label: c.label })),
    group: 'Truss',
    help: 'Stock lengths the planner cuts spans into (real metres, 1:6). Lengths taller than your printer are skipped; a short custom section takes up any remainder.',
  },
  {
    key: 'chord',
    label: 'Chord Ø',
    type: 'number',
    default: 8,
    min: 6,
    max: 10,
    step: 0.5,
    unit: 'mm',
    group: 'Truss',
    help: 'Real F34 chords are 48 mm, so 8 mm at 1:6. The bore inside carries the wiring.',
  },
  {
    key: 'exits',
    label: 'Wire exits',
    type: 'boolean',
    default: true,
    group: 'Truss',
    help: 'A small hole through every chord at mid-section, so instrument tails can leave the chord near where they hang.',
  },
  {
    key: 'hoists',
    label: 'Mini chain hoists',
    type: 'boolean',
    default: true,
    group: 'Truss',
    help: 'A 1:6 chain hoist body above every pick point. Hang it from a shelf with cord and run cord or ball chain down to the pick eye.',
  },
  ...FIT_PARAMS,
];

export const rigParams = (given: Params = {}): Params => resolveSpecs(RIG_PARAMS, given);

export interface RigDims {
  /** Outer box width (block size), mm. */
  W: number;
  chordD: number;
  chordR: number;
  /** Chord centre-to-centre spacing. */
  c: number;
  /** Wire bore inside the chords. */
  boreR: number;
  /** Coupler socket at each chord end. */
  sockR: number;
  sockDepth: number;
  couplerR: number;
  couplerIR: number;
  couplerLen: number;
  lacingR: number;
  /** End frame: plate thickness, bar width, bolt circle and pinwheel offset. */
  frameT: number;
  frameBar: number;
  boltAt: number;
  boltOff: number;
  /** Fit gap between mating printed parts, and half of it per side. */
  fit: number;
  side: number;
  /** Pixel seat clearance. */
  tol: number;
  exits: boolean;
  hoists: boolean;
  /** Stock section lengths that fit this printer, mm, longest first. */
  catalogue: number[];
  /** Every stock length of the chosen catalogue, before the printer filter. */
  catalogueAll: number[];
  maxSection: number;
  bed: Bed;
  jewel: PixelType;
  cell: PixelType;
  strip: PixelType;
  battenPxWanted: number;
  baseT: number;
  baseSize: number;
}

export function rigDims(p: Params): RigDims {
  const bed = bedOf(p);
  const chordD = num(p, 'chord');
  const chordR = chordD / 2;
  const W = TRUSS_W;
  const fit = fitOf(p);
  const side = sideOf(p);
  const sockR = chordR * 0.62;
  // Round fit: the coupler is the chord socket less the fit gap across.
  const couplerR = sockR - side;
  const sockDepth = 6;
  const cat = (CATALOGUES[str(p, 'catalogue')] ?? CATALOGUES.f34).metres.map((m) => (m * 1000) / SCALE);
  const maxSection = bed.z;
  const frameBar = 7;
  return {
    W,
    chordD,
    chordR,
    c: W - chordD,
    boreR: chordR * 0.45,
    sockR,
    sockDepth,
    couplerR,
    couplerIR: Math.max(0.8, couplerR - 0.9),
    // It bottoms out in both sockets: half a gap short at each end.
    couplerLen: 2 * sockDepth - fit,
    lacingR: Math.max(1.2, chordD * 0.19),
    frameT: 3,
    frameBar,
    boltAt: W / 2 - frameBar / 2,
    boltOff: 8,
    fit,
    side,
    tol: seatOf(p),
    exits: bool(p, 'exits'),
    hoists: bool(p, 'hoists'),
    catalogue: cat.filter((l) => l <= maxSection + 1e-6).sort((a, b) => b - a),
    catalogueAll: [...cat].sort((a, b) => b - a),
    maxSection,
    bed,
    jewel: getPixel(str(p, 'pixel')),
    cell: getPixel(str(p, 'cell')),
    strip: getPixel(str(p, 'strip')),
    battenPxWanted: Math.round(num(p, 'battenPx')),
    baseT: BASE_T,
    baseSize: 100,
  };
}
