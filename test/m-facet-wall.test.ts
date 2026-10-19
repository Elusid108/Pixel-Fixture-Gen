import { describe, expect, it } from 'vitest';
import { encodeImage, imageFrom } from '../src/fixtures/image';
import { resolveParams } from '../src/fixtures/util';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { bedOf } from '../src/modules/shared/params';
import { facetWall } from '../src/modules/facet-wall/build';
import { layoutFacets, SQ3, tileToPlane, triangleInside, type FwLayout } from '../src/modules/facet-wall/layout';
import { emptyDesign, parseDesign, type FwDesign } from '../src/modules/facet-wall/model';
import { fwParams } from '../src/modules/facet-wall/params';
import { facetWallCore, tileSelId, vertexId } from '../src/modules/facet-wall/system';
import { distToPolygon, pointInPolygon } from '../src/sketch/geom';
import { planeXY, type SketchRegion, type Vec2 } from '../src/sketch/types';
import type { Params } from '../src/types';

const P = (p: Params = {}) => fwParams(p);
const preset = (id: string) => facetWallCore.presets.find((p) => p.id === id)!.make();
const region = (outer: Vec2[], holes: Vec2[][] = []): SketchRegion => ({ id: 'r1', outer, holes, plane: planeXY(0) });
const inOrOn = (p: Vec2, loop: Vec2[]) => pointInPolygon(p, loop) || distToPolygon(p, loop) < 1e-6;
const strictlyIn = (p: Vec2, loop: Vec2[]) => pointInPolygon(p, loop) && distToPolygon(p, loop) > 1e-6;

describe('M5 Facet Wall: adapter', () => {
  it('M5 Facet Wall: triangle outline gives facets inside only', () => {
    const tri: Vec2[] = [
      [0, 0],
      [420, 35],
      [160, 330],
    ];
    const d = facetWallCore.fromRegions!([region(tri)], emptyDesign(), P());
    expect(d.areas).toHaveLength(1);
    const L = layoutFacets(d, P());
    expect(L.facets.length).toBeGreaterThan(0);
    for (const f of L.facets) {
      for (const c of f.corners) expect(inOrOn(c, tri)).toBe(true);
      expect(pointInPolygon(f.centroid, tri)).toBe(true);
    }
    // Nothing outside: the area covered is never more than the outline's.
    const area = (L.facets.length * L.side * L.side * SQ3) / 4;
    expect(area).toBeLessThan(0.5 * Math.abs(420 * 330 - 35 * 160));
    // Every live facet is in the data chain, on a tile, exactly once.
    expect(L.chain).toHaveLength(L.facets.length);
    expect(new Set(L.chain.map((f) => f.key)).size).toBe(L.chain.length);
  });

  it('fills a lattice-aligned triangle exactly (corners on the outline count as inside)', () => {
    const L = layoutFacets(preset('mountain'), P());
    expect(L.facets).toHaveLength(64);
  });

  it('keeps facets clear of holes and merges into an existing wall', () => {
    const sq = (x0: number, y0: number, w: number): Vec2[] => [
      [x0, y0],
      [x0 + w, y0],
      [x0 + w, y0 + w],
      [x0, y0 + w],
    ];
    const hole = sq(130, 130, 140);
    let d = facetWallCore.fromRegions!([region(sq(0, 0, 400), [[...hole].reverse()])], emptyDesign(), P());
    const L = layoutFacets(d, P());
    expect(L.facets.length).toBeGreaterThan(0);
    for (const f of L.facets) {
      for (const c of f.corners) expect(strictlyIn(c, hole)).toBe(false);
      expect(pointInPolygon(f.centroid, hole)).toBe(false);
    }
    // A second region appends an area instead of replacing the first.
    d = facetWallCore.fromRegions!([region(sq(600, 0, 200))], d, P());
    expect(d.areas.map((a) => a.id)).toEqual(['W01', 'W02']);
    expect(layoutFacets(d, P()).facets.length).toBeGreaterThan(L.facets.length);
  });

  it('rejects a triangle an outline edge cuts through, even with its corners inside', () => {
    // A notch whose tip pokes into the triangle (0,0)-(60,0)-(30,52).
    const notched: Vec2[] = [
      [-10, -10],
      [80, -10],
      [80, 80],
      [32, 80],
      [30, 20],
      [28, 80],
      [-10, 80],
    ];
    const tri: Vec2[] = [
      [0, 0],
      [60, 0],
      [30, 51.96],
    ];
    expect(triangleInside(tri, notched)).toBe(false);
    expect(triangleInside(tri, [[-10, -10], [80, -10], [80, 80], [-10, 80]])).toBe(true);
  });
});

