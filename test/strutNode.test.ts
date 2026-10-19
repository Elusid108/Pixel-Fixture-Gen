import JSZip from 'jszip';
import type { ManifoldToplevel } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/runBuild';
import { packPlates } from '../src/export/plates';
import { build3mf } from '../src/export/threemf';
import { loadManifold } from '../src/geom/manifold';
import {
  analyze,
  applyRot,
  dist,
  dot,
  getPreset,
  matchSockets,
  norm,
  planChain,
  planDesign,
  requiredAngle,
  snDims,
  snParams,
  socketOffset,
  sub,
  type PathStrut,
  type SnDesign,
  type SocketInfo,
} from '../src/modules/strut-node';
import { getPrinter } from '../src/printers';
import type { Params, Vec3 } from '../src/types';

const dims = (p: Params = {}) => snDims(snParams(p));
const plan = (d: SnDesign, p: Params = {}) => planDesign(d, snParams(p));

function line(points: Vec3[], extra: [number, number][] = []): SnDesign {
  const nodes = points.map((pos, i) => ({ id: `H${String(i + 1).padStart(2, '0')}`, pos }));
  const pairs: [number, number][] = [...points.slice(1).map((_, i) => [i, i + 1] as [number, number]), ...extra];
  return { name: 't', nodes, struts: pairs.map(([a, b], i) => ({ id: `S${String(i + 1).padStart(2, '0')}`, a: nodes[a].id, b: nodes[b].id })), controller: 'H01', order: [] };
}

describe('Strut & Node: socket angles', () => {
  it('aims every socket along its exact strut vector', () => {
    const d = getPreset('icosa').make();
    const { an } = plan(d);
    const pos = new Map(d.nodes.map((n) => [n.id, n.pos]));
    for (const h of an.hubs) {
      expect(h.sockets).toHaveLength(5);
      for (const s of h.sockets) expect(dot(s.dir, norm(sub(pos.get(s.other)!, h.pos)))).toBeCloseTo(1, 9);
    }
  });

  it('measures the minimum inter-socket angle of the regular solids', () => {
    const min = (id: string) => Math.min(...plan(getPreset(id).make()).an.hubs.map((h) => h.minAngle!));
    expect(min('tetra')).toBeCloseTo(60, 1);
    expect(min('cube')).toBeCloseTo(90, 1);
    expect(min('octa')).toBeCloseTo(60, 1);
    expect(min('icosa')).toBeCloseTo(60, 1);
  });

  it('pushes sockets out as the angle closes and flags tubes that would still touch', () => {
    const D = dims();
    const wide = socketOffset(D, 90).offset;
    const tight = socketOffset(D, 30).offset;
    expect(tight).toBeGreaterThan(wide);
    const req = requiredAngle(D);
    // Ø22 tube at a 70 mm cap: 2·asin((11 + 0.4) / (70 − 9.5)) ≈ 21.7°
    expect(req).toBeCloseTo(21.7, 1);
    expect(socketOffset(D, req - 1).collide).toBe(true);
    expect(socketOffset(D, req + 1).collide).toBe(false);
    // A thinner tube packs tighter.
    expect(requiredAngle(dims({ tubeOD: 18 }))).toBeLessThan(req);
  });

  it('reports colliding struts on the hub that has them', () => {
    const a = (deg: number): Vec3 => [300 * Math.cos((deg * Math.PI) / 180), 300 * Math.sin((deg * Math.PI) / 180), 0];
    const d = line([[0, 0, 0], a(0), a(15)], [[0, 2]]);
    d.struts = d.struts.filter((s) => s.id !== 'S02');
    const { an } = plan(d);
    const hub = an.hubs.find((h) => h.id === 'H01')!;
    expect(hub.minAngle).toBeCloseTo(15, 3);
    expect(hub.collide).toBe(true);
    expect(an.warnings.some((w) => w.startsWith('H01:') && w.includes('15.0°'))).toBe(true);
  });
});

describe('Strut & Node: cut lengths', () => {
  it('cuts each tube to node distance minus both socket offsets', () => {
    for (const id of ['tetra', 'cube', 'octa', 'icosa', 'geo2v', 'tree']) {
      const { an } = plan(getPreset(id).make());
      for (const s of an.struts) {
        expect(Math.abs(s.cut - (s.length - s.offA - s.offB))).toBeLessThanOrEqual(0.3 + 1e-9);
        expect(s.litLength).toBeCloseTo(s.cut - 2 * an.dims.insert, 6);
      }
    }
  });

  it('matches a hand calculation for a single straight strut', () => {
    const { an } = plan(line([[0, 0, 0], [0, 0, 300]]));
    const s = an.struts[0];
    const off = an.hubs[0].offset;
    expect(an.hubs[1].offset).toBe(off);
    expect(s.cut).toBeCloseTo(300 - 2 * off, 6);
    // 60/m strip: one pixel per 16.67 mm of lit length.
    expect(s.px).toBe(Math.floor((s.cut - 2 * an.dims.insert) / (1000 / 60)));
  });

  it('splits tubes taller than the printer at couplers that land inside the cut length', () => {
    const d = line([[0, 0, 0], [0, 0, 600]]);
    const { an } = plan(d, { printer: 'bambu-a1mini' });
    const t = an.types[0];
    expect(t.tubeSegs).toBe(4);
    expect(t.tubeSegLen).toBeLessThanOrEqual(180);
    expect(t.tubeSegs * t.tubeSegLen + (t.tubeSegs - 1) * an.dims.coupler.ridge).toBeCloseTo(t.cut, 6);
  });

  it('builds dark struts as opaque wire-only tubes with no pixels', () => {
    const d = getPreset('cube').make();
    d.struts[0].dark = true;
    const { an, chain } = plan(d);
    expect(an.struts[0].px).toBe(0);
    expect(an.types.find((t) => t.dark)!.members).toEqual(['S01']);
    expect(chain.lit.some((r) => r.strut === 'S01')).toBe(false);
  });
});

