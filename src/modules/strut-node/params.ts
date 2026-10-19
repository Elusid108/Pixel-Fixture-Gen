import { num, str } from '../../fixtures/util';
import { fitOf, FIT_PARAMS, seatOf, sideOf } from '../../fit';
import { getPixel, type PixelType } from '../../pixels/library';
import { BED_MARGIN, getPrinter, PRINTERS } from '../../printers';
import type { ParamSpec, Params } from '../../types';

export const SN_PIXELS = ['strip-60-ws2812b', 'strip-30-ws2812b', 'strip-144-ws2812b', 'strip-60-ws2815', 'node-12-bullet', 'node-12-bullet-12v'];

export type LabelMode = 'types' | 'ids' | 'none';

/** System parameters. `design` carries the whole wireframe as JSON so a build is one plain message. */
export const SN_PARAMS: ParamSpec[] = [
  { key: 'design', label: 'Design', type: 'json', default: '' },
  { key: 'printer', label: 'Printer', type: 'select', default: 'bambu-256', options: PRINTERS.map((p) => ({ value: p.id, label: p.name })), hidden: true },
  { key: 'pixel', label: 'Pixel', type: 'pixel', default: 'strip-60-ws2812b', pixels: SN_PIXELS, group: 'Pixels' },
  { key: 'nodePitch', label: 'Node spacing', type: 'number', default: 40, min: 25, max: 100, step: 1, unit: 'mm', group: 'Pixels', help: 'Strand nodes only. Nodes lie along the strut axis in a cradle.' },
  { key: 'tubeOD', label: 'Tube Ø', type: 'number', default: 22, min: 18, max: 40, step: 1, unit: 'mm', group: 'Struts' },
  { key: 'lineW', label: 'Line width', type: 'number', default: 0.6, min: 0.4, max: 1, step: 0.05, unit: 'mm', group: 'Struts', help: 'Extrusion width of the diffuser wall.' },
  { key: 'tubeLines', label: 'Tube wall', type: 'number', default: 1, min: 1, max: 3, step: 1, unit: 'lines', group: 'Struts', help: '1 line = spiral vase mode. Wall = lines × line width.' },
  { key: 'insert', label: 'Spigot depth', type: 'number', default: 14, min: 8, max: 30, step: 1, unit: 'mm', group: 'Hubs', help: 'How far each tube slides over its hub spigot.' },
  { key: 'core', label: 'Hub core radius', type: 'number', default: 18, min: 12, max: 40, step: 1, unit: 'mm', group: 'Hubs' },
  { key: 'maxOffset', label: 'Max socket offset', type: 'number', default: 70, min: 30, max: 140, step: 1, unit: 'mm', group: 'Hubs', help: 'Sockets push out from the core until neighbouring tubes clear. Past this the hub is flagged.' },
  { key: 'overhang', label: 'Max overhang', type: 'number', default: 60, min: 40, max: 70, step: 1, unit: '°', group: 'Hubs', help: 'From vertical. 60° matches a slicer support threshold of 30°.' },
  {
    key: 'labels',
    label: 'Engraving',
    type: 'select',
    default: 'types',
    options: [
      { value: 'types', label: 'Type IDs (HA · SA), dedupes' },
      { value: 'ids', label: 'Unique IDs (H07 · S12)' },
      { value: 'none', label: 'None' },
    ],
    group: 'Hubs',
    help: 'Type IDs let identical hubs print as one part ×N. Unique IDs make every hub its own part.',
  },
  ...FIT_PARAMS,
];

export interface SpineDims {
  kind: 'strip' | 'node';
  /** Bar width (side to side) and the f-range it occupies inside the tube. */
  w: number;
  fBottom: number;
  fBarTop: number;
  /** Strip: recess for the tape. Node: trough radius and centre height. */
  recessW: number;
  recessD: number;
  troughR: number;
  troughF: number;
  /** Wire channel in the underside. */
  grooveW: number;
  grooveD: number;
  /** Largest radius the profile (with pixels) reaches from the axis. */
  reach: number;
}