describe('M5 Facet Wall: depth', () => {
  it('a gradient gives all three depth levels', () => {
    const L = layoutFacets(preset('diagonal'), P());
    expect(L.counts.every((n) => n > 0)).toBe(true);
    expect(new Set(L.chain.map((f) => f.level))).toEqual(new Set([0, 1, 2]));
    // Depth rises along the gradient direction.
    const th = (30 * Math.PI) / 180;
    const along = (f: { centroid: Vec2 }) => f.centroid[0] * Math.cos(th) + f.centroid[1] * Math.sin(th);
    const lo = L.chain.reduce((a, f) => (along(f) < along(a) ? f : a));
    const hi = L.chain.reduce((a, f) => (along(f) > along(a) ? f : a));
    expect(lo.level).toBe(0);
    expect(hi.level).toBe(2);
  });

  it('invert swaps shallow and deep; overrides win; knocked-out facets leave the chain', () => {
    const d = preset('diagonal');
    const L = layoutFacets(d, P());
    const inv = layoutFacets({ ...d, driver: { ...d.driver, invert: true } }, P());
    expect(inv.counts[0]).toBe(L.counts[2]);
    const key = L.chain[0].key;
    const want = ((L.chain[0].level + 1) % 3) as 0 | 1 | 2;
    const o = layoutFacets({ ...d, overrides: { [key]: want }, omit: [L.chain[1].key] }, P());
    expect(o.byKey.get(key)!.level).toBe(want);
    expect(o.byKey.get(key)!.overridden).toBe(true);
    expect(o.chain.some((f) => f.key === L.chain[1].key)).toBe(false);
    expect(o.chain).toHaveLength(L.chain.length - 1);
  });

  it('the image driver reads brightness as depth', () => {
    const d: FwDesign = { ...preset('ripple'), driver: { kind: 'image', angle: 0, start: 0, end: 1, invert: false } };
    const white = encodeImage(imageFrom(4, 4, () => 1));
    expect(layoutFacets(d, P({ image: white })).counts).toEqual([0, 0, 96]);
    const builtIn = layoutFacets(d, P());
    expect(builtIn.counts.filter((n) => n > 0).length).toBe(3);
  });
});

describe('M5 Facet Wall: tiles and data', () => {
  const check = (L: FwLayout, printer: string) => {
    const bed = bedOf(P({ printer }));
    for (const cls of L.classes) {
      // Every member's facets are the class geometry moved onto the wall.
      for (const id of cls.members) {
        const t = L.tiles.find((x) => x.id === id)!;
        const got = t.facets.map((k) => L.byKey.get(k)!.centroid);
        const placed = cls.centroids.map((c) => tileToPlane(t, c));
        for (const p of placed) expect(got.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)).toBe(true);
        expect(placed).toHaveLength(got.length);
      }
      // Each part fits the bed at its print turn.
      const r = (cls.printRot * Math.PI) / 180;
      const pts = cls.tris.flat().map(([x, y]) => [x * Math.cos(r) + y * Math.sin(r), x * Math.sin(r) - y * Math.cos(r)]);
      const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
      const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
      expect(w).toBeLessThanOrEqual(bed.x + 1e-6);
      expect(h).toBeLessThanOrEqual(bed.y + 1e-6);
    }
    // Data order: each tile's facets are one contiguous run of the chain.
    let i = 0;
    for (const t of L.tiles) for (const k of t.facets) expect(L.chain[i++].key).toBe(k);
  };

  for (const id of ['mountain', 'diagonal', 'ripple'])
    for (const printer of ['bambu-256', 'bambu-a1mini'])
      it(`${id} on ${printer}: classes map onto their tiles, fit the bed, data runs tile by tile`, () => check(layoutFacets(preset(id), P({ printer })), printer));

  it('dedupes identical patches: the mountain is four copies of one backer', () => {
    const L = layoutFacets(preset('mountain'), P());
    expect(L.k).toBe(4);
    expect(L.classes).toHaveLength(1);
    expect(L.classes[0].members).toHaveLength(4);
    expect(L.classes[0].full).toBe(true);
    // The A1 mini forces smaller tiles.
    expect(layoutFacets(preset('mountain'), P({ printer: 'bambu-a1mini' })).k).toBe(2);
  });

  it('keeps the strand inside the node lead on the presets', () => {
    for (const p of facetWallCore.presets) {
      const L = layoutFacets(p.make(), P());
      expect(L.longGaps).toEqual([]);
      expect(L.spacing).toBeCloseTo(60 / SQ3, 6);
    }
  });
});

