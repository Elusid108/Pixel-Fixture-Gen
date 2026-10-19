import type { ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { runBuild, type BuildResult } from '../src/build/runBuild';
import { encodeImage, imageFrom } from '../src/fixtures/image';
import { getFixture } from '../src/fixtures/registry';
import { isoLoops } from '../src/fixtures/s/common';
import { stripHelix } from '../src/fixtures/s/moire';
import { sceneLayers } from '../src/fixtures/s/scrim';
import { S_FIXTURES, S_PLANNED } from '../src/fixtures/series-s';
import { Geo } from '../src/geom/geo';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { boundsFit, getPrinter } from '../src/printers';
import type { Params } from '../src/types';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

const build = (id: string, p: Params = {}): BuildResult => {
  const r = runBuild(wasm, id, p);
  expect(r.errors).toEqual([]);
  return r;
};
const units = (r: BuildResult) => r.pixels.map((p) => p.unit);
const part = (r: BuildResult, id: string) => r.parts.find((p) => p.id === id)!;
const size = (r: BuildResult, id: string, axis: 0 | 1 | 2) => {
  const b = part(r, id).bounds;
  return b.max[axis] - b.min[axis];
};

describe('S-series registry', () => {
  it('builds all eight and plans none', () => {
    expect(S_FIXTURES.map((f) => f.code)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(S_PLANNED).toEqual([]);
  });

  it('fits every default part on a 256 bed, and S3, S4, S8 entirely on 180', () => {
    const big = getPrinter('bambu-256');
    const small = getPrinter('bambu-a1mini');
    for (const f of S_FIXTURES.slice(2)) {
      const r = build(f.id);
      for (const p of r.parts) expect(boundsFit(p.bounds, big), `${f.code} ${p.name}`).toBe(true);
      if (['S3', 'S4', 'S8'].includes(f.code)) for (const p of r.parts) expect(boundsFit(p.bounds, small), `${f.code} ${p.name}`).toBe(true);
    }
  });
});

describe('contours', () => {
  it('closes a loop around a bump, including along the border', () => {
    const fd = { nx: 5, ny: 5, v: Float32Array.from({ length: 25 }, (_, i) => (i === 12 ? 1 : 0)) };
    expect(isoLoops(fd, 0.5, 0, 0, 4, 4)).toHaveLength(1);
    const full = { nx: 3, ny: 3, v: new Float32Array(9).fill(1) };
    const [edge] = isoLoops(full, 0.5, 0, 0, 2, 2);
    expect(Math.max(...edge.map((p) => p[0]))).toBeCloseTo(2, 1);
  });
});

describe('S3 Leko Jr.', () => {
  it('patches the 7-px gobo jewel, then the 8-px lamp-cap ring', () => {
    const r = build('leko-jr');
    expect(units(r)).toEqual([...Array(7).fill('S3-1'), ...Array(8).fill('S3-2')]);
    expect(r.report.totals.px).toBe(15);
    expect(r.report.totals.channels).toBe(45);
  });

  it('has four shutters and a gobo library, and says it does not project', () => {
    const r = build('leko-jr');
    expect(part(r, 'shutter').instances).toHaveLength(4);
    expect(r.parts.filter((p) => p.id.startsWith('gobo-')).map((p) => p.id)).toEqual(['gobo-breakup', 'gobo-window', 'gobo-stars']);
    expect(getFixture('leko-jr').description).toMatch(/does not project/);
    // A picture adds the custom plate to the library.
    const art = encodeImage(imageFrom(32, 32, (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.3 ? 1 : 0)));
    const c = build('leko-jr', { image: art });
    expect(c.parts.some((p) => p.id === 'gobo-custom')).toBe(true);
  });

  it('cuts the gobo patterns through the plate', () => {
    const r = build('leko-jr', { library: true });
    // A blank plate (outline less the finger hole) is about 2918 mm³; each pattern opens at least 60 mm² more.
    const blank = (34 * 73 - Math.PI * 16) * 1.2;
    for (const id of ['gobo-breakup', 'gobo-window', 'gobo-stars']) expect(part(r, id).volumeCm3 * 1000).toBeLessThan(blank - 60 * 1.2);
  });
});

describe('S4 Scrim Box', () => {
  it('runs FOH first, then the three electrics snaking near to far', () => {
    const r = build('scrim-box');
    expect(units(r)).toEqual([...Array(8).fill('S4-F'), ...Array(4).fill('S4-B1'), ...Array(4).fill('S4-B2'), ...Array(4).fill('S4-B3')]);
    const foh = r.pixels.filter((p) => p.unit === 'S4-F');
    expect(foh[0].normal[1]).toBeGreaterThan(0.5); // aimed back at the gauze
    const b1 = r.pixels.filter((p) => p.unit === 'S4-B1');
    const b2 = r.pixels.filter((p) => p.unit === 'S4-B2');
    expect(b1[0].pos[0]).toBeLessThan(b1[3].pos[0]);
    expect(b2[0].pos[0]).toBeGreaterThan(b2[3].pos[0]);
    expect(b2[0].pos[1]).toBeGreaterThan(b1[0].pos[1]);
  });

  it('prints every scene layer as one connected piece', () => {
    inArena(wasm, () => {
      const g = new Geo(makeCtx(wasm));
      for (const s of ['forest', 'skyline', 'sea'] as const) {
        for (const [w, h] of [
          [152.6, 106.2],
          [112.6, 81.2],
        ]) {
          for (const cs of sceneLayers(g, s, w, h)) expect(cs.decompose().length).toBe(1);
        }
      }
    });
  });
});

describe('S5 Litho Relight', () => {
  it('lays a 6×6 serpentine at 33.3 mm, or 8×8 nodes', () => {
    const r = build('litho-relight');
    expect(r.pixels).toHaveLength(36);
    const [a, b] = [r.pixels[0].pos, r.pixels[1].pos];
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeCloseTo(1000 / 30, 1);
    // Row 2 starts above where row 1 ended.
    expect(r.pixels[6].pos[0]).toBeCloseTo(r.pixels[5].pos[0], 3);
    expect(r.pixels[6].pos[2]).toBeGreaterThan(r.pixels[5].pos[2]);
    expect(build('litho-relight', { grid: 'nodes' }).pixels).toHaveLength(64);
  });

  it('maps luminance to thickness: dark is thick, bright is thin', () => {
    const white = encodeImage(imageFrom(8, 8, () => 1));
    const black = encodeImage(imageFrom(8, 8, () => 0));
    const w = build('litho-relight', { image: white, detail: 1.5 });
    const k = build('litho-relight', { image: black, detail: 1.5 });
    expect(size(k, 'lithophane', 2)).toBeCloseTo(3.2, 2);
    const area = 200 * 200;
    expect(part(w, 'lithophane').volumeCm3 * 1000).toBeLessThan(area * 1.0);
    expect(part(k, 'lithophane').volumeCm3 * 1000).toBeGreaterThan(area * 3.1);
  });
});

describe('S6 Louver Sconce', () => {
  it('patches down wash, ten cells bottom to top, then up wash', () => {
    const r = build('louver-sconce');
    expect(units(r)).toEqual([...Array(3).fill('S6-D'), ...Array(10).fill('S6-C'), ...Array(3).fill('S6-U')]);
    const cells = r.pixels.filter((p) => p.unit === 'S6-C');
    for (let i = 1; i < cells.length; i++) expect(cells[i].pos[2] - cells[i - 1].pos[2]).toBeCloseTo(1000 / 60, 3);
    expect(r.pixels[0].normal[2]).toBe(-1);
    expect(r.pixels[15].normal[2]).toBe(1);
  });

  it('tilts the cell light with the louver angle', () => {
    const r = build('louver-sconce', { angle: 45 });
    const c = r.pixels.find((p) => p.unit === 'S6-C')!;
    expect(c.normal[2]).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(c.normal[1]).toBeCloseTo(-Math.SQRT1_2, 3); // faces -Y, out from the wall
  });
});

describe('S7 Moiré Lantern', () => {
  it('spirals a metre of 60/m strip up the core', () => {
    const r = build('moire-lantern');
    expect(r.pixels).toHaveLength(60);
    expect(r.report.rows[0].qty).toBe('1.00 m');
    for (let i = 1; i < 60; i++) expect(r.pixels[i].pos[2]).toBeGreaterThan(r.pixels[i - 1].pos[2]);
    expect(size(r, 'outer', 0)).toBeCloseTo(150, 0);
    expect(size(r, 'outer', 2)).toBeCloseTo(200, 0);
  });

  it('solves the helix so the strip length is exact', () => {
    const { rise, turns } = stripHelix(1000, 170, 33.8);
    expect(Math.hypot(turns * 2 * Math.PI * 33.8, rise)).toBeCloseTo(1000, 6);
  });
});

describe('S8 Contour', () => {
  it('stacks one tray per band and sizes nodes per band, rising from the shore', () => {
    const r = build('contour');
    const bands = r.parts.filter((p) => p.id.startsWith('band-'));
    expect(bands).toHaveLength(8);
    expect(r.report.rows).toHaveLength(8);
    for (const row of r.report.rows) {
      expect(row.px).toBeGreaterThanOrEqual(2);
      expect(row.px).toBeLessThanOrEqual(6);
    }
    expect(r.pixels.length).toBeGreaterThanOrEqual(26);
    expect(r.pixels.length).toBeLessThanOrEqual(40);
    // Rising water: data order climbs band by band.
    const band = (u: string) => Number(u.split('-')[1]);
    for (let i = 1; i < r.pixels.length; i++) expect(band(r.pixels[i].unit)).toBeGreaterThanOrEqual(band(r.pixels[i - 1].unit));
    expect(r.pixels[r.pixels.length - 1].pos[2]).toBeGreaterThan(r.pixels[0].pos[2]);
  });

  it('cuts a heightmap image into the requested bands', () => {
    const cone = encodeImage(imageFrom(64, 64, (u, v) => 1 - 1.6 * Math.hypot(u - 0.5, v - 0.5)));
    const r = build('contour', { image: cone, bands: 6 });
    expect(r.parts.filter((p) => p.id.startsWith('band-'))).toHaveLength(6);
  });
});
