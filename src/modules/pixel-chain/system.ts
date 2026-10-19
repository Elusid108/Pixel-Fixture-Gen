import { dedupeConsecutive, polylineLength, simplify } from '../../sketch/geom';
import type { SketchPath } from '../../sketch/types';
import type { Params, Vec3 } from '../../types';
import type { BenchPreset, SystemCore } from '../../workbench/system';
import { dist, dot, norm, cross } from '../../geom/vec';
import { buildParamsWith } from '../shared/params';
import { nextId, r1 } from '../shared/layout';
import { effectivePitch, pcDims } from './dims';
import { DEFAULT_SAG, emptyDesign, parseDesign, removeFromDesign, spanCount, type PcDesign, type PcGarland } from './model';
import { PC_PARAMS } from './params';
import { garlandBounds, layoutGarland, pcParams, planChain } from './plan';

/** Drawn garlands on the bench floor hang from this height, mm. */
export const HANG_Z = 600;
/** Drawn garlands are lifted until their lowest bead clears the floor by this much, mm. */
export const FLOOR_CLEAR = 40;

const garland = (id: string, anchors: Vec3[], sag: number, extra: Partial<PcGarland> = {}): PcGarland => {
  const g: PcGarland = { id, anchors, sags: [], ...extra };
  g.sags = Array.from({ length: spanCount(g) }, () => sag);
  return g;
};

export const PC_PRESETS: BenchPreset<PcDesign>[] = [
  {
    id: 'swags',
    code: 'SWG',
    name: 'Three swags',
    blurb: 'A classic festoon: four anchors at 700 mm, three 500 mm swags at 20% sag.',
    make: () => ({
      name: 'Three swags',
      garlands: [
        garland(
          'G01',
          [
            [-750, 0, 700],
            [-250, 0, 700],
            [250, 0, 700],
            [750, 0, 700],
          ],
          20,
        ),
      ],
    }),
  },
  {
    id: 'drape',
    code: 'DRP',
    name: 'Deep drape',
    blurb: 'One long, deep drape between two hooks 800 mm apart.',
    make: () => ({
      name: 'Deep drape',
      garlands: [
        garland(
          'G01',
          [
            [-400, 0, 900],
            [400, 0, 900],
          ],
          40,
        ),
      ],
    }),
  },
  {
    id: 'canopy',
    code: 'ZIG',
    name: 'Zig-zag canopy',
    blurb: 'Five anchors zig-zagging across a 2 m canopy. Turned anchor links take the corners.',
    make: () => ({
      name: 'Zig-zag canopy',
      garlands: [
        garland(
          'G01',
          [
            [-1000, -250, 750],
            [-500, 250, 750],
            [0, -250, 750],
            [500, 250, 750],
            [1000, -250, 750],
          ],
          22,
        ),
      ],
    }),
  },
  {
    id: 'ring',
    code: 'RNG',
    name: 'Chandelier ring',
    blurb: 'A closed ring of six swags hung from a 900 mm hoop.',
    make: () => ({
      name: 'Chandelier ring',
      garlands: [
        garland(
          'G01',
          Array.from({ length: 6 }, (_, i) => {
            const t = (i / 6) * Math.PI * 2;
            return [r1(450 * Math.cos(t)), r1(450 * Math.sin(t)), 800] as Vec3;
          }),
          15,
          { closed: true },
        ),
      ],
    }),
  },
];

/** Raise a garland until its lowest bead clears the floor. */
function lift(g: PcGarland, params: Params): PcGarland {
  const gp = layoutGarland(g, pcDims(pcParams(params)));
  if (gp.minZ >= FLOOR_CLEAR) return g;
  const dz = Math.ceil(FLOOR_CLEAR - gp.minZ);
  return { ...g, anchors: g.anchors.map((a) => [a[0], a[1], r1(a[2] + dz)] as Vec3) };
}

/**
 * Sketch → garlands. Each path becomes one garland; its corners become anchors (a freehand
 * path is simplified first, and anchors closer than two links merge). A path drawn on the bench
 * floor hangs at HANG_Z; any garland is lifted until it clears the floor. Closed paths make rings.
 */
export function garlandsFromPaths(paths: SketchPath[], design: PcDesign, params: Params): PcDesign {
  const P = pcParams(params);
  const d = pcDims(P);
  const pitch = effectivePitch(d, d.pitchParam).pitch;
  const minGap = 2 * pitch;
  const garlands = [...design.garlands];
  for (const path of paths) {
    let pts = dedupeConsecutive(path.pts);
    if (pts.length < 2) continue;
    const closed = path.closed && pts.length >= 3;
    const length = polylineLength(closed ? [...pts, pts[0]] : pts);
    const eps = Math.min(25, Math.max(4, length * 0.02));
    pts = closed ? simplify([...pts, pts[0]], eps).slice(0, -1) : simplify(pts, eps);

    // Floor-plane drawings hang at a sensible height; anything else keeps its Z.
    const n = path.plane ? norm(cross(path.plane.u, path.plane.v)) : null;
    const horizontal = n ? Math.abs(dot(n, [0, 0, 1])) > 0.99 : pts.every((p) => Math.abs(p[2] - pts[0][2]) < 1e-6);
    if (horizontal) {
      const z = pts[0][2] > 0 ? pts[0][2] : HANG_Z;
      pts = pts.map((p) => [p[0], p[1], z] as Vec3);
    }

    const anchors: Vec3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const last = i === pts.length - 1;
      if (dist(p, anchors[anchors.length - 1]) >= minGap) anchors.push(p);
      else if (last && !closed && anchors.length > 1) anchors[anchors.length - 1] = p;
    }
    if (closed && anchors.length > 3 && dist(anchors[anchors.length - 1], anchors[0]) < minGap) anchors.pop();
    if (anchors.length < 2) {
      // A short stroke: hang one swag between its ends if there's room for it.
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (dist(a, b) < 1.6 * pitch) continue;
      anchors.splice(0, anchors.length, a, b);
    }
    const id = nextId('G', garlands.map((g) => g.id));
    const g = garland(
      id,
      anchors.map((a) => a.map(r1) as Vec3),
      DEFAULT_SAG,
      closed && anchors.length >= 3 ? { closed: true } : {},
    );
    garlands.push(lift(g, P));
  }
  return { ...design, garlands };
}

/** M7 Pixel Chain, pure half. */
export const pixelChainCore: SystemCore<PcDesign> = {
  id: 'pixel-chain',
  code: 'M7',
  name: 'Pixel Chain',
  tagline: 'Hinged diffuser links, one node each, draped in catenary garlands.',
  moduleId: 'pixel-chain',
  empty: emptyDesign,
  parse: parseDesign,
  presets: PC_PRESETS,
  buildParams: (design, params, printerId) => buildParamsWith(PC_PARAMS, design, params, printerId),
  frame: (design) => {
    const plan = planChain(design, {});
    const boxes = plan.garlands.map(garlandBounds);
    if (!boxes.length) return { center: [0, 0, 400], radius: 700 };
    const min = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k])));
    const max = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k])));
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const half = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    return { center, radius: Math.max(300, half * 1.35) };
  },
  remove: removeFromDesign,
  fromPaths: garlandsFromPaths,
  fromPaths3D: garlandsFromPaths,
};