describe('Strut & Node: dedupe', () => {
  it('collapses identical hubs and struts into print counts', () => {
    const { an } = plan(getPreset('icosa').make());
    expect(an.types).toHaveLength(1);
    expect(an.types[0].members).toHaveLength(30);
    // The controller hub has a feed bore, so it's its own part; the other 11 are one part.
    expect(an.classes.map((c) => c.members.length).sort((a, b) => a - b)).toEqual([1, 11]);
    const cube = plan(getPreset('cube').make()).an;
    expect(cube.classes.map((c) => c.members.length).sort((a, b) => a - b)).toEqual([1, 7]);
  });

  it('keeps every hub separate when engraving unique IDs', () => {
    const { an } = plan(getPreset('icosa').make(), { labels: 'ids' });
    expect(an.classes).toHaveLength(12);
    expect(an.classes.every((c) => c.sockets.every((s) => s.hubLabel === c.rep && /^S\d+$/.test(s.strutLabel)))).toBe(true);
  });

  it('finds the rotation between equivalent hubs and refuses mirror images', () => {
    const mk = (dirs: Vec3[]): SocketInfo[] =>
      dirs.map((d, i) => {
        const dir = norm(d);
        const face = norm(sub([0, 0, 1], dir.map((v) => v * dot([0, 0, 1], dir)) as Vec3));
        return { strut: `S${i}`, other: '', dir, face, lit: false, key: ['A', 'B', 'C'][i], hubLabel: '', strutLabel: '' };
      });
    const chiral = mk([
      [1, 0, -0.2],
      [0, 1, -0.4],
      [-1, -1, -0.1],
    ]);
    const rz = (v: Vec3): Vec3 => [-v[1], v[0], v[2]];
    const rotated = mk(chiral.map((s) => rz(s.dir)));
    const R = matchSockets(chiral, rotated);
    expect(R).not.toBeNull();
    for (let i = 0; i < 3; i++) expect(dist(applyRot(R!, chiral[i].dir), rotated[i].dir)).toBeLessThan(1e-6);
    const mirrored = mk(chiral.map((s) => [s.dir[0], -s.dir[1], s.dir[2]] as Vec3));
    expect(matchSockets(chiral, mirrored)).toBeNull();
  });

  it('prints the deduped parts with one instance per hub and per tube', () => {
    return loadManifold().then((wasm: ManifoldToplevel) => {
      const d = getPreset('icosa').make();
      const r = runBuild(wasm, 'strut-node', { design: JSON.stringify(d) });
      expect(r.errors).toEqual([]);
      const hubHalves = r.parts.filter((p) => p.id.startsWith('hub-'));
      expect(hubHalves.reduce((s, p) => s + p.instances.length, 0)).toBe(24);
      expect(r.parts.find((p) => p.id === 'tube-A')!.instances).toHaveLength(30);
      expect(r.parts.find((p) => p.id === 'spine-A')!.instances).toHaveLength(30);
    });
  });
});