describe('M5 Facet Wall: design', () => {
  it('parses presets round-trip and survives malformed input', () => {
    for (const p of facetWallCore.presets) {
      const d = p.make();
      expect(facetWallCore.parse(JSON.stringify(d))).toEqual(d);
    }
    expect(parseDesign('{nope')).toEqual(emptyDesign());
    const odd = parseDesign(JSON.stringify({ areas: [{ outer: [[0, 0], [1]] }, { id: 'X', outer: [[0, 0], [9, 0], [0, 9]] }], overrides: { a: 7, b: 1 }, driver: { start: 5 } }));
    expect(odd.areas.map((a) => a.id)).toEqual(['X']);
    expect(odd.overrides).toEqual({ b: 1 });
    expect(odd.driver.start).toBe(1);
  });

  it('removes vertices, areas, facets and tiles', () => {
    const d = preset('diagonal');
    expect(facetWallCore.remove!(d, { kind: 'vertex', id: vertexId('W01', 0, 0) }).areas[0].outer).toHaveLength(3);
    const tri = preset('mountain');
    expect(facetWallCore.remove!(tri, { kind: 'vertex', id: vertexId('W01', 0, 0) }).areas).toHaveLength(0);
    expect(facetWallCore.remove!(d, { kind: 'area', id: 'W01' }).areas).toHaveLength(0);
    expect(facetWallCore.remove!(d, { kind: 'facet', id: '0,0,u' }).omit).toEqual(['0,0,u']);
    const L = layoutFacets(tri, P());
    const t = L.tiles[0];
    const gone = facetWallCore.remove!(tri, { kind: 'tile', id: tileSelId(t.id, t.facets) });
    expect(layoutFacets(gone, P()).chain).toHaveLength(64 - t.facets.length);
  });
});

describe('M5 Facet Wall: build', () => {
  it('builds the first preset: manifold parts, deduped, one pixel per facet', async () => {
    const wasm = await loadManifold();
    const d = facetWallCore.presets[0].make();
    const out = inArena(wasm, () => {
      const o = facetWall.build(makeCtx(wasm), resolveParams(facetWall, { design: JSON.stringify(d) }));
      return {
        px: o.pixels.length,
        units: o.schedule.map((s) => s.unit),
        parts: o.parts.map((p) => ({ id: p.id, ok: p.solid.status() === 'NoError', vol: p.solid.volume(), n: p.instances.length })),
      };
    });
    expect(out.px).toBe(64);
    expect(out.units).toEqual(['T01', 'T02', 'T03', 'T04']);
    for (const p of out.parts) {
      expect(p.ok).toBe(true);
      expect(p.vol).toBeGreaterThan(1);
    }
    expect(out.parts.find((p) => p.id === 'backer-A')!.n).toBe(4);
    expect(out.parts.filter((p) => p.id.startsWith('facet')).reduce((a, p) => a + p.n, 0)).toBe(64);
  }, 60000);
});
