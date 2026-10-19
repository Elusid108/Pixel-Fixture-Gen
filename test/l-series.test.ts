import type { ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { Geo } from '../src/geom/geo';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { apply, applyDir } from '../src/geom/mat';
import { fitsPrinter, maxArcDeg, splitLinear, splitToBed } from '../src/geom/split';
import { dist, dot } from '../src/geom/vec';
import { runBuild } from '../src/build/runBuild';
import { getFixture } from '../src/fixtures/registry';
import { L_FIXTURES, L_PLANNED } from '../src/fixtures/series-l';
import { assembledBounds } from '../src/fixtures/l/common';
import { planOrb } from '../src/fixtures/l/orb';
import { cascadeDrops } from '../src/fixtures/l/cascade';
import { columnProfile } from '../src/fixtures/l/gasolier';
import { crossings, ringDefs } from '../src/fixtures/l/armillary';
import { bloomTiers, SIGHTLINE } from '../src/fixtures/l/bloom';
import { planHelix } from '../src/fixtures/l/helix';
import { resolveParams } from '../src/fixtures/util';
import { boundsFit, getPrinter } from '../src/printers';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

const geo = () => new Geo(makeCtx(wasm));

describe('splitToBed', () => {
  it('leaves a part that already fits alone', () => {
    inArena(wasm, () => {
      const g = geo();
      const r = splitToBed(g, g.box([0, 0, 0], [100, 100, 20]), getPrinter('bambu-256'));
      expect(r.pieces).toBe(1);
      expect(r.cuts).toBe(0);
    });
  });

  it('cuts a long bar into keyed pieces that each fit and keep the assembled pose', () => {
    inArena(wasm, () => {
      const g = geo();
      const bar = g.box([0, 0, 0], [600, 40, 20]);
      const printer = getPrinter('bambu-256');
      const r = splitToBed(g, bar, printer, { joint: 'dovetail' });
      expect(r.fits).toBe(true);
      expect(r.pieces).toBe(3);
      expect(r.cuts).toBe(2);
      expect(r.pins).toBe(2);
      let vol = 0;
      for (const p of r.parts) {
        expect(p.solid.status()).toBe('NoError');
        expect(fitsPrinter(p.solid, printer)).toBe(true);
        expect(p.solid.boundingBox().min[2]).toBeCloseTo(0, 6);
        for (const M of p.instances) {
          vol += p.solid.volume();
          // Back in place, every piece sits inside the bar's envelope (keys included).
          const b = p.solid.boundingBox();
          const c = apply(M, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
          expect(c[0]).toBeGreaterThan(-1);
          expect(c[0]).toBeLessThan(601);
          expect(c[1]).toBeCloseTo(20, 0);
        }
      }
      // Material is exchanged, never invented: only clearance and pin holes are lost.
      expect(vol).toBeLessThan(bar.volume());
      expect(vol).toBeGreaterThan(bar.volume() * 0.985);
    });
  });

  it('stacks a tall column with spigots and rim plugs', () => {
    inArena(wasm, () => {
      const g = geo();
      const col = g.tubeZ(30, 6, 0, 500);
      const printer = getPrinter('bambu-256');
      const r = splitToBed(g, col, printer, { joint: 'dovetail' });
      expect(r.fits).toBe(true);
      expect(r.pieces).toBe(3);
      // A dovetail can't run across a horizontal cut, so it falls back to the spigot.
      expect(r.fallbacks).toBe(2);
      expect(r.bare).toBe(0);
      for (const p of r.parts) expect(p.solid.boundingBox().max[2]).toBeLessThanOrEqual(printer.z);
    });
  });

  it('splits a symmetric ring into identical arcs, one part printed ×n', () => {
    inArena(wasm, () => {
      const g = geo();
      const ring = g.revolve(
        [
          [200, 0],
          [250, 0],
          [250, 12],
          [200, 12],
        ],
        192,
      );
      const printer = getPrinter('bambu-256');
      const opts = { mode: 'radial' as const, sectors: (n: number) => 48 % n === 0, phase: (n: number) => 180 / n };
      const r = splitToBed(g, ring, printer, opts);
      expect(r.fits).toBe(true);
      expect(r.parts).toHaveLength(1);
      expect(r.parts[0].instances.length).toBe(r.pieces);
      expect(r.pieces).toBeGreaterThanOrEqual(4);
      const mini = splitToBed(g, ring, getPrinter('bambu-a1mini'), opts);
      expect(mini.fits).toBe(true);
      expect(mini.pieces).toBeGreaterThan(r.pieces);
    });
  });

  it('sizes straight runs and arcs to the printer', () => {
    expect(splitLinear(500, 250, 4)).toEqual({ count: 2, length: 248 });
    expect(splitLinear(200, 250, 4).count).toBe(1);
    const a = maxArcDeg(234, 250, 22, getPrinter('bambu-256'));
    expect(a).toBeGreaterThan(55);
    expect(a).toBeLessThan(65);
  });
});

const build = (id: string, p: Record<string, string | number | boolean> = {}) => runBuild(wasm, id, p);
const copies = (r: ReturnType<typeof build>, id: string) => r.parts.filter((p) => p.id.startsWith(id)).reduce((s, p) => s + p.instances.length, 0);

describe('L-series registry', () => {
  it('builds all nine and leaves nothing on the drawing board', () => {
    expect(L_FIXTURES.map((f) => f.code)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9']);
    expect(L_PLANNED).toHaveLength(0);
    for (const f of L_FIXTURES) expect(f.params.find((p) => p.key === 'printer')?.hidden).toBe(true);
  });

  it('auto-splits every fixture to fit the smallest printer', () => {
    const mini = getPrinter('bambu-a1mini');
    for (const f of L_FIXTURES) {
      const r = build(f.id, { printer: mini.id });
      expect(r.errors, f.code).toEqual([]);
      expect(
        r.parts.filter((p) => !boundsFit(p.bounds, mini)).map((p) => p.name),
        f.code,
      ).toEqual([]);
    }
  });
});

describe('L1 The Orb', () => {
  it('has 20f² faces and dedupes them into a few shapes', () => {
    expect(planOrb(2, 500).faces).toHaveLength(80);
    expect(planOrb(3, 500).faces).toHaveLength(180);
    expect(planOrb(4, 500).faces).toHaveLength(320);
    // 2V: 60 corner faces + 20 centre faces. 3V: A ×60, B ×120 (the roadmap's count).
    const counts = (f: number) => planOrb(f, 500).faceClasses.map((c) => c.members.length).sort((a, b) => a - b);
    expect(counts(2)).toEqual([20, 60]);
    expect(counts(3)).toEqual([60, 120]);
    expect(counts(4).reduce((s, n) => s + n, 0)).toBe(320);
    expect(counts(4).length).toBeLessThanOrEqual(8);
    expect(planOrb(3, 500).verts).toHaveLength(92);
  });

  it('places every panel copy on its own face, outer face out', () => {
    const plan = planOrb(3, 500);
    const r = build('orb');
    const panels = r.parts.filter((p) => p.id.startsWith('panel-'));
    expect(panels.reduce((s, p) => s + p.instances.length, 0)).toBe(180);
    const used = new Set<number>();
    for (const p of panels)
      for (const M of p.instances) {
        const o = apply(M, [0, 0, 0]);
        const f = plan.faces.find((x) => dist(x.c, o) < 0.01);
        expect(f).toBeTruthy();
        expect(dot(applyDir(M, [0, 0, 1]), f!.n)).toBeCloseTo(-1, 6);
        used.add(f!.idx);
      }
    expect(used.size).toBe(180);
    expect(r.pixels.filter((p) => p.unit === 'L1-F')).toHaveLength(180);
  });
});

describe('L2 Cascade', () => {
  it('lays out rows and length patterns', () => {
    const o = { diameter: 500, rows: 2, outer: 16, shortest: 260, longest: 600, seed: 7 };
    const cone = cascadeDrops({ ...o, pattern: 'cone' });
    expect(cone).toHaveLength(24);
    const inner = cone.filter((d) => d.row === 1).map((d) => d.length);
    const outer = cone.filter((d) => d.row === 0).map((d) => d.length);
    expect(Math.min(...inner)).toBeGreaterThan(Math.max(...outer));
    const a = cascadeDrops({ ...o, pattern: 'random', seed: 3 }).map((d) => d.length);
    expect(cascadeDrops({ ...o, pattern: 'random', seed: 3 }).map((d) => d.length)).toEqual(a);
    expect(cascadeDrops({ ...o, pattern: 'random', seed: 4 }).map((d) => d.length)).not.toEqual(a);
  });

  it('splits tall tubes on couplers and recommends 12 V at high 5 V current', () => {
    const r = build('cascade');
    expect(r.report.totals.px).toBe(240);
    expect(copies(r, 'coupler')).toBeGreaterThan(0);
    for (const p of r.parts.filter((x) => x.id.startsWith('tube-'))) expect(p.bounds.max[2] - p.bounds.min[2]).toBeLessThanOrEqual(256);
    expect(r.warnings.some((w) => w.includes('WS2815'))).toBe(true);
    // Eight keyed crown arcs in two shapes: plain, and with a suspension lug.
    const crown = r.parts.filter((p) => p.id.startsWith('crown-'));
    expect(crown.reduce((s, p) => s + p.instances.length, 0)).toBe(8);
    expect(crown).toHaveLength(2);
  });
});

describe('L3 Gasolier', () => {
  it('defaults to RGBW: 8 flames × 3 + 16 up + 7 down = 47 px on 188 channels', () => {
    const r = build('gasolier');
    expect(r.report.totals.px).toBe(47);
    expect(r.report.totals.channels).toBe(188);
    expect(copies(r, 'arm')).toBe(8);
    expect(copies(r, 'flame')).toBe(8);
  });

  it('keeps every lathe profile printable: it never grows faster than 45°', () => {
    for (const style of ['baluster', 'urn', 'bobeche'] as const) {
      const prof = columnProfile(style, 320);
      for (let i = 1; i < prof.length; i++) expect(prof[i][0] - prof[i - 1][0]).toBeLessThanOrEqual(prof[i][1] - prof[i - 1][1] + 1e-9);
    }
  });
});

describe('L4 Armillary', () => {
  it('crosses the ecliptic over the equator at the equinoxes, tilted 23.4°', () => {
    const [mer, equ, ecl] = ringDefs();
    const at = (a: typeof mer, b: typeof mer) => crossings(a, b, 250, 22).map((c) => Math.round(c.angle)).sort((x, y) => x - y);
    expect(at(equ, ecl)).toEqual([0, 180]);
    expect(at(equ, mer)).toEqual([90, 270]);
    expect(dot(applyDir(equ.L, [0, 0, 1]), applyDir(ecl.L, [0, 0, 1]))).toBeCloseTo(Math.cos((23.4 * Math.PI) / 180), 9);
    // A shallow crossing laps over a much longer run than a square one.
    expect(crossings(equ, ecl, 250, 22)[0].half).toBeGreaterThan(3 * crossings(equ, mer, 250, 22)[0].half);
  });

  it('splits each Ø500 ring into keyed arcs', () => {
    const r = build('armillary');
    for (const id of ['ring-mer', 'ring-equ', 'ring-ecl']) expect(copies(r, id)).toBeGreaterThanOrEqual(6);
    expect(r.pixels.length).toBeGreaterThan(250);
  });
});

describe('L5 Bloom', () => {
  it('has 6/8/10 petals and stays under the 14″ sightline even at the maximum', () => {
    const r = build('bloom');
    expect(copies(r, 'petal-1')).toBe(6);
    expect(copies(r, 'petal-2')).toBe(8);
    expect(copies(r, 'petal-3')).toBe(10);
    expect(r.report.totals.px).toBe(31);
    expect(r.warnings.some((w) => w.startsWith('Runtime about'))).toBe(true);
    for (const printer of ['prusa-xl', 'bambu-256']) {
      const def = getFixture('bloom');
      const top = inArena(wasm, () => assembledBounds(def.build(makeCtx(wasm), resolveParams(def, { height: 355, printer })).parts).max[2]);
      expect(top).toBeLessThan(SIGHTLINE);
    }
    expect(bloomTiers('6/8/10', 355, 360).capped).toBe(true);
  });
});

describe('L6 Helix', () => {
  it('stacks 10 segments into 20 base pairs and 100 px', () => {
    const r = build('helix');
    expect(r.report.totals.px).toBe(100);
    expect(copies(r, 'rung')).toBe(20);
    // One backbone shape serves both strands at every height.
    expect(r.parts.filter((p) => p.id.startsWith('backbone'))).toHaveLength(1);
    expect(copies(r, 'backbone')).toBe(20);
    const plan = planHelix({ segments: 10, span: 140, pitch: 340, hand: 1 });
    expect(plan.rungs).toHaveLength(20);
    expect(plan.rungs[19].z - plan.rungs[0].z).toBe(19 * 60);
    // The bars pass off the axis, so the strands sit less than 180° apart: the minor groove.
    expect(plan.groove).toBeLessThan(180);
  });
});
