import { describe, expect, it } from 'vitest';
import { resolveParams } from '../src/fixtures/util';
import { boundsOf, inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { add, dist, scale } from '../src/geom/vec';
import { miniRig } from '../src/modules/mini-rig/build';
import { emptyDesign, parseDesign, type RigDesign } from '../src/modules/mini-rig/model';
import { rigDims, rigParams, TRUSS_W } from '../src/modules/mini-rig/params';
import { frameHoles } from '../src/modules/mini-rig/parts';
import { blockType, FACES, FIT_TOL, pinwheel, planRig, planSections } from '../src/modules/mini-rig/plan';
import { addRuns, miniRigCore } from '../src/modules/mini-rig/system';
import { boundsFit, getPrinter } from '../src/printers';
import type { Params, Vec3 } from '../src/types';

const plan = (d: RigDesign, p: Params = {}) => planRig(d, rigParams(p));
const bit = (...faces: number[]) => faces.reduce((m, f) => m | (1 << f), 0);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('M3 Mini Rig: sketch adapter', () => {
  it('M3 Mini Rig: drawn path gives truss runs with a corner', () => {
    const pts: Vec3[] = [
      [0, 0, 500],
      [600, 0, 500],
      [600, 400, 500],
    ];
    const d = miniRigCore.fromPaths!([{ id: 'p1', pts, closed: false }], emptyDesign(), {});
    expect(d.nodes).toHaveLength(3);
    expect(d.spans).toHaveLength(2);
    const [s1, s2] = d.spans;
    const shared = [s1.a, s1.b].find((n) => n === s2.a || n === s2.b)!;
    expect(d.nodes.find((n) => n.id === shared)!.pos).toEqual([600, 0, 500]);

    for (const printer of ['bambu-256', 'bambu-a1mini']) {
      const p = plan(d, { printer });
      const corner = p.nodes.find((n) => n.id === shared)!;
      expect(corner.ways).toBe(2);
      expect(corner.type).toBe('corner');
      expect(corner.label).toBe('2-way corner (90°)');
      expect(corner.bad).toBe(false);
      for (const end of p.nodes.filter((n) => n.id !== shared)) expect(end.type).toBe('end');

      const bed = getPrinter(printer);
      for (const sp of p.spans) {
        expect(sp.ok).toBe(true);
        // Corner allowance: half a 48 mm block at each end.
        expect(sp.clear).toBeCloseTo(sp.length - TRUSS_W, 6);
        expect(Math.abs(sum(sp.sections.map((s) => s.len)) - sp.clear)).toBeLessThan(0.5);
        for (const s of sp.sections) {
          expect(s.len).toBeLessThanOrEqual(bed.z);
          expect(s.len).toBeGreaterThanOrEqual(20);
        }
        // Sections butt end to end from one block face to the other.
        expect(sp.sections[0].start).toBeCloseTo(TRUSS_W / 2, 6);
        const last = sp.sections[sp.sections.length - 1];
        expect(last.start + last.len).toBeCloseTo(sp.length - TRUSS_W / 2, 0);
      }
    }
    // 600 − 48 = 552 = 1.5 m + 1.5 m + a 52 mm custom piece in the middle.
    const first = plan(d).spans.find((s) => s.length === 600)!;
    expect(first.sections.map((s) => Math.round(s.len))).toEqual([250, 52, 250]);
  });

  it('squares near-orthogonal strokes, merges with existing nodes and appends', () => {
    const base = miniRigCore.fromPaths!(
      [
        {
          id: 'a',
          pts: [
            [0, 0, 300],
            [500, 20, 300],
          ],
          closed: false,
        },
      ],
      emptyDesign(),
      {},
    );
    // 20 mm over 500 is 2.3°: squared up onto the X axis.
    expect(base.nodes[1].pos).toEqual([500, 0, 300]);
    const more = miniRigCore.fromPaths!(
      [
        {
          id: 'b',
          pts: [
            [505, 5, 300],
            [505, 400, 300],
          ],
          closed: false,
        },
      ],
      base,
      {},
    );
    expect(more.nodes).toHaveLength(3);
    expect(more.spans).toHaveLength(2);
    expect(more.spans[1].a).toBe(base.nodes[1].id);
    expect(plan(more).nodes.find((n) => n.id === base.nodes[1].id)!.label).toBe('2-way corner (90°)');
  });

  it('flags spans that F34 blocks cannot take', () => {
    const d = addRuns(emptyDesign(), [
      {
        pts: [
          [0, 0, 300],
          [400, 0, 300],
          [700, 300, 300],
        ],
        closed: false,
      },
    ]);
    const p = plan(d);
    expect(p.nodes[1].bad).toBe(true);
    expect(p.warnings.some((w) => w.includes('off square'))).toBe(true);
  });

  it('lifts desk-level drawings so the blocks sit on the desk', () => {
    const d = addRuns(emptyDesign(), [
      {
        pts: [
          [0, 0, 0],
          [300, 0, 0],
        ],
        closed: false,
      },
    ]);
    expect(d.nodes.every((n) => n.pos[2] === TRUSS_W / 2)).toBe(true);
  });
});

describe('M3 Mini Rig: planning', () => {
  const dims = rigDims(rigParams());
  it('cuts runs into few, equal stock sections plus one short custom piece', () => {
    expect(planSections(500, dims.catalogue, 256).lengths.map(Math.round)).toEqual([250, 250]);
    expect(planSections(1000 / 3, dims.catalogue, 256).lengths.map(Math.round)).toEqual([167, 167]);
    const mini = planSections(552, dims.catalogueAll, 180);
    expect(mini.lengths.every((l) => l <= 180)).toBe(true);
    expect(mini.custom).toBeCloseTo(52, 6);
    for (const clear of [20, 35, 90, 260, 352, 777, 1234.5, 3000]) {
      const cut = planSections(clear, dims.catalogue, 256);
      expect(Math.abs(sum(cut.lengths) - clear)).toBeLessThan(0.5);
      if (cut.custom !== null) {
        expect(cut.custom).toBeGreaterThanOrEqual(20);
        expect(cut.custom).toBeLessThan(250 / 3 + 20);
      }
    }
    expect(planSections(10, dims.catalogue, 256).lengths).toEqual([]);
  });

  it('names corner blocks by the faces their spans use', () => {
    expect(blockType(bit(0)).label).toBe('1-way end');
    expect(blockType(bit(0, 1)).label).toBe('2-way inline (180°)');
    expect(blockType(bit(0, 2)).label).toBe('2-way corner (90°)');
    expect(blockType(bit(0, 2, 5)).label).toBe('3-way corner');
    expect(blockType(bit(0, 1, 2)).label).toBe('3-way T');
    expect(blockType(bit(0, 1, 2, 3)).label).toBe('4-way cross');
    expect(blockType(bit(0, 1, 2, 5)).label).toBe('4-way T');
    expect(blockType(bit(0, 1, 2, 3, 4, 5)).ways).toBe(6);
  });

  it('keeps bolt holes of neighbouring block faces apart (pinwheel)', () => {
    const W = dims.W;
    const holes = FACES.map((f) =>
      pinwheel(dims.boltAt, dims.boltOff).map(([a, b]) => {
        const p = add(add(scale(f.n, W / 2), scale(f.u, a)), scale(f.v, b));
        return Array.from({ length: 7 }, (_, k) => add(p, scale(f.n, -k)));
      }),
    );
    let min = Infinity;
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++)
        for (const h1 of holes[i]) for (const h2 of holes[j]) for (const p of h1) for (const q of h2) min = Math.min(min, dist(p, q));
    // Two Ø4 heat-set holes need more than 4 mm between axes.
    expect(min).toBeGreaterThan(6);
  });

  it('lines every block face up with the section end frame bolted to it', () => {
    for (const preset of miniRigCore.presets) {
      const p = plan(preset.make());
      const W = p.dims.W;
      const nodeById = new Map(p.nodes.map((n) => [n.id, n]));
      for (const sp of p.spans) {
        for (const [nid, endAt] of [
          [sp.a, sp.sections[0].start],
          [sp.b, sp.sections[sp.sections.length - 1].start + sp.sections[sp.sections.length - 1].len],
        ] as [string, number][]) {
          const n = nodeById.get(nid)!;
          const centre = add(sp.frame.A, scale(sp.frame.d, endAt));
          const frame = frameHoles(p.dims).map(([x, y]) => add(add(centre, scale(sp.frame.up, x)), scale(sp.frame.front, y)));
          // Block holes on the face that touches this section end.
          const toWorld = (v: Vec3): Vec3 => {
            const r = n.classRot;
            const a: Vec3 = [0, 1, 2].map((k) => r[k][0] * v[0] + r[k][1] * v[1] + r[k][2] * v[2]) as Vec3;
            return add(n.pos, add(add(scale(n.axes[0], a[0]), scale(n.axes[1], a[1])), scale(n.axes[2], a[2])));
          };
          const block = FACES.flatMap((f, fi) => (n.classKey & (1 << fi) ? pinwheel(p.dims.boltAt, p.dims.boltOff).map(([a, b]) => toWorld(add(add(scale(f.n, W / 2), scale(f.u, a)), scale(f.v, b)))) : []));
          const onFace = block.filter((h) => Math.abs(dist(h, centre) - Math.hypot(p.dims.boltAt, p.dims.boltOff)) < 0.01);
          expect(onFace).toHaveLength(4);
          // Stock sections fill a run to within FIT_TOL; the Ø3.3 holes take that up.
          for (const h of onFace) expect(Math.min(...frame.map((f) => dist(f, h)))).toBeLessThan(FIT_TOL);
        }
      }
    }
  });

  it('chains instruments along the rig from the feed block', () => {
    const d = miniRigCore.presets[0].make();
    const p = plan(d);
    expect(p.controller).toBe('N01');
    expect(p.instruments.map((i) => i.id)).toEqual(['B01', 'P01', 'P02', 'P03', 'L01', 'P04', 'P05', 'P06', 'B02']);
    expect(p.px).toBe(54);
    expect(p.warnings).toEqual([]);
    expect(p.blockGroups.map((g) => g.label).sort()).toEqual(['1-way end + base', '2-way corner (90°)']);
    // Moving the feed to the far tower reverses the order.
    const q = plan({ ...d, controller: 'N04' });
    expect(q.instruments.map((i) => i.id)).toEqual(['B02', 'P06', 'P05', 'P04', 'L01', 'P03', 'P02', 'P01', 'B01']);
  });

  it('parses its own presets exactly and survives junk', () => {
    for (const preset of miniRigCore.presets) {
      const d = preset.make();
      expect(miniRigCore.parse(JSON.stringify(d))).toEqual(d);
    }
    expect(parseDesign('{nope')).toEqual(emptyDesign());
    const junk = parseDesign(JSON.stringify({ nodes: [{ id: 'N01', pos: [0, 0] }, null], spans: [{ id: 'S01' }], instruments: [{ id: 'X', kind: 'laser', span: 'S01' }, { id: 'P01', kind: 'par', span: 'S01', t: 7 }] }));
    expect(junk.nodes).toEqual([]);
    expect(junk.spans).toEqual([]);
    expect(junk.instruments).toEqual([{ id: 'P01', kind: 'par', span: 'S01', t: 1, side: 'below-front', pan: 0, tilt: 0 }]);
  });

  it('removes a block with its spans and the instruments on them', () => {
    const d = miniRigCore.presets[0].make();
    const r = miniRigCore.remove!(d, { kind: 'node', id: 'N02' });
    expect(r.spans.map((s) => s.id)).toEqual(['S03']);
    expect(r.instruments.map((i) => i.id)).toEqual(['B02']);
  });
});

describe('M3 Mini Rig: build', () => {
  it('builds the goalpost: valid parts that fit, pixels in data order', async () => {
    const wasm = await loadManifold();
    const d = miniRigCore.presets[0].make();
    for (const printer of ['bambu-256', 'bambu-a1mini']) {
      const out = inArena(wasm, () => {
        const o = miniRig.build(makeCtx(wasm), resolveParams(miniRig, { design: JSON.stringify(d), printer }));
        return {
          px: o.pixels.length,
          units: [...new Set(o.pixels.map((x) => x.unit))],
          schedule: o.schedule.map((s) => s.unit),
          parts: o.parts.map((p) => ({ ok: p.solid.status() === 'NoError', vol: p.solid.volume(), n: p.instances.length, fits: boundsFit(boundsOf(p.solid), getPrinter(printer)) })),
        };
      });
      expect(out.px).toBe(54);
      expect(out.units).toEqual(out.schedule);
      expect(out.parts.length).toBeGreaterThan(10);
      for (const p of out.parts) {
        expect(p.ok).toBe(true);
        expect(p.vol).toBeGreaterThan(0);
        expect(p.n).toBeGreaterThan(0);
        expect(p.fits).toBe(true);
      }
    }
  }, 30000);
});
