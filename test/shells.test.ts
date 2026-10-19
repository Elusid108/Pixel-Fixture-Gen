import type { ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/runBuild';
import { planDome } from '../src/fixtures/l/dome';
import { planDrum } from '../src/fixtures/l/drum';
import { planOrb } from '../src/fixtures/l/orb';
import { planPolyhedron } from '../src/fixtures/l/polyhedra';
import { buildPanel, capJoints, capRegion, faceFrame, stripSlot, TONGUE_D, TONGUE_T, tongueSection } from '../src/fixtures/l/shell';
import { L_FIXTURES } from '../src/fixtures/series-l';
import { Geo } from '../src/geom/geo';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { frameZ, perp } from '../src/geom/vec';
import { getPixel } from '../src/pixels/library';
import { boundsFit, getPrinter } from '../src/printers';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

type P = Record<string, string | number | boolean>;
const build = (id: string, p: P = {}) => runBuild(wasm, id, p);
const units = (r: ReturnType<typeof build>) => r.report.rows.map((x) => x.unit);
const pxIn = (r: ReturnType<typeof build>, unit: string) => r.pixels.filter((p) => p.unit === unit).length;
const counts = (cls: { members: number[] }[]) => cls.map((c) => c.members.length).sort((a, b) => a - b);
const SHELLS = ['orb', 'dome', 'drum', 'polyhedra'];

describe('L1 Orb: faces and vertex stars', () => {
  it('has 10f²+2 vertices and a star in every cap but the crown', () => {
    expect(planOrb(2, 500).verts).toHaveLength(42);
    expect(planOrb(3, 500).verts).toHaveLength(92);
    expect(planOrb(2, 500).vertOrder).toHaveLength(41);
    expect(planOrb(3, 500).vertOrder).toHaveLength(91);
    // The 3V dedupe the roadmap promises survives the shared shell code.
    expect(counts(planOrb(3, 500).faceClasses)).toEqual([60, 120]);
  });

  it('schedules faces and stars as two units in data order, at 2V and 3V', () => {
    const r2 = build('orb', { freq: '2' });
    expect(units(r2)).toEqual(['L1-F', 'L1-V']);
    expect(pxIn(r2, 'L1-F')).toBe(80);
    expect(pxIn(r2, 'L1-V')).toBe(41);
    const r3 = build('orb');
    expect(units(r3)).toEqual(['L1-F', 'L1-V']);
    expect(pxIn(r3, 'L1-F')).toBe(180);
    expect(pxIn(r3, 'L1-V')).toBe(91);
    // Faces first, then stars: data order is array order.
    expect(r3.pixels.findIndex((p) => p.unit === 'L1-V')).toBe(180);
    // Power covers both types.
    expect(r3.report.totals.watts).toBeCloseTo((180 + 91) * 0.3, 6);
    expect(r3.parts.find((p) => p.id === 'lens')?.instances).toHaveLength(91);
  });

  it('runs the faces alone when the stars are off, and 7 px per cap with jewels', () => {
    const off = build('orb', { accent: 'none' });
    expect(units(off)).toEqual(['L1-F']);
    expect(off.parts.some((p) => p.id === 'lens')).toBe(false);
    const jw = build('orb', { freq: '2', accent: 'jewel-7-ws2812b' });
    expect(pxIn(jw, 'L1-V')).toBe(41 * 7);
    expect(jw.report.rows[1].qty).toBe('41×');
  });
});

describe('L7 Dome', () => {
  it('keeps the faces above the equator and stands them on an n-gon', () => {
    const d2 = planDome(2, 500);
    expect(d2.faces).toHaveLength(40);
    expect(d2.n).toBe(10);
    // Corner faces, centre faces, and the two kinds that carry a tongue into the ring.
    expect(counts(d2.faceClasses)).toEqual([5, 5, 5, 25]);
    expect(d2.faces.filter((f) => f.edges.includes('tongue'))).toHaveLength(10);
    expect(d2.verts.filter((v) => v.rim)).toHaveLength(10);
    const d4 = planDome(4, 500);
    expect(d4.faces).toHaveLength(160);
    expect(d4.n).toBe(20);
    expect(d4.faceClasses.length).toBeLessThanOrEqual(12);
  });

  it('schedules face nodes and the rim strip', () => {
    const r = build('dome');
    expect(units(r)).toEqual(['L7-F', 'L7-R']);
    expect(pxIn(r, 'L7-F')).toBe(40);
    expect(pxIn(r, 'L7-R')).toBeGreaterThan(80);
    expect(r.parts.some((p) => p.id.startsWith('base'))).toBe(true);
    expect(units(build('dome', { strip: 'none' }))).toEqual(['L7-F']);
  });
});

describe('L8 Drum', () => {
  const o = { sides: 10, tiers: 3, diameter: 420, tierH: 120, bandH: 14, amount: 0.15 };
  it('prints every tier of a straight drum from one panel', () => {
    const p = planDrum({ ...o, profile: 'straight' });
    expect(p.faces).toHaveLength(30);
    expect(counts(p.faceClasses)).toEqual([30]);
    // A barrel's top and bottom tiers are the same panel turned over; a taper's are all different.
    expect(counts(planDrum({ ...o, profile: 'barrel' }).faceClasses)).toEqual([10, 20]);
    expect(counts(planDrum({ ...o, profile: 'taper' }).faceClasses)).toEqual([10, 10, 10]);
    expect(counts(planDrum({ ...o, sides: 8, tiers: 4, profile: 'straight' }).faceClasses)).toEqual([32]);
  });

  it('schedules panel nodes and a strip in every band', () => {
    const r = build('drum');
    expect(units(r)).toEqual(['L8-P', 'L8-S']);
    expect(pxIn(r, 'L8-P')).toBe(30);
    expect(pxIn(r, 'L8-S')).toBe(r.report.rows[1].px);
    expect(pxIn(r, 'L8-S') % 4).toBe(0);
    expect(r.parts.filter((p) => p.id.startsWith('band-')).reduce((s, p) => s + p.instances.length, 0)).toBeGreaterThanOrEqual(4);
  });
});

describe('L9 Polyhedra', () => {
  it('builds the football from pentagons and hexagons, and the Platonic solids from one panel', () => {
    const t = planPolyhedron('trunc-ico', 450);
    expect(t.faces).toHaveLength(32);
    expect(counts(t.faceClasses)).toEqual([12, 20]);
    expect(t.faceClasses.map((c) => t.faces[c.rep].pts.length).sort()).toEqual([5, 6]);
    expect(t.verts).toHaveLength(60);
    expect(t.vertexClasses.map((c) => c.id).sort()).toEqual(['VA', 'crown']);
    const d = planPolyhedron('dodeca', 450);
    expect(counts(d.faceClasses)).toEqual([12]);
    expect(d.verts).toHaveLength(20);
    const i = planPolyhedron('ico', 450);
    expect(counts(i.faceClasses)).toEqual([20]);
    expect(i.verts).toHaveLength(12);
  });

  it('schedules face pixels and vertex stars', () => {
    const r = build('polyhedra');
    expect(units(r)).toEqual(['L9-F', 'L9-V']);
    expect(pxIn(r, 'L9-F')).toBe(32);
    expect(pxIn(r, 'L9-V')).toBe(59);
    const jw = build('polyhedra', { solid: 'dodeca', pixel: 'jewel-7-ws2812b' });
    expect(pxIn(jw, 'L9-F')).toBe(12 * 7);
    expect(pxIn(jw, 'L9-V')).toBe(19);
  });
});

describe('Fit gap on the shell joints', () => {
  it('opens the female side of every joint by the fit gap', () => {
    const pcb = getPixel('pcb-9-ws2812b');
    for (const fit of [0.2, 0.4, 0.8]) {
      const j = capJoints({ fit, seat: 0.15 }, pcb, true);
      expect(2 * (j.holeR - j.spigR)).toBeCloseTo(fit, 9);
      expect(2 * (j.lensBoreR - j.lensR)).toBeCloseTo(fit, 9);
      const L = { a0: 200, z0: 0, s: 0 };
      const groove = tongueSection(L, -1, fit / 2, 1);
      const tongue = tongueSection(L, -1, 0, 0.3);
      expect(groove[1][0] - groove[0][0] - (tongue[1][0] - tongue[0][0])).toBeCloseTo(fit, 9);
      expect(groove[0][1]).toBeCloseTo(-(TONGUE_D + fit / 2), 9);
      expect(tongue[1][0] - tongue[0][0]).toBeCloseTo(TONGUE_T, 9);
    }
    // The male side does not move with the fit gap.
    expect(capJoints({ fit: 0.8 }, pcb, true).spigR).toBe(capJoints({ fit: 0.2 }, pcb, true).spigR);
    expect(stripSlot(getPixel('strip-60-ws2812b'), 0.15)?.w).toBeCloseTo(3.3, 9);
  });

  it('cuts the panels’ corner hole to spigot + fit in the real geometry', () => {
    inArena(wasm, () => {
      const g = new Geo(makeCtx(wasm));
      const plan = planOrb(3, 500);
      const v = plan.verts.find((x) => !x.top && x.faces.length === 6)!;
      const node = getPixel('node-12-bullet');
      const holes: number[] = [];
      for (const fit of [0.2, 0.8]) {
        const j = capJoints({ fit, seat: 0.15 }, getPixel('pcb-9-ws2812b'), true);
        const { rc } = capRegion(plan, j);
        const around = g.union(v.faces.map((fi) => g.place(buildPanel(g, plan, plan.faces[fi], { side: j.side, seat: j.seat, pixel: node, rc, caps: j }).solid, faceFrame(plan.faces[fi]))));
        const probe = (r: number) => around.intersect(g.place(g.cylZ(r, 0.5, 4), frameZ(v.spoke, perp(v.spoke), v.p))).volume();
        expect(probe(j.holeR - 0.05)).toBeLessThan(1e-3);
        expect(probe(j.holeR + 0.5)).toBeGreaterThan(0.1);
        holes.push(j.holeR);
      }
      expect(holes[1] - holes[0]).toBeCloseTo(0.3, 9);
    });
  });

  it('builds every shell manifold at fit 0.2, 0.4 and 0.8', () => {
    for (const id of SHELLS)
      for (const fit of [0.2, 0.4, 0.8]) {
        const r = build(id, { fit });
        expect(r.errors, `${id} fit ${fit}`).toEqual([]);
        expect(r.assembly.length, id).toBeGreaterThanOrEqual(4);
      }
  }, 120_000);
});

describe('Shell registry', () => {
  it('registers the three new shells, auto-split and fit-aware, and they fit the smallest printer', () => {
    const mini = getPrinter('bambu-a1mini');
    for (const code of ['L7', 'L8', 'L9']) {
      const def = L_FIXTURES.find((f) => f.code === code)!;
      expect(def, code).toBeTruthy();
      for (const key of ['fit', 'seat', 'printer']) expect(def.params.find((p) => p.key === key)?.hidden, `${code} ${key}`).toBe(true);
      const r = build(def.id, { printer: mini.id });
      expect(r.errors, code).toEqual([]);
      expect(r.parts.filter((p) => !boundsFit(p.bounds, mini)).map((p) => p.name), code).toEqual([]);
    }
  }, 120_000);
});
