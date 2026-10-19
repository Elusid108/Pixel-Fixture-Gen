/**
 * The pixel library. Every fixture's sockets, pitch and paperwork derive from these entries,
 * so swapping a pixel type re-flows the geometry and the schedule together.
 *
 * Power figures are full-white worst case, which is what PSU sizing has to cover.
 */

export type PixelForm = 'node' | 'pcb' | 'module' | 'strip' | 'ring' | 'jewel' | 'matrix';

export type PixelShape =
  | { kind: 'round'; d: number; depth: number }
  | { kind: 'ring'; od: number; id: number; depth: number }
  | { kind: 'strip'; width: number; pitch: number; depth: number }
  | { kind: 'box'; w: number; l: number; depth: number };

export interface PixelType {
  id: string;
  name: string;
  form: PixelForm;
  ic: string;
  volts: number;
  chPerPx: 3 | 4;
  wattsPerPx: number;
  /** Pixels on one physical item (ring, jewel, node). Strip uses pitch instead. */
  pxPerUnit: number;
  shape: PixelShape;
  /** Strand nodes: max centre-to-centre distance the factory lead allows. */
  leadLength?: number;
  /** Strand nodes: nodes per factory strand. */
  strandLength?: number;
  /** Radius of the LED circle on ring/jewel PCBs, outer ring first. */
  ledRadii?: { r: number; count: number }[];
  notes?: string;
}

export const FORM_LABEL: Record<PixelForm, string> = {
  node: 'Node (strand)',
  pcb: 'Module (pixel PCB)',
  module: 'Module',
  strip: 'Strip',
  ring: 'Module (ring PCB)',
  jewel: 'Module (jewel PCB)',
  matrix: 'Module (matrix PCB)',
};

