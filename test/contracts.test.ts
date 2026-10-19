import { describe, expect, it } from 'vitest';
import { decodeImage, encodeImage, imageFrom, sampleImage } from '../src/fixtures/image';
import { FIXTURES, getFixture, PLANNED } from '../src/fixtures/registry';
import { cluster1D } from '../src/graph/dedupe';
import { cornerAngles, nestLoops, pointInRegion, polylineLength, resample, simplify } from '../src/sketch/geom';
import type { Vec2 } from '../src/sketch/types';
import { SYSTEM_CORES } from '../src/workbench/cores';

describe('registry', () => {
  it('concatenates series without duplicate ids or codes', () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const codes = [...FIXTURES.map((f) => f.code), ...PLANNED.map((p) => p.code)];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every workbench system names a module the worker can build', () => {
    for (const core of SYSTEM_CORES) {
      expect(getFixture(core.moduleId).params.some((p) => p.key === 'design' && p.type === 'json')).toBe(true);
      expect(core.presets.length).toBeGreaterThan(0);
      const d = core.presets[0].make();
      expect(core.parse(JSON.stringify(d))).toEqual(d);
    }
  });
});

describe('image params', () => {
  it('round-trips through base64 JSON and samples bilinearly', () => {
    const img = imageFrom(5, 3, (u) => u);
    const back = decodeImage(encodeImage(img))!;
    expect(back.w).toBe(5);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
    expect(sampleImage(back, 0, 0.5)).toBeCloseTo(0, 2);
    expect(sampleImage(back, 1, 0.5)).toBeCloseTo(1, 2);
    expect(sampleImage(back, 0.5, 0.5)).toBeCloseTo(0.5, 1);
  });

  it('treats empty or malformed input as "use the built-in"', () => {
    expect(decodeImage('')).toBeNull();
    expect(decodeImage('{nope')).toBeNull();
  });
});

describe('graph helpers', () => {
  it('clusters 1-D values within tolerance', () => {
    const g = cluster1D([10, 10.2, 10.25, 20, 20.25, 30], (v) => v, 0.3);
    expect(g.map((x) => x.length)).toEqual([3, 2, 1]);
  });
});

describe('sketch geometry', () => {
  it('measures, resamples and finds corners', () => {
    const L: [number, number, number][] = [
      [0, 0, 0],
      [100, 0, 0],
      [100, 50, 0],
    ];
    expect(polylineLength(L)).toBe(150);
    expect(resample(L, 25).length).toBe(7);
    const c = cornerAngles(L, false);
    expect(c).toHaveLength(1);
    expect(c[0].deg).toBeCloseTo(90);
  });

  it('simplifies near-straight freehand runs', () => {
    const pts: [number, number, number][] = Array.from({ length: 20 }, (_, i) => [i * 10, (i % 2) * 0.2, 0]);
    expect(simplify(pts, 0.5)).toHaveLength(2);
  });

  it('nests loops into regions with holes', () => {
    const sq = (s: number): Vec2[] => [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
    ];
    const regions = nestLoops([sq(10), sq(50), sq(100)]);
    // 100 outer with 50 as its hole; 10 is an island inside the hole.
    expect(regions).toHaveLength(2);
    const big = regions.find((r) => r.holes.length === 1)!;
    expect(pointInRegion([75, 0], big.outer, big.holes)).toBe(true);
    expect(pointInRegion([30, 0], big.outer, big.holes)).toBe(false);
  });
});

describe('fit settings', () => {
  it('fills printer, fit and seat from the host unless the fixture overrides them', async () => {
    const { hostFill, FIT_PARAMS, fitOf, seatOf, sideOf } = await import('../src/fit');
    const def = { params: [...FIT_PARAMS, { key: 'printer', label: 'p', type: 'select', default: 'bambu-256', hidden: true }] } as never;
    const host = { printerId: 'bambu-a1mini', fit: 0.4, seat: 0.15 };
    const filled = hostFill(def, {}, host);
    expect(filled).toMatchObject({ printer: 'bambu-a1mini', fit: 0.4, seat: 0.15 });
    const own = hostFill(def, { fit: 0.3 }, host);
    expect(fitOf(own)).toBe(0.3);
    expect(seatOf(own)).toBe(0.15);
    expect(sideOf(own)).toBeCloseTo(0.15);
    // Fixtures that don't declare the params are left alone.
    expect(hostFill({ params: [] } as never, {}, host)).toEqual({});
  });
});
