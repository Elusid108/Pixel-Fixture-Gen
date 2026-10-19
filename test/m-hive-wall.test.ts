import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { resolveParams } from '../src/fixtures/util';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { fromPlane, pointInPolygon, polygonArea, toPlane } from '../src/sketch/geom';
import { planeXY, planeXZ, type SketchRegion, type Vec2 } from '../src/sketch/types';
import { hiveWall } from '../src/modules/hive-wall/build';
import { clipConvex, fromLattice, hexPts, hwDims, layoutWall, tileFits } from '../src/modules/hive-wall/layout';
import { emptyDesign, parseDesign, type HwDesign } from '../src/modules/hive-wall/model';
import { fromRegions, hiveWallCore, toggleSlot } from '../src/modules/hive-wall/system';

const sq = (cx: number, cy: number, h: number): Vec2[] => [
  [cx - h, cy - h],
  [cx + h, cy - h],
  [cx + h, cy + h],
  [cx - h, cy + h],
];

/** A 700 mm square wall on the front plane with a 220 mm square window in the middle. */
const squareWithHole = (): SketchRegion => ({ id: 'r1', outer: sq(0, 350, 350), holes: [[...sq(0, 350, 110)].reverse()], plane: planeXZ(0) });

describe('M1 Hive wall adapter', () => {
  it('M1 Hive wall: square with a hole leaves the hole empty and clips edge tiles', () => {
    const region = squareWithHole();
    const d = fromRegions([region], emptyDesign());
    expect(d.plane).toEqual(region.plane);
    expect(d.areas).toHaveLength(1);
    expect(d.areas[0].holes).toHaveLength(1);

    const L = layoutWall(d, {});
    const hole = region.holes[0];
    const outer = region.outer;
    const inHole = (p: Vec2) => pointInPolygon(p, hole);
    const plane = (c: Vec2) => fromLattice(d.lattice, c);

    expect(L.tiles.length).toBeGreaterThan(10);
    // No pixel (cell) lands in the window, and every one is inside the wall.
    for (const t of L.tiles) {
      expect(t.cells.length).toBeGreaterThan(0);
      for (const c of t.cellsLat) {
        expect(inHole(plane(c))).toBe(false);
        expect(pointInPolygon(plane(c), outer)).toBe(true);
      }
    }
    // No tile sits inside the window: every placed tile keeps some area outside it.
    for (const t of L.tiles) {
      const corners = hexPts(L.dims.A - 1, t.slot.center).map(plane);
      expect(corners.every(inHole) && inHole(plane(t.slot.center))).toBe(false);
    }
    // Edge tiles are trimmed: partial tiles exist on the outer edge and around the window, and
    // their clip polygons stay within the square.
    expect(L.partial).toBeGreaterThan(0);
    const partial = L.tiles.filter((t) => t.kind === 'partial');
    expect(partial.some((t) => t.slot.clip!.holes.length > 0)).toBe(true);
    for (const t of partial) {
      for (const o of t.slot.clip!.outers) {
        for (const p of o) {
          const q = plane([p[0] + t.slot.center[0], p[1] + t.slot.center[1]]);
          expect(Math.abs(q[0])).toBeLessThanOrEqual(350.01);
          expect(q[1]).toBeGreaterThanOrEqual(-0.01);
          expect(q[1]).toBeLessThanOrEqual(700.01);
        }
      }
      expect(t.slot.ratio).toBeLessThan(1);
    }
    // Whole tiles are entirely inside the square and outside the window.
    for (const t of L.tiles.filter((x) => x.kind === 'full')) {
      for (const c of hexPts(L.dims.A, t.slot.center).map(plane)) {
        expect(pointInPolygon(c, outer) || Math.abs(c[0]) <= 350.01).toBe(true);
        expect(inHole(c)).toBe(false);
      }
    }
  });

  it('appends coplanar regions and moves to a new plane otherwise', () => {
    const d1 = fromRegions([squareWithHole()], emptyDesign());
    // A second shape on the same wall (plane shifted along itself) becomes a second area.
    const shifted = { origin: [1000, 0, 0] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 0, 1] as [number, number, number] };
    const d2 = fromRegions([{ id: 'r2', outer: sq(0, 100, 100), holes: [], plane: shifted }], d1);
    expect(d2.areas.map((a) => a.id)).toEqual(['A01', 'A02']);
    expect(d2.lattice).toEqual(d1.lattice);
    expect(d2.areas[1].outer[0]).toEqual([900, 0]);
    expect(polygonArea(d2.areas[1].outer)).toBeGreaterThan(0);
    // A shape on the floor replaces the wall.
    const d3 = fromRegions([{ id: 'r3', outer: sq(0, 0, 200), holes: [], plane: planeXY(0) }], d2);
    expect(d3.plane).toEqual(planeXY(0));
    expect(d3.areas).toHaveLength(1);
    expect(d3.lattice.offset).toEqual([0, 0]);
    // Points survive the round trip into the wall's plane.
    const p = fromPlane([10, 20], shifted);
    expect(toPlane(p, d1.plane)).toEqual([1010, 20]);
  });
});