export interface SnDims {
  pixel: PixelType;
  nodePitch: number;
  tubeR: number;
  tubeIR: number;
  wall: number;
  collarR: number;
  spigR: number;
  coreR: number;
  insert: number;
  /** Total fit gap between mating printed parts, and half of it per side. */
  fit: number;
  side: number;
  /** Dowel hole radius in the split hub halves: Ø3 pin + fit. */
  pinR: number;
  /** Axial gap between each spine end and its key-slot floor. */
  keyGap: number;
  /** Pixel seat clearance (strip recess, node trough). */
  seat: number;
  labels: LabelMode;
  overhangDeg: number;
  maxOffset: number;
  bed: { x: number; y: number; z: number; name: string };
  wireR: number;
  slotDepth: number;
  labelH: number;
  /** Axial room the engraving needs on each collar, plus margins. */
  labelBand: number;
  /** Where a collar's top flank leaves the core sphere. */
  tExit: number;
  cavR: number;
  spine: SpineDims;
  /** Coupler that joins tube segments when a strut is taller than the bed. */
  coupler: { ins: number; ridge: number; plugR: number; boreR: number };
}

export function snDims(p: Params): SnDims {
  const pixel = getPixel(str(p, 'pixel'));
  const printer = getPrinter(str(p, 'printer'));
  const tubeR = num(p, 'tubeOD') / 2;
  const wall = num(p, 'lineW') * num(p, 'tubeLines');
  const tubeIR = tubeR - wall;
  const fit = fitOf(p);
  const side = sideOf(p);
  // Round fit: the tube bore is the female, so the spigot is Ø(bore − fit).
  const spigR = tubeIR - side;
  const collarR = tubeR;
  const coreR = Math.max(num(p, 'core'), collarR + 4);
  const labels = (str(p, 'labels') as LabelMode) ?? 'types';
  const labelH = 3;
  const labelBand = labels === 'none' ? 3 : 2 * labelH + 1 + 2.5;
  // The spine slides inside the tube bore: keep its reach a fit gap under the bore.
  const inner = tubeIR - side;

  let spine: SpineDims;
  if (pixel.shape.kind === 'strip') {
    const sw = pixel.shape.width;
    const sd = pixel.shape.depth;
    const barH = 4.5;
    const recessD = 0.6;
    const stack = barH - recessD + sd;
    const fBottom = -stack / 2;
    const w = sw + 2.4;
    const fBarTop = fBottom + barH;
    const top = fBarTop - recessD + sd;
    spine = {
      kind: 'strip',
      w,
      fBottom,
      fBarTop,
      recessW: sw + 2 * seatOf(p),
      recessD,
      troughR: 0,
      troughF: 0,
      grooveW: 4,
      grooveD: 2,
      reach: Math.max(Math.hypot(w / 2, fBottom), Math.hypot(w / 2, fBarTop), Math.hypot(sw / 2, top)),
    };
  } else {
    const nd = pixel.shape.kind === 'round' ? pixel.shape.d : 12;
    const r = nd / 2;
    const troughF = inner - 0.1 - r;
    const fBottom = troughF - r - 3;
    let w = nd + 2;
    const half = Math.sqrt(Math.max(0, inner * inner - fBottom * fBottom));
    w = Math.min(w, Math.max(4, 2 * half - 0.4));
    spine = {
      kind: 'node',
      w,
      fBottom,
      fBarTop: troughF,
      recessW: 0,
      recessD: 0,
      troughR: r + seatOf(p),
      troughF,
      grooveW: 3.5,
      grooveD: 1.5,
      reach: Math.max(Math.hypot(w / 2, fBottom), Math.hypot(w / 2, troughF), troughF + r),
    };
  }

  const plugR = tubeIR - side;
  return {
    pixel,
    nodePitch: num(p, 'nodePitch'),
    tubeR,
    tubeIR,
    wall,
    collarR,
    spigR,
    coreR,
    insert: num(p, 'insert'),
    fit,
    side,
    pinR: 1.5 + side,
    keyGap: side,
    seat: seatOf(p),
    labels,
    overhangDeg: num(p, 'overhang'),
    maxOffset: num(p, 'maxOffset'),
    bed: { x: printer.x - 2 * BED_MARGIN, y: printer.y - 2 * BED_MARGIN, z: printer.z, name: printer.name },
    wireR: 3,
    slotDepth: 6,
    labelH,
    labelBand,
    tExit: Math.sqrt(coreR * coreR - collarR * collarR),
    cavR: coreR * 0.32,
    spine,
    coupler: { ins: 12, ridge: 2, plugR, boreR: plugR - 1.6 },
  };
}

