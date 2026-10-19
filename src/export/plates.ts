import { mul, Rz, T } from '../geom/mat';
import { BED_MARGIN, footprintFits, type Printer } from '../printers';
import type { Bounds, Mat4 } from '../types';

export interface PackInput {
  id: string;
  bounds: Bounds;
  count: number;
}

export interface PlateItem {
  partId: string;
  instance: number;
  /** Centre of the footprint on the bed, mm from the bed's front-left corner. */
  x: number;
  y: number;
  rot: 0 | 90;
  w: number;
  d: number;
  oversize: boolean;
}

export interface Plate {
  items: PlateItem[];
}

const GAP = 6;

/**
 * Shelf packing onto as many plates as it takes. Largest footprints go first. A part that
 * fits nowhere still gets its own plate, flagged, so nothing silently drops out of an export.
 */
export function packPlates(parts: PackInput[], printer: Printer): Plate[] {
  const W = printer.x - 2 * BED_MARGIN;
  const D = printer.y - 2 * BED_MARGIN;
  const items = parts.flatMap((p) => {
    const w = p.bounds.max[0] - p.bounds.min[0];
    const d = p.bounds.max[1] - p.bounds.min[1];
    const h = p.bounds.max[2] - p.bounds.min[2];
    const oversize = !footprintFits(w, d, h, printer);
    return Array.from({ length: p.count }, (_, i) => ({ partId: p.id, instance: i, w, d, oversize }));
  });
  items.sort((a, b) => b.w * b.d - a.w * a.d);

  interface Shelf {
    y: number;
    h: number;
    x: number;
  }
  const plates: { plate: Plate; shelves: Shelf[]; used: number }[] = [];

  const tryPlace = (slot: (typeof plates)[number], w: number, d: number): { x: number; y: number } | null => {
    for (const s of slot.shelves) {
      if (d <= s.h && s.x + w <= W) {
        const at = { x: s.x, y: s.y };
        s.x += w + GAP;
        return at;
      }
    }
    if (slot.used + d <= D && w <= W) {
      const at = { x: 0, y: slot.used };
      slot.shelves.push({ y: slot.used, h: d, x: w + GAP });
      slot.used += d + GAP;
      return at;
    }
    return null;
  };

  for (const it of items) {
    if (it.oversize) {
      plates.push({ plate: { items: [{ ...it, x: printer.x / 2, y: printer.y / 2, rot: 0 }] }, shelves: [], used: D });
      continue;
    }
    // Prefer the orientation that lies long side along X (shallower shelves).
    const orients: [number, number, 0 | 90][] = it.w >= it.d ? [[it.w, it.d, 0], [it.d, it.w, 90]] : [[it.d, it.w, 90], [it.w, it.d, 0]];
    let placed = false;
    for (const slot of plates) {
      for (const [w, d, rot] of orients) {
        const at = tryPlace(slot, w, d);
        if (at) {
          slot.plate.items.push({ ...it, x: BED_MARGIN + at.x + w / 2, y: BED_MARGIN + at.y + d / 2, rot, w, d });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      const slot = { plate: { items: [] as PlateItem[] }, shelves: [] as Shelf[], used: 0 };
      plates.push(slot);
      for (const [w, d, rot] of orients) {
        const at = tryPlace(slot, w, d);
        if (at) {
          slot.plate.items.push({ ...it, x: BED_MARGIN + at.x + w / 2, y: BED_MARGIN + at.y + d / 2, rot, w, d });
          break;
        }
      }
    }
  }
  return plates.map((p) => p.plate);
}

/** Transform from a part's print-oriented mesh to its spot on the bed. */
export function plateTransform(b: Bounds, item: PlateItem): Mat4 {
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  return mul(T(item.x, item.y, 0), Rz(item.rot), T(-cx, -cy, -b.min[2]));
}
