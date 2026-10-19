import { isVec2, parsePlane } from '../shared/layout';
import { planeXZ } from '../../sketch/types';
import type { SketchPlane, Vec2 } from '../../sketch/types';

/**
 * M5 Facet Wall: the editable design. A wall plane, one or more outlines (with holes) drawn
 * on it, and a depth driver. The triangular grid, the facets that fit whole inside the
 * outlines, their depths, the backer tiles and the data order are all derived from this by
 * `layoutFacets`, so the design stays small enough to ride in a param.
 */

/** A filled outline on the wall plane, in plane coords (mm). Outer loop CCW, holes CW. */
export interface FwArea {
  id: string;
  outer: Vec2[];
  holes: Vec2[][];
}

export type DriverKind = 'gradient' | 'image';

/** What sets each facet's depth (before per-facet overrides). */
export interface FwDriver {
  kind: DriverKind;
  /** Gradient direction in the wall plane, degrees from plane +x, counter-clockwise. Depth rises along it. */
  angle: number;
  /** Where the ramp starts and ends, as fractions (0–1) of the run across the wall (or of image brightness). */
  start: number;
  end: number;
  /** Swap shallow and deep. */
  invert: boolean;
}

export type Level = 0 | 1 | 2;

export interface FwDesign {
  name: string;
  /** The wall surface. Facets face along its normal (u × v); backers sit on it. */
  plane: SketchPlane;
  areas: FwArea[];
  driver: FwDriver;
  /** Per-facet manual depth, by facet key ("a,b,u" / "a,b,d"). Wins over the driver. */
  overrides: Record<string, Level>;
  /** Knocked-out facets (no facet, no node, no backer under them), by facet key. */
  omit: string[];
}

export const defaultDriver = (): FwDriver => ({ kind: 'gradient', angle: 30, start: 0, end: 1, invert: false });

/** A vertical wall facing the viewer (-Y), standing on the bench floor. */
export const defaultPlane = (): SketchPlane => planeXZ(0);

export function emptyDesign(): FwDesign {
  return { name: 'Untitled wall', plane: defaultPlane(), areas: [], driver: defaultDriver(), overrides: {}, omit: [] };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const loop = (x: unknown): Vec2[] | null => (Array.isArray(x) && x.every(isVec2) && x.length >= 3 ? (x as Vec2[]) : null);

function parseArea(x: unknown, i: number): FwArea | null {
  const a = x as Partial<FwArea> | null;
  if (!a || typeof a !== 'object') return null;
  const outer = loop(a.outer);
  if (!outer) return null;
  const holes = Array.isArray(a.holes) ? a.holes.map(loop).filter((h): h is Vec2[] => h !== null) : [];
  return { id: typeof a.id === 'string' && a.id ? a.id : `W${String(i + 1).padStart(2, '0')}`, outer, holes };
}

function parseDriver(x: unknown): FwDriver {
  const d = (x && typeof x === 'object' ? x : {}) as Partial<FwDriver>;
  const def = defaultDriver();
  const frac = (v: unknown, f: number) => (finite(v) ? Math.min(1, Math.max(0, v)) : f);
  return {
    kind: d.kind === 'image' ? 'image' : 'gradient',
    angle: finite(d.angle) ? d.angle : def.angle,
    start: frac(d.start, def.start),
    end: frac(d.end, def.end),
    invert: d.invert === true,
  };
}

const isLevel = (v: unknown): v is Level => v === 0 || v === 1 || v === 2;

/** Defensive parse: malformed input yields a valid (possibly empty) design. */
export function parseDesign(json: string): FwDesign {
  try {
    const d = JSON.parse(json) as Partial<FwDesign> | null;
    if (!d || typeof d !== 'object') return emptyDesign();
    const overrides: Record<string, Level> = {};
    if (d.overrides && typeof d.overrides === 'object') for (const [k, v] of Object.entries(d.overrides)) if (isLevel(v)) overrides[k] = v;
    const areas = Array.isArray(d.areas) ? d.areas.map(parseArea).filter((a): a is FwArea => a !== null) : [];
    return {
      name: typeof d.name === 'string' ? d.name : 'Untitled wall',
      plane: d.plane ? parsePlane(d.plane) : defaultPlane(),
      areas,
      driver: parseDriver(d.driver),
      overrides,
      omit: Array.isArray(d.omit) ? d.omit.filter((k): k is string => typeof k === 'string') : [],
    };
  } catch {
    return emptyDesign();
  }
}
