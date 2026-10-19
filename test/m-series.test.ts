import { describe, expect, it } from 'vitest';
import { dist } from '../src/geom/vec';
import { fwParams } from '../src/modules/facet-wall/params';
import { layoutFacets } from '../src/modules/facet-wall/layout';
import { fromLattice, hexPts, layoutWall } from '../src/modules/hive-wall/layout';
import { lineaParams } from '../src/modules/linea/params';
import { planLinea } from '../src/modules/linea/plan';
import { TRUSS_W, rigParams } from '../src/modules/mini-rig/params';
import { planRig } from '../src/modules/mini-rig/plan';
import { layoutLinks, planChain } from '../src/modules/pixel-chain/plan';
import { getPixel } from '../src/pixels/library';
import { getPrinter } from '../src/printers';
import { applyGenerate, canGenerate, planGenerate } from '../src/sketch/generate';
import { distToPolygon, pointInPolygon } from '../src/sketch/geom';
import { planeXY, planeXZ, type Sketch, type SketchPath, type SketchRegion, type Vec2 } from '../src/sketch/types';
import type { Vec3 } from '../src/types';
import { getCore, PLANNED_SYSTEMS, SYSTEM_CORES } from '../src/workbench/cores';
import { SYSTEM_UIS } from '../src/workbench/uis';

/**
 * The M-series sketch adapters, driven the way the app drives them: a sketch goes through
 * `planGenerate` / `applyGenerate` into the registered system, with the raw (unresolved)
 * params the bench store holds. Each system's own test file covers its details.
 */

const DRAW_KEYS = new Set(['s', 'l', 'r', 'e', 'p', 'a', 'f', 'x', 'y', 'z']);

function generate<D>(systemId: string, sketch: Sketch): D {
  const core = getCore(systemId);
  expect(core.id).toBe(systemId);
  const plan = planGenerate(sketch, [], core);
  expect(plan.skipped).toBe(0);
  return applyGenerate(core, core.empty(), {}, plan) as D;
}

const pathSketch = (pts: Vec3[], plane = planeXY(0)): Sketch => ({ paths: [{ id: 'P1', pts, closed: false, plane, source: 'draw' } satisfies SketchPath], regions: [] });
const regionSketch = (r: SketchRegion): Sketch => ({ paths: [], regions: [r] });
const sq = (cx: number, cy: number, h: number): Vec2[] => [
  [cx - h, cy - h],
  [cx + h, cy - h],
  [cx + h, cy + h],
  [cx - h, cy + h],
];
const inOrOn = (p: Vec2, loop: Vec2[]) => pointInPolygon(p, loop) || distToPolygon(p, loop) < 1e-6;

