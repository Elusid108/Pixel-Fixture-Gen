import { add, scale } from '../../geom/vec';
import { bounds2, ccw, cw, fromPlane, planeNormal, polygonArea, toPlane } from '../../sketch/geom';
import type { SketchPlane, SketchRegion, Vec2 } from '../../sketch/types';
import type { Params } from '../../types';
import type { BenchPreset, SystemCore } from '../../workbench/system';
import { nextId, r1 } from '../shared/layout';
import { buildParamsWith } from '../shared/params';
import { emptyDesign, parseDesign, type FwArea, type FwDesign, type Level } from './model';
import { FW_PARAMS } from './params';

/* ---------------- Presets ---------------- */

const S = 60;
const H = (S * Math.sqrt(3)) / 2;
const wall = (z = 0): SketchPlane => ({ origin: [0, 0, z], u: [1, 0, 0], v: [0, 0, 1] });

function mountain(): FwDesign {
  // A lattice-aligned triangle eight facets a side: four identical full backer tiles. A few
  // hand-set facets break up the bands: a deep ridge on the left flank, raised scree at the foot.
  const overrides: Record<string, Level> = { '-3,4,u': 2, '-3,4,d': 2, '-2,3,u': 2, '1,0,u': 1, '2,0,d': 1 };
  return {
    name: 'Mountain',
    plane: wall(20),
    areas: [
      {
        id: 'W01',
        outer: [
          [-4 * S, 0],
          [4 * S, 0],
          [0, 8 * H],
        ],
        holes: [],
      },
    ],
    driver: { kind: 'gradient', angle: 90, start: 0.1, end: 0.85, invert: false },
    overrides,
    omit: [],
  };
}

function diagonal(): FwDesign {
  return {
    name: 'Diagonal wash',
    plane: wall(20),
    areas: [
      {
        id: 'W01',
        outer: [
          [-300, 0],
          [300, 0],
          [300, 7 * H],
          [-300, 7 * H],
        ],
        holes: [],
      },
    ],
    driver: { kind: 'gradient', angle: 30, start: 0, end: 1, invert: false },
    overrides: {},
    omit: [],
  };
}

function ripple(): FwDesign {
  // Lattice-aligned: six full backer tiles, one part ×6.
  const R = 4 * S;
  const hex = (r: number): Vec2[] => Array.from({ length: 6 }, (_, i) => [r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3)] as Vec2);
  return {
    name: 'Ripple hex',
    plane: wall(4 * H + 30),
    areas: [{ id: 'W01', outer: hex(R), holes: [] }],
    driver: { kind: 'image', angle: 0, start: 0, end: 1, invert: false },
    overrides: {},
    omit: [],
  };
}

export const FW_PRESETS: BenchPreset<FwDesign>[] = [
  { id: 'mountain', code: 'MTN', name: 'Mountain', blurb: 'A triangle eight facets a side, rising to a snow cap. Four identical backer tiles.', make: mountain },
  { id: 'diagonal', code: 'DIA', name: 'Diagonal wash', blurb: '600 × 364 mm panel with a 30° gradient across three depths. Saw-tooth edges where the grid meets the frame.', make: diagonal },
  { id: 'ripple', code: 'HEX', name: 'Ripple hex', blurb: 'A 480 mm hexagon whose depths come from a picture: the built-in ripple, or your own. Six identical backer tiles.', make: ripple },
];

/* ---------------- Adapters ---------------- */

/** Map a region into the design's wall plane (the first region on an empty bench sets the plane). */
export function addRegions(design: FwDesign, regions: SketchRegion[]): FwDesign {
  let d = design;
  for (const r of regions) {
    if (r.outer.length < 3 || Math.abs(polygonArea(r.outer)) < 1) continue;
    const plane = d.areas.length ? d.plane : r.plane;
    const map = (p: Vec2): Vec2 => {
      const q = d.areas.length ? toPlane(fromPlane(p, r.plane), plane) : p;
      return [r1(q[0]), r1(q[1])];
    };
    const area: FwArea = {
      id: nextId('W', d.areas.map((a) => a.id)),
      outer: ccw(r.outer.map(map)),
      holes: r.holes.filter((h) => h.length >= 3).map((h) => cw(h.map(map))),
    };
    d = { ...d, plane, areas: [...d.areas, area] };
  }
  return d;
}

/* ---------------- Selection ids ---------------- */

/** Vertex handles: "W01:0:3" is area W01, loop 0 (outer; 1… are holes), point 3. */
export const vertexId = (area: string, loop: number, i: number) => `${area}:${loop}:${i}`;
export function parseVertexId(id: string): { area: string; loop: number; i: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(id);
  return m ? { area: m[1], loop: Number(m[2]), i: Number(m[3]) } : null;
}
/** Tile selections carry their facets, so Delete can knock them out without the layout: "T03@a,b,u a,b,d". */
export const tileSelId = (tile: string, keys: string[]) => `${tile}@${keys.join(' ')}`;
export const tileOfSel = (id: string) => id.split('@')[0];

export function removeVertex(d: FwDesign, id: string): FwDesign {
  const v = parseVertexId(id);
  if (!v) return d;
  const areas = d.areas.flatMap((a) => {
    if (a.id !== v.area) return [a];
    const loops = [a.outer, ...a.holes];
    const loop = loops[v.loop];
    if (!loop) return [a];
    const next = loop.filter((_, i) => i !== v.i);
    if (v.loop === 0) return next.length >= 3 ? [{ ...a, outer: next }] : [];
    return [{ ...a, holes: a.holes.flatMap((h, i) => (i === v.loop - 1 ? (next.length >= 3 ? [next] : []) : [h])) }];
  });
  return { ...d, areas };
}

const omitKeys = (d: FwDesign, keys: string[]): FwDesign => ({ ...d, omit: [...new Set([...d.omit, ...keys])] });

/* ---------------- Core ---------------- */

export const facetWallCore: SystemCore<FwDesign> = {
  id: 'facet-wall',
  code: 'M5',
  name: 'Facet Wall',
  tagline: 'Low-poly relief: snap-in facets at three depths on bed-sized triangular backers.',
  moduleId: 'facet-wall',
  empty: emptyDesign,
  parse: parseDesign,
  presets: FW_PRESETS,
  buildParams: (design, params: Params, printerId) => buildParamsWith(FW_PARAMS, design, params, printerId),
  frame: (d) => {
    const pts = d.areas.flatMap((a) => a.outer);
    if (!pts.length) return { center: [0, 0, 150], radius: 500 };
    const { min, max } = bounds2(pts);
    const c = fromPlane([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], d.plane);
    const r = Math.hypot(max[0] - min[0], max[1] - min[1]) / 2;
    return { center: add(c, scale(planeNormal(d.plane), 30)), radius: Math.max(200, r) * 1.45 };
  },
  remove: (d, sel) => {
    if (sel.kind === 'vertex') return removeVertex(d, sel.id);
    if (sel.kind === 'area') return { ...d, areas: d.areas.filter((a) => a.id !== sel.id) };
    if (sel.kind === 'facet') return omitKeys(d, [sel.id]);
    if (sel.kind === 'tile') return omitKeys(d, (sel.id.split('@')[1] ?? '').split(' ').filter(Boolean));
    return d;
  },
  fromRegions: (regions, design) => addRegions(design, regions),
};