describe('M1 Hive wall layout', () => {
  it('clips polygons against a convex hex', () => {
    const hex = hexPts(50);
    const half = clipConvex(sq(-100, 0, 100), hex); // left half-plane x ≤ 0
    expect(Math.abs(polygonArea(half))).toBeCloseTo(Math.abs(polygonArea(hex)) / 2, 6);
    expect(clipConvex(sq(500, 500, 10), hex)).toHaveLength(0);
  });

  it('lays the honeycomb preset out as 19 whole tiles on one unbroken strand', () => {
    const d = hiveWallCore.presets.find((p) => p.id === 'honeycomb')!.make();
    const L = layoutWall(d, {});
    expect(L.full).toBe(19);
    expect(L.partial).toBe(0);
    expect(L.px).toBe(19 * 19);
    expect(L.seams).toHaveLength(42);
    expect(L.tiles.every((t) => t.linked)).toBe(true);
    expect(L.tiles.map((t) => t.unit).slice(0, 3)).toEqual(['T01', 'T02', 'T03']);
  });

  it('orders data serpentine with short hops and no extension leads on the presets', () => {
    for (const p of hiveWallCore.presets) {
      const L = layoutWall(p.make(), {});
      expect(L.tiles.length).toBeGreaterThanOrEqual(10);
      expect(L.tiles.length).toBeLessThanOrEqual(20);
      for (const t of L.tiles.slice(1)) {
        expect(t.linked).toBe(true);
        expect(t.jumpIn).toBeLessThan(1.1 * L.dims.D);
      }
    }
  });

  it('steps the tile down to fit small printers', () => {
    const big = hwDims({ size: 'L' });
    expect(big.size).toBe('L');
    expect(big.fallback).toBeNull();
    const mini = hwDims({ size: 'L', printer: 'bambu-a1mini' });
    expect(mini.size).toBe('M');
    expect(mini.fallback).toMatch(/L tiles/);
    expect(tileFits(mini, mini.bed)).toBe(true);
    const coarse = hwDims({ size: 'S', pitch: 60, printer: 'bambu-a1mini' });
    expect(coarse.pitch).toBeLessThan(60);
    expect(tileFits(coarse, coarse.bed)).toBe(true);
  });

  it('switches slots off and on by hand', () => {
    const d = hiveWallCore.presets[0].make();
    const L = layoutWall(d, {});
    const t = L.tiles[3];
    const off = toggleSlot(d, t.slot.key, t.slot.natural);
    const L2 = layoutWall(off, {});
    expect(L2.tiles).toHaveLength(L.tiles.length - 1);
    expect(L2.bySlot.get(t.slot.key)!.state).toBe('off');
    expect(toggleSlot(off, t.slot.key, true)).toEqual(d);
    const empty = L.slots.find((s) => s.state === 'out')!;
    const on = layoutWall(toggleSlot(d, empty.key, false), {});
    expect(on.bySlot.get(empty.key)!.state).toBe('whole');
    expect(on.tiles).toHaveLength(L.tiles.length + 1);
    // Delete on a tile switches it off.
    expect(hiveWallCore.remove!(d, { kind: 'tile', id: t.slot.key }).off).toEqual([t.slot.key]);
  });

  it('round-trips designs and survives malformed input', () => {
    for (const p of hiveWallCore.presets) {
      const d = p.make();
      expect(parseDesign(JSON.stringify(d))).toEqual(d);
    }
    expect(parseDesign('{nope')).toEqual(emptyDesign());
    const junk = parseDesign(JSON.stringify({ areas: [{ outer: [[0, 0], [1]] }, { outer: [[0, 0], [10, 0], [0, 10]], holes: 'x' }], off: [3, '1,2'], start: 'zz', plane: 5 }));
    expect(junk.areas).toHaveLength(1);
    expect(junk.areas[0].holes).toEqual([]);
    expect(junk.off).toEqual(['1,2']);
    expect(junk.start).toBe('bl');
    expect(junk.plane).toEqual(planeXY(0));
  });
});

describe('M1 Hive wall build', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    wasm = await loadManifold();
  });

  const build = (d: HwDesign, extra = {}) =>
    inArena(wasm, () => {
      const o = hiveWall.build(makeCtx(wasm), resolveParams(hiveWall, { design: JSON.stringify(d), ...extra }));
      return {
        px: o.pixels.length,
        units: o.schedule.map((s) => s.unit),
        sched: o.schedule.reduce((n, s) => n + s.px, 0),
        parts: o.parts.map((p) => ({ id: p.id, ok: p.solid.status() === 'NoError', vol: p.solid.volume(), n: p.instances.length })),
      };
    });

  it('builds preset 0 with every part manifold and pixels in schedule order', () => {
    const d = hiveWallCore.presets[0].make();
    const L = layoutWall(d, {});
    const out = build(d);
    expect(out.px).toBe(L.px);
    expect(out.sched).toBe(L.px);
    expect(out.units).toEqual(L.tiles.map((t) => t.unit));
    for (const p of out.parts) {
      expect(p.ok).toBe(true);
      expect(p.vol).toBeGreaterThan(0.01);
    }
    // Whole tiles print as one set ×N.
    expect(out.parts.find((p) => p.id === 'shell')!.n).toBe(L.full);
  }, 30000);

  it("a trimmed tile's parts are manifold, smaller than a whole tile's, and shared by identical trims", () => {
    const d = fromRegions([squareWithHole()], emptyDesign());
    const L = layoutWall(d, {});
    const out = build(d);
    const partial = out.parts.filter((p) => /^p\d+-/.test(p.id));
    expect(partial.length).toBe(4 * L.pieces.length);
    for (const p of partial) {
      expect(p.ok).toBe(true);
      expect(p.vol).toBeGreaterThan(0.01);
    }
    const whole = out.parts.find((p) => p.id === 'diffuser')!.vol;
    for (const p of partial.filter((x) => x.id.endsWith('-diffuser'))) expect(p.vol).toBeLessThan(whole);
    // The square's straight edges repeat the same trim, so pieces are fewer than trimmed tiles.
    expect(L.pieces.length).toBeLessThan(L.partial);
    expect(partial.reduce((n, p) => n + (p.id.endsWith('-shell') ? p.n : 0), 0)).toBe(L.partial);
  }, 30000);
});
