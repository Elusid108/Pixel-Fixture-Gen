import { describe, expect, it } from 'vitest';
import { strutNodeCore } from '../src/modules/strut-node/system';
import { arcPath, circleRegion, finishPolyline, freehand, polygonRegion, rectRegion } from '../src/sketch/draw';
import { applyGenerate, planGenerate } from '../src/sketch/generate';
import { polygonArea, polylineLength } from '../src/sketch/geom';
import { placeArtwork, textArtwork } from '../src/sketch/import';
import { entityPoints, idMaker, linearArray, mapEntity, mirrorMap, polarArray, type Entity } from '../src/sketch/ops';
import { planeXY, planeXZ, type Sketch } from '../src/sketch/types';
import type { Vec3 } from '../src/types';

const id = () => ({ path: idMaker('P', []), region: idMaker('R', []) });
const XY = planeXY(0);

describe('drawing tools', () => {
  it('closes a planar polyline into a region and keeps open ones as paths', () => {
    const sq: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
    ];
    const closed = finishPolyline(sq, XY, true, id());
    expect(closed.regions).toHaveLength(1);
    expect(polygonArea(closed.regions[0].outer)).toBeCloseTo(10000);
    const open = finishPolyline(sq, XY, false, id());
    expect(open.paths[0].plane).toBeDefined();
    expect(polylineLength(open.paths[0].pts)).toBe(300);
  });

  it('turns a polyline that changes plane into a 3D path', () => {
    const zig: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
      [100, 0, 80],
      [200, 0, 80],
    ];
    const out = finishPolyline(zig, XY, false, id());
    expect(out.paths[0].plane).toBeUndefined();
    expect(out.paths[0].source).toBe('3d');
  });

  it('makes rectangles, circles, polygons and arcs on any plane', () => {
    const front = planeXZ(50);
    const r = rectRegion([0, 50, 0], [200, 50, 100], front, idMaker('R', [])).regions[0];
    expect(Math.abs(polygonArea(r.outer))).toBeCloseTo(20000);
    const c = circleRegion([0, 0, 0], [50, 0, 0], XY, idMaker('R', [])).regions[0];
    expect(Math.abs(polygonArea(c.outer))).toBeGreaterThan(Math.PI * 2500 * 0.98);
    const hex = polygonRegion([0, 0, 0], [60, 0, 0], 6, XY, idMaker('R', [])).regions[0];
    expect(hex.outer).toHaveLength(6);
    const arc = arcPath([-50, 0, 0], [50, 0, 0], [0, 50, 0], XY, idMaker('P', [])).paths[0];
    expect(polylineLength(arc.pts)).toBeCloseTo(Math.PI * 50, 0);
  });

  it('simplifies freehand and closes strokes that end where they began', () => {
    const line: Vec3[] = Array.from({ length: 50 }, (_, i) => [i * 4, Math.sin(i) * 0.2, 0]);
    expect(freehand(line, XY, id()).paths[0].pts.length).toBe(2);
    const loop: Vec3[] = Array.from({ length: 60 }, (_, i) => [80 * Math.cos((i / 59) * 2 * Math.PI), 80 * Math.sin((i / 59) * 2 * Math.PI), 0]);
    expect(freehand(loop, XY, id()).regions).toHaveLength(1);
  });
});

describe('arrange', () => {
  const path: Entity = { kind: 'path', e: { id: 'P1', pts: [[10, 0, 0], [50, 0, 0]], closed: false, plane: XY } };
  it('mirrors and arrays', () => {
    const m = mapEntity(path, mirrorMap([0, 0, 0], [1, 0, 0]), 'P2');
    expect(entityPoints(m)[1]).toEqual([-50, 0, 0]);
    const lin = linearArray(path, 3, [0, 100, 0], idMaker('P', ['P1']));
    expect(lin.map((e) => entityPoints(e)[0][1])).toEqual([100, 200]);
    const pol = polarArray(path, 4, [0, 0, 0], [0, 0, 1], 360, idMaker('P', ['P1']));
    expect(pol).toHaveLength(3);
    expect(entityPoints(pol[1])[1][0]).toBeCloseTo(-50);
  });

  it('keeps mirrored regions valid (positive area in their plane)', () => {
    const r = rectRegion([0, 0, 0], [100, 50, 0], XY, idMaker('R', [])).regions[0];
    const m = mapEntity({ kind: 'region', e: r }, mirrorMap([0, 0, 0], [1, 0, 0]), 'R2');
    expect(m.kind === 'region' && polygonArea(m.e.outer) > 0).toBe(true);
    expect(entityPoints(m).every((p) => p[0] <= 1e-9)).toBe(true);
  });
});

describe('text and artwork', () => {
  it('places single-line text as paths scaled to width', () => {
    const out = placeArtwork(textArtwork('HI', 60), { plane: XY, width: 100, source: 'text' }, id());
    expect(out.paths.length).toBeGreaterThanOrEqual(4);
    const xs = out.paths.flatMap((p) => p.pts.map((q) => q[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 3);
  });

  it('nests filled loops into regions with holes, flipping SVG y', () => {
    const outer: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const hole: [number, number][] = [
      [25, 25],
      [75, 25],
      [75, 75],
      [25, 75],
    ];
    const out = placeArtwork({ fills: [outer, hole], strokes: [] }, { plane: XY, width: 200, flipY: true, source: 'svg' }, id());
    expect(out.regions).toHaveLength(1);
    expect(out.regions[0].holes).toHaveLength(1);
    expect(Math.abs(polygonArea(out.regions[0].outer))).toBeCloseTo(40000);
  });
});

describe('generate', () => {
  it('turns a 3D zig-zag into Strut & Node hubs and struts, merging shared vertices', () => {
    const sketch: Sketch = {
      paths: [
        { id: 'P1', pts: [[0, 0, 60], [200, 0, 60], [200, 0, 260]], closed: false, source: '3d' },
        { id: 'P2', pts: [[200, 0, 260], [0, 0, 260]], closed: false, plane: XY, source: 'draw' },
      ],
      regions: [],
    };
    const plan = planGenerate(sketch, [], strutNodeCore);
    expect(plan.paths3d).toHaveLength(2); // P2 isn't on its plane (z=260 vs XY at 0), so it's treated as 3D
    const d = applyGenerate(strutNodeCore, strutNodeCore.empty(), {}, plan);
    expect(d.nodes).toHaveLength(4);
    expect(d.struts).toHaveLength(3);
    expect(d.controller).toBe(d.nodes[0].id);
  });

  it('routes regions to their outline for systems without fromRegions', () => {
    const r = rectRegion([0, 0, 0], [100, 100, 0], XY, idMaker('R', [])).regions[0];
    const noRegions = { ...strutNodeCore, fromRegions: undefined };
    const plan = planGenerate({ paths: [], regions: [r] }, [], noRegions);
    expect(plan.paths).toHaveLength(1);
    expect(plan.paths[0].closed).toBe(true);
    const d = applyGenerate(noRegions, strutNodeCore.empty(), {}, plan);
    expect(d.struts).toHaveLength(4);
  });
});