describe('Strut & Node: hub split', () => {
  it('finds a support-free split for every hub in every preset', () => {
    for (const id of ['tetra', 'cube', 'octa', 'icosa', 'geo2v', 'tree']) {
      const { an } = plan(getPreset(id).make());
      for (const c of an.classes) {
        expect(c.split.supportFree, `${id} ${c.id} at ${c.split.overhangDeg.toFixed(1)}°`).toBe(true);
        expect(c.split.pins).toHaveLength(2);
        expect(c.split.bolt.clearance, `${id} ${c.id} bolt`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('Strut & Node: data path', () => {
  const S = (id: string, a: string, b: string, extra: Partial<PathStrut> = {}): PathStrut => ({ id, a, b, dark: false, flip: false, length: 100, ...extra });
  const contiguous = (steps: { from: string; to: string }[], start: string) => {
    let cur = start;
    for (const s of steps) {
      expect(s.from).toBe(cur);
      cur = s.to;
    }
  };

  it('walks a path end to end with no dark runs', () => {
    const c = planChain([S('S1', 'A', 'B'), S('S2', 'B', 'C'), S('S3', 'C', 'D')], 'A');
    expect(c.lit.map((r) => `${r.from}${r.to}`)).toEqual(['AB', 'BC', 'CD']);
    expect(c.darkSteps).toBe(0);
  });

  it('finds the Euler circuit of a triangle from any start', () => {
    const c = planChain([S('S1', 'A', 'B'), S('S2', 'B', 'C'), S('S3', 'C', 'A')], 'B');
    expect(c.lit).toHaveLength(3);
    expect(c.darkSteps).toBe(0);
    contiguous(c.steps, 'B');
  });

  it('runs dark back from dead ends, and only as far as the next lit strut', () => {
    const c = planChain([S('S1', 'H', 'A'), S('S2', 'H', 'B'), S('S3', 'H', 'C')], 'H');
    expect(c.lit).toHaveLength(3);
    expect(c.darkSteps).toBe(2);
    expect(c.darkMm).toBe(200);
    contiguous(c.steps, 'H');
  });

  it("doesn't burn bridges it can avoid (Fleury)", () => {
    // A triangle with a tail: starting at the tail's root, taking the tail first strands the loop.
    const c = planChain([S('S1', 'A', 'B'), S('S2', 'B', 'C'), S('S3', 'C', 'A'), S('S4', 'A', 'T')], 'A');
    expect(c.darkSteps).toBe(0);
    expect(c.lit[c.lit.length - 1].strut).toBe('S4');
  });

  it('covers every lit strut exactly once on every preset, starting at the controller', () => {
    for (const id of ['tetra', 'cube', 'octa', 'icosa', 'geo2v', 'tree']) {
      const d = getPreset(id).make();
      const { an, chain } = plan(d);
      const lit = chain.lit.map((r) => r.strut);
      expect(new Set(lit).size).toBe(lit.length);
      expect(lit.sort()).toEqual(an.struts.filter((s) => s.px > 0).map((s) => s.id).sort());
      contiguous(chain.steps, d.controller);
    }
    // Four odd-degree hubs: no single trail exists, so at least one dark run.
    expect(plan(getPreset('tetra').make()).chain.darkSteps).toBeGreaterThan(0);
    // Every octahedron hub has degree 4: an Euler circuit, no dark runs.
    expect(plan(getPreset('octa').make()).chain.darkSteps).toBe(0);
  });

  it('honours the clicked order, then continues the suggestion from where it ends', () => {
    const struts = [S('S1', 'A', 'B'), S('S2', 'B', 'C'), S('S3', 'C', 'D')];
    const c = planChain(struts, 'A', ['S3', 'S1']);
    expect(c.userCount).toBe(2);
    expect(c.lit.map((r) => r.strut)).toEqual(['S3', 'S1', 'S2']);
    contiguous(c.steps, 'A');
  });

  it('flips a strip by feeding it from the far end through a return wire', () => {
    const c = planChain([S('S1', 'A', 'B', { flip: true }), S('S2', 'B', 'C')], 'A');
    expect(c.lit[0]).toEqual({ strut: 'S1', from: 'B', to: 'A' });
    expect(c.steps[0]).toEqual({ strut: 'S1', from: 'A', to: 'B', lit: false });
    contiguous(c.steps, 'A');
  });

  it('lays pixels in data order, so the schedule patches strut by strut along the chain', () => {
    return loadManifold().then((wasm: ManifoldToplevel) => {
      const d = getPreset('tetra').make();
      const { chain } = plan(d);
      const r = runBuild(wasm, 'strut-node', { design: JSON.stringify(d) });
      const units = [...new Set(r.pixels.map((p) => p.unit))];
      expect(units).toEqual(chain.lit.map((l) => l.strut));
      expect(r.report.rows.map((row) => row.unit)).toEqual(units);
      expect(r.report.rows[0].start).toEqual({ universe: 1, channel: 1 });
      expect(r.report.totals.px).toBe(r.pixels.length);
      // Consecutive pixels inside one strut are one strip pitch apart.
      const first = r.pixels.filter((p) => p.unit === units[0]);
      expect(dist(first[0].pos, first[1].pos)).toBeCloseTo(1000 / 60, 3);
    });
  });
});

describe('Strut & Node: export', () => {
  it('packs the icosahedron onto plates and writes a 3MF with every printed copy', async () => {
    const wasm = await loadManifold();
    const r = runBuild(wasm, 'strut-node', { design: JSON.stringify(getPreset('icosa').make()) });
    const printer = getPrinter('bambu-256');
    const plates = packPlates(r.parts.map((p) => ({ id: p.id, bounds: p.bounds, count: p.instances.length })), printer);
    expect(plates.flatMap((p) => p.items).every((i) => !i.oversize)).toBe(true);
    const zip = await JSZip.loadAsync(await build3mf({ title: 'M4 Icosahedron', parts: r.parts, mode: 'plates', plates, printer }));
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect((xml.match(/<item /g) ?? []).length).toBe(r.parts.reduce((s, p) => s + p.instances.length, 0));
    expect(xml).toContain('name="Hub HA · half A"');
  });

  it('keeps analysis independent of the geometry kernel', () => {
    const D = dims();
    const a = analyze(getPreset('cube').make(), D);
    expect(a.struts).toHaveLength(12);
    expect(a.hubs).toHaveLength(8);
  });
});
