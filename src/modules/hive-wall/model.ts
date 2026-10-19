import { planeXZ, type SketchPlane, type Vec2 } from '../../sketch/types';
import { isVec2, parsePlane } from '../shared/layout';

/**
 * M1 Hive wall: the editable design. A wall is one plane (tiles' fronts face its normal), one or
 * more filled areas on it (outline + holes, plane coords), and a hex lattice laid over them.
 * Everything else (which slots get a whole tile, a trimmed edge tile or nothing, cells, data
 * order, seams, rails) is derived by `layoutWall`, so the design stays small.
 */

export interface HwArea {
  id: string;
  /** Outer loop, CCW, plane coords (mm). */
  outer: Vec2[];
  /** Holes (windows), plane coords. */
  holes: Vec2[][];
}

/** Where the data feed enters the wall: bottom/top, left/right in lattice terms. */
export type HwStart = 'bl' | 'br' | 'tl' | 'tr';
export const HW_STARTS: HwStart[] = ['bl', 'br', 'tl', 'tr'];
export const START_LABEL: Record<HwStart, string> = { bl: 'Bottom left', br: 'Bottom right', tl: 'Top left', tr: 'Top right' };

export interface HwDesign {
  name: string;
  /** The wall. Plane x/y are the outline's coords; tile fronts face u × v. */
  plane: SketchPlane;
  areas: HwArea[];
  /** Lattice origin (a tile centre) in plane coords, and its rotation in degrees. 0 = flat-top rows. */
  lattice: { offset: Vec2; rot: number };
  /** Slot keys "i,j" switched off by hand. */
  off: string[];
  /** Slot keys switched on by hand: a whole tile, whatever the outline says. */
  on: string[];
  start: HwStart;
}

export function emptyDesign(): HwDesign {
  return { name: 'Untitled wall', plane: planeXZ(0), areas: [], lattice: { offset: [0, 0], rot: 0 }, off: [], on: [], start: 'bl' };
}

const isLoop = (l: unknown): l is Vec2[] => Array.isArray(l) && l.length >= 3 && l.every(isVec2);
const isKey = (k: unknown): k is string => typeof k === 'string' && /^-?\d+,-?\d+$/.test(k);

export function parseDesign(json: string): HwDesign {
  const e = emptyDesign();
  try {
    const d = JSON.parse(json) as Partial<HwDesign> | null;
    if (!d || typeof d !== 'object') return e;
    const areas: HwArea[] = [];
    if (Array.isArray(d.areas)) {
      for (const a of d.areas as Partial<HwArea>[]) {
        if (!a || !isLoop(a.outer)) continue;
        const id = typeof a.id === 'string' && a.id ? a.id : `A${String(areas.length + 1).padStart(2, '0')}`;
        areas.push({ id, outer: a.outer, holes: Array.isArray(a.holes) ? a.holes.filter(isLoop) : [] });
      }
    }
    const lat = d.lattice as Partial<HwDesign['lattice']> | undefined;
    return {
      name: typeof d.name === 'string' ? d.name : e.name,
      plane: d.plane ? parsePlane(d.plane) : e.plane,
      areas,
      lattice: {
        offset: lat && isVec2(lat.offset) ? lat.offset : [0, 0],
        rot: lat && typeof lat.rot === 'number' && Number.isFinite(lat.rot) ? lat.rot : 0,
      },
      off: Array.isArray(d.off) ? d.off.filter(isKey) : [],
      on: Array.isArray(d.on) ? d.on.filter(isKey) : [],
      start: HW_STARTS.includes(d.start as HwStart) ? (d.start as HwStart) : 'bl',
    };
  } catch {
    return e;
  }
}

export const slotKey = (i: number, j: number) => `${i},${j}`;
