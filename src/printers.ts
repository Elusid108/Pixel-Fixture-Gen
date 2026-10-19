import type { Bounds } from './types';

export interface Printer {
  id: string;
  name: string;
  /** Usable build volume, mm. */
  x: number;
  y: number;
  z: number;
}

export const PRINTERS: Printer[] = [
  { id: 'bambu-a1mini', name: 'Bambu A1 mini', x: 180, y: 180, z: 180 },
  { id: 'bambu-256', name: 'Bambu X1 / P1 / A1', x: 256, y: 256, z: 256 },
  { id: 'bambu-h2d', name: 'Bambu H2D', x: 325, y: 320, z: 325 },
  { id: 'prusa-mk4', name: 'Prusa MK4', x: 250, y: 210, z: 220 },
  { id: 'prusa-core-one', name: 'Prusa Core One', x: 250, y: 220, z: 270 },
  { id: 'prusa-xl', name: 'Prusa XL', x: 360, y: 360, z: 360 },
  { id: 'ender-220', name: 'Ender 3 class', x: 220, y: 220, z: 250 },
];

export const DEFAULT_PRINTER_ID = 'bambu-256';

export function getPrinter(id: string): Printer {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS.find((p) => p.id === DEFAULT_PRINTER_ID)!;
}

/** Margin kept clear around the bed edge, mm. */
export const BED_MARGIN = 4;

export function footprintFits(w: number, d: number, h: number, printer: Printer): boolean {
  const bx = printer.x - 2 * BED_MARGIN;
  const by = printer.y - 2 * BED_MARGIN;
  if (h > printer.z) return false;
  return (w <= bx && d <= by) || (d <= bx && w <= by);
}

export function boundsFit(b: Bounds, printer: Printer): boolean {
  return footprintFits(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], printer);
}