export const PIXELS: PixelType[] = [
  {
    id: 'node-12-bullet',
    name: '12 mm bullet node',
    form: 'node',
    ic: 'WS2811',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 1,
    shape: { kind: 'round', d: 12, depth: 28 },
    leadLength: 100,
    strandLength: 50,
    notes: 'Push-fit into a 12 mm hole in 1.5–3 mm material.',
  },
  {
    id: 'node-12-bullet-12v',
    name: '12 mm bullet node (12 V)',
    form: 'node',
    ic: 'WS2811',
    volts: 12,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 1,
    shape: { kind: 'round', d: 12, depth: 28 },
    leadLength: 100,
    strandLength: 50,
    notes: 'Same body as the 5 V node; less voltage drop on long runs.',
  },
  {
    id: 'pcb-9-ws2812b',
    name: 'Ø9.5 mm pixel PCB',
    form: 'pcb',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 1,
    shape: { kind: 'round', d: 9.5, depth: 2.8 },
    notes: 'Bare 5050 on a round PCB. Solder your own leads.',
  },
  {
    id: 'pcb-9-sk6812-rgbw',
    name: 'Ø9.5 mm pixel PCB (RGBW)',
    form: 'pcb',
    ic: 'SK6812 RGBW',
    volts: 5,
    chPerPx: 4,
    wattsPerPx: 0.4,
    pxPerUnit: 1,
    shape: { kind: 'round', d: 9.5, depth: 2.8 },
    notes: 'Real white channel. Use for warm-white or candle looks.',
  },
  {
    id: 'module-ws2811-3led-12v',
    name: '3-LED injection module (12 V)',
    form: 'module',
    ic: 'WS2811',
    volts: 12,
    chPerPx: 3,
    wattsPerPx: 0.72,
    pxPerUnit: 1,
    shape: { kind: 'box', w: 15, l: 72, depth: 7 },
  },
  {
    id: 'ring-24-ws2812b',
    name: '24-px ring PCB',
    form: 'ring',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 24,
    shape: { kind: 'ring', od: 66, id: 52.5, depth: 3.4 },
    ledRadii: [{ r: 29.6, count: 24 }],
  },
  {
    id: 'ring-16-ws2812b',
    name: '16-px ring PCB',
    form: 'ring',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 16,
    shape: { kind: 'ring', od: 44.5, id: 31.8, depth: 3.4 },
    ledRadii: [{ r: 19.1, count: 16 }],
  },
  {
    id: 'ring-12-ws2812b',
    name: '12-px ring PCB',
    form: 'ring',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 12,
    shape: { kind: 'ring', od: 37, id: 23, depth: 3.4 },
    ledRadii: [{ r: 15, count: 12 }],
  },
  {
    id: 'jewel-7-ws2812b',
    name: '7-px jewel PCB',
    form: 'jewel',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 7,
    shape: { kind: 'round', d: 23, depth: 3.4 },
    ledRadii: [
      { r: 0, count: 1 },
      { r: 7.6, count: 6 },
    ],
  },
  {
    id: 'jewel-7-sk6812-rgbw',
    name: '7-px jewel PCB (RGBW)',
    form: 'jewel',
    ic: 'SK6812 RGBW',
    volts: 5,
    chPerPx: 4,
    wattsPerPx: 0.4,
    pxPerUnit: 7,
    shape: { kind: 'round', d: 23, depth: 3.4 },
    ledRadii: [
      { r: 0, count: 1 },
      { r: 7.6, count: 6 },
    ],
  },
  {
    id: 'strip-60-ws2812b',
    name: 'Strip 60/m, 10 mm',
    form: 'strip',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 1,
    shape: { kind: 'strip', width: 10, pitch: 1000 / 60, depth: 3 },
  },
  {
    id: 'strip-30-ws2812b',
    name: 'Strip 30/m, 10 mm',
    form: 'strip',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 1,
    shape: { kind: 'strip', width: 10, pitch: 1000 / 30, depth: 3 },
  },
  {
    id: 'strip-144-ws2812b',
    name: 'Strip 144/m, 12 mm',
    form: 'strip',
    ic: 'WS2812B',
    volts: 5,
    chPerPx: 3,
    wattsPerPx: 0.3,
    pxPerUnit: 1,
    shape: { kind: 'strip', width: 12, pitch: 1000 / 144, depth: 3 },
  },
  {
    id: 'strip-60-ws2815',
    name: 'Strip 60/m, 12 V (WS2815)',
    form: 'strip',
    ic: 'WS2815',
    volts: 12,
    chPerPx: 3,
    wattsPerPx: 0.24,
    pxPerUnit: 1,
    shape: { kind: 'strip', width: 10, pitch: 1000 / 60, depth: 3 },
    notes: 'Backup data line. A dead pixel does not kill the run.',
  },
  {
    id: 'strip-30-ws2815',
    name: 'Strip 30/m, 12 V (WS2815)',
    form: 'strip',
    ic: 'WS2815',
    volts: 12,
    chPerPx: 3,
    wattsPerPx: 0.24,
    pxPerUnit: 1,
    shape: { kind: 'strip', width: 10, pitch: 1000 / 30, depth: 3 },
    notes: 'Backup data line at half the density: long accent lines on one 12 V feed.',
  },
];

const BY_ID = new Map(PIXELS.map((p) => [p.id, p]));

export function getPixel(id: string): PixelType {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown pixel type "${id}"`);
  return p;
}

export function pixelSpec(p: PixelType): string {
  const s = p.shape;
  const size =
    s.kind === 'round'
      ? `Ø${s.d} mm`
      : s.kind === 'ring'
        ? `Ø${s.od} mm ring`
        : s.kind === 'strip'
          ? `${s.width} mm @ ${s.pitch.toFixed(1)} mm pitch`
          : `${s.w}×${s.l} mm`;
  return `${p.ic} · ${p.volts} V · ${size}`;
}

/** LED positions on a ring/jewel PCB in its own plane, data order. */
export function pcbLedOffsets(p: PixelType): [number, number][] {
  const out: [number, number][] = [];
  for (const ring of p.ledRadii ?? [{ r: 0, count: 1 }]) {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + Math.PI / 2;
      out.push([ring.r * Math.cos(a), ring.r * Math.sin(a)]);
    }
  }
  return out;
}