describe('M-series registration', () => {
  it('registers M1–M7 with a UI each, and nothing left on the drawing board', () => {
    expect(SYSTEM_CORES.map((c) => c.code).sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
    expect(PLANNED_SYSTEMS).toHaveLength(0);
    for (const c of SYSTEM_CORES) expect(SYSTEM_UIS[c.id]).toBeDefined();
  });

  it('gives every system 2+ presets that round-trip through parse, and keeps tool keys off the draw keys', () => {
    for (const c of SYSTEM_CORES.filter((x) => x.id !== 'strut-node')) {
      expect(c.presets.length, c.id).toBeGreaterThanOrEqual(2);
      for (const p of c.presets) expect(c.parse(JSON.stringify(p.make())), `${c.id}/${p.id}`).toEqual(p.make());
      expect(c.parse('{nope')).toEqual(c.parse(JSON.stringify(c.empty())));
      const keys = SYSTEM_UIS[c.id].tools.map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(DRAW_KEYS.has(k), `${c.id} key ${k}`).toBe(false);
    }
  });

  it('offers the drawing engine the adapters each system takes', () => {
    const adapters = (id: string) => {
      const c = getCore(id);
      return [c.fromPaths && 'paths', c.fromRegions && 'regions', c.fromPaths3D && '3d'].filter(Boolean);
    };
    expect(adapters('linea')).toContain('paths');
    expect(adapters('pixel-chain')).toContain('paths');
    expect(adapters('mini-rig')).toContain('paths');
    expect(adapters('hive-wall')).toContain('regions');
    expect(adapters('facet-wall')).toContain('regions');
    expect(canGenerate(getCore('column-stack'))).toBe(false);
  });
});

describe('M-series sketch adapters', () => {
  it('M2 Linea: an L path gives one exact 90° corner and pitch-locked straights', () => {
    const d = generate<Parameters<typeof planLinea>[0]>('linea', pathSketch([[0, 0, 0], [300, 0, 0], [300, 200, 0]]));
    const plan = planLinea(d, lineaParams({}));
    const corners = plan.nodes.filter((n) => n.kind === 'corner');
    expect(corners).toHaveLength(1);
    expect(Math.abs(corners[0].angle! - 90)).toBeLessThan(1e-9);
    const pitch = plan.D.pitch;
    expect(pitch).toBeCloseTo(1000 / 60, 9);
    expect(plan.edges.length).toBeGreaterThan(0);
    for (const e of plan.edges) {
      expect(e.straights.length).toBeGreaterThan(0);
      for (const n of e.straights) expect(Number.isInteger(n) && n > 0).toBe(true);
      // The straights fill the span between the joint arms exactly, in whole pitches.
      const straight = e.length - e.armA - e.armB;
      expect(Math.abs(straight / pitch - Math.round(straight / pitch))).toBeLessThan(1e-6);
      expect(Math.abs(e.straights.reduce((s, n) => s + n * pitch, 0) - straight)).toBeLessThan(1e-6);
    }
  });

  it('M7 Pixel Chain: a drawn path gives links within the strand lead length', () => {
    const d = generate<Parameters<typeof layoutLinks>[0]>('pixel-chain', pathSketch([[-400, 0, 0], [-130, 150, 0], [130, -150, 0], [400, 0, 0]]));
    const lead = getPixel('node-12-bullet').leadLength!;
    const links = layoutLinks(d, {});
    const gp = planChain(d, {}).garlands[0];
    expect(links.length).toBeGreaterThan(8);
    expect(gp.pitch).toBeLessThanOrEqual(lead);
    for (let i = 1; i < links.length; i++) expect(dist(links[i - 1].pos, links[i].pos)).toBeLessThanOrEqual(lead);
    // One link per pitch along the chain.
    expect(Math.abs(gp.arc / gp.pitch - (links.length - 1))).toBeLessThan(0.05 * links.length);
    // It hangs: every link is below the anchors' height and above the floor.
    const top = Math.max(...d.garlands[0].anchors.map((a) => a[2]));
    expect(links.every((l) => l.pos[2] <= top + 1e-6 && l.pos[2] > 0)).toBe(true);
  });

  it('M1 Hive wall: a square with a hole leaves the hole empty and clips the edge tiles', () => {
    const hole = sq(0, 350, 110);
    const outer = sq(0, 350, 350);
    const d = generate<Parameters<typeof layoutWall>[0]>('hive-wall', regionSketch({ id: 'R1', outer, holes: [[...hole].reverse()], plane: planeXZ(0) }));
    const L = layoutWall(d, {});
    const plane = (c: Vec2) => fromLattice(d.lattice, c);
    expect(L.tiles.length).toBeGreaterThan(10);
    for (const t of L.tiles) {
      // No tile sits wholly in the hole, and no cell (pixel) lands in it.
      const corners = hexPts(L.dims.A - 1, t.slot.center).map(plane);
      expect(corners.every((c) => pointInPolygon(c, hole))).toBe(false);
      for (const c of t.cellsLat) {
        expect(pointInPolygon(plane(c), hole)).toBe(false);
        expect(pointInPolygon(plane(c), outer)).toBe(true);
      }
    }
    const partial = L.tiles.filter((t) => t.kind === 'partial');
    expect(partial.length).toBeGreaterThan(0);
    // Clipped along the outer edge and around the hole.
    expect(partial.some((t) => t.slot.clip!.holes.length > 0 || corners(t).some((c) => pointInPolygon(c, hole)))).toBe(true);
    expect(partial.some((t) => corners(t).some((c) => !pointInPolygon(c, outer)))).toBe(true);
    for (const t of partial) expect(t.slot.ratio).toBeLessThan(1);
    function corners(t: (typeof partial)[number]) {
      return hexPts(L.dims.A, t.slot.center).map(plane);
    }
  });

  it('M5 Facet Wall: a triangle outline gives facets inside it only', () => {
    const tri: Vec2[] = [
      [0, 0],
      [420, 35],
      [160, 330],
    ];
    const d = generate<Parameters<typeof layoutFacets>[0]>('facet-wall', regionSketch({ id: 'R1', outer: tri, holes: [], plane: planeXY(0) }));
    const L = layoutFacets(d, fwParams({}));
    expect(L.facets.length).toBeGreaterThan(5);
    for (const f of L.facets) {
      for (const c of f.corners) expect(inOrOn(c, tri)).toBe(true);
      expect(pointInPolygon(f.centroid, tri)).toBe(true);
    }
    expect(new Set(L.facets.map((f) => f.level)).size).toBeGreaterThan(1);
  });

  it('M3 Mini Rig: a drawn path gives truss runs with a corner', () => {
    const d = generate<Parameters<typeof planRig>[0]>('mini-rig', pathSketch([[0, 0, 500], [600, 0, 500], [600, 400, 500]], planeXY(500)));
    expect(d.spans).toHaveLength(2);
    for (const printer of ['bambu-256', 'bambu-a1mini']) {
      const p = planRig(d, rigParams({ printer }));
      const corner = p.nodes.find((n) => n.ways === 2)!;
      expect(corner.type).toBe('corner');
      expect(corner.label).toBe('2-way corner (90°)');
      expect(corner.bad).toBe(false);
      const bed = getPrinter(printer);
      for (const sp of p.spans) {
        expect(sp.ok).toBe(true);
        expect(sp.sections.length).toBeGreaterThan(0);
        for (const s of sp.sections) expect(s.len).toBeLessThanOrEqual(bed.z);
        expect(Math.abs(sp.sections.reduce((a, s) => a + s.len, 0) - (sp.length - TRUSS_W))).toBeLessThan(0.5);
      }
    }
  });
});
