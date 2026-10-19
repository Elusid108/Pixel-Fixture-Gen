import { planeNormal } from '../../sketch/geom';
import type { SketchPlane } from '../../sketch/types';
import type { Vec3 } from '../../types';
import { isVec3, parsePlane } from '../shared/layout';

/**
 * M2 Linea: the editable design. A design is a set of runs: polylines drawn on a plane. Bars
 * lie in that plane with their back on it and their light facing the plane normal. Joints
 * (corners, T, X), straights, data order and parts are all derived from the runs.
 */

export interface LineaRun {
  id: string;
  /** Drawing plane. The bar backs lie on it. */
  plane: SketchPlane;
  /** Vertices, Z-up mm. Kept exactly as locked (no rounding), so straights stay pitch multiples. */
  pts: Vec3[];
  closed: boolean;
  /** Light direction: the plane normal (up on the floor, -Y toward the viewer on the front wall). */
  face: Vec3;
}

export interface LineaDesign {
  name: string;
  runs: LineaRun[];
  /** Run whose first vertex takes the controller feed. '' means the first run. */
  feed: string;
}

export function emptyDesign(): LineaDesign {
  return { name: 'Untitled', runs: [], feed: '' };
}

function parseRun(x: unknown): LineaRun | null {
  const r = x as Partial<LineaRun> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !Array.isArray(r.pts)) return null;
  const pts = r.pts.filter(isVec3);
  const closed = r.closed === true && pts.length >= 3;
  if (pts.length < 2) return null;
  const plane = parsePlane(r.plane);
  const face = isVec3(r.face) && Math.hypot(...r.face) > 1e-6 ? r.face : planeNormal(plane);
  return { id: r.id, plane, pts, closed, face };
}

/** Defensive parse: malformed input yields a valid (possibly empty) design. Never rounds. */
export function parseDesign(json: string): LineaDesign {
  try {
    const d = JSON.parse(json) as Partial<LineaDesign> | null;
    if (!d || typeof d !== 'object') return emptyDesign();
    const runs: LineaRun[] = [];
    const seen = new Set<string>();
    for (const x of Array.isArray(d.runs) ? d.runs : []) {
      const r = parseRun(x);
      if (r && !seen.has(r.id)) {
        seen.add(r.id);
        runs.push(r);
      }
    }
    return {
      name: typeof d.name === 'string' ? d.name : 'Untitled',
      runs,
      feed: typeof d.feed === 'string' ? d.feed : '',
    };
  } catch {
    return emptyDesign();
  }
}

/** The run whose start takes the feed. */
export function feedRun(d: LineaDesign): LineaRun | undefined {
  return d.runs.find((r) => r.id === d.feed) ?? d.runs[0];
}

/** -0 → 0 and tiny float noise kept as is: JSON round-trips exactly and deep-equals. */
export const clean = (p: Vec3): Vec3 => [p[0] + 0, p[1] + 0, p[2] + 0];
