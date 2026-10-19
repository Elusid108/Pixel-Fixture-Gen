import { describe, expect, it } from 'vitest';
import { resolveParams } from '../src/fixtures/util';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { columnStack } from '../src/modules/column-stack/build';
import { parseDesign, type ColumnDesign, type SegKind } from '../src/modules/column-stack/model';
import { csDims, csParams } from '../src/modules/column-stack/params';
import { maxNodesPerRing, planColumns, planSegment } from '../src/modules/column-stack/plan';
import { columnStackCore, PRESETS } from '../src/modules/column-stack/system';

const P = csParams();
const D = csDims(P);

function one(mount: 'floor' | 'hang', kinds: SegKind[], z = 0): ColumnDesign {
  return {
    name: 't',
    stacks: [{ id: 'T01', pos: [0, 0, z], mount, ...(mount === 'hang' ? { drop: 200 } : {}), segments: kinds.map((kind, i) => ({ id: `S0${i + 1}`, kind })), cap: 'dome' }],
  };
}

describe('M6 Column Stack: plan', () => {
  it('M6 Column Stack: stack plan orders data up from the base', () => {
    const plan = planColumns(one('floor', ['ring', 'band', 'helix']), P);
    const st = plan.stacks[0];
    // Segments sit end to end on the base's spigot root.
    expect(st.segs.map((s) => s.z0)).toEqual([0, st.segs[0].h, st.segs[0].h + st.segs[1].h]);
    expect(st.colTop).toBeCloseTo(st.segs.reduce((a, s) => a + s.h, 0) + st.cap.h, 6);
    expect(st.zMin).toBe(0);
    expect(st.zMax).toBeCloseTo(D.baseTop + st.colTop, 6);
    // Units in data order: base end first, cap last, one per segment.
    expect(plan.units.map((u) => u.unit)).toEqual(['C1-S01', 'C1-S02', 'C1-S03', 'C1-CAP']);
    const lows = plan.units.map((u) => Math.min(...u.spots.map((s) => s.pos[2])));
    for (let i = 1; i < lows.length; i++) expect(lows[i]).toBeGreaterThan(lows[i - 1]);
  });

  it('runs data down from the canopy on a hanging drop', () => {
    const plan = planColumns(one('hang', ['band', 'ring', 'band'], 1200), P);
    const st = plan.stacks[0];
    expect(st.zMax).toBe(1200);
    expect(st.zMin).toBeCloseTo(1200 - D.canopyH - 200 - D.hangerT - st.colTop, 6);
    const highs = plan.units.map((u) => Math.max(...u.spots.map((s) => s.pos[2])));
    for (let i = 1; i < highs.length; i++) expect(highs[i]).toBeLessThan(highs[i - 1]);
    // The cap jewel faces down at the bottom of the drop.
    const cap = plan.units[plan.units.length - 1];
    expect(cap.unit).toBe('C1-CAP');
    expect(cap.spots[0].normal[2]).toBeCloseTo(-1, 9);
  });

  it('chains stacks in order', () => {
    const plan = planColumns(PRESETS.find((p) => p.id === 'chandelier')!.make(), P);
    const order = plan.units.map((u) => u.unit);
    expect(order.indexOf('C1-CAP')).toBeLessThan(order.indexOf('C2-S01'));
    expect(order.filter((u) => u.startsWith('C3'))).toEqual(['C3-S01', 'C3-S02', 'C3-S03']); // finial is unlit
  });

  it('gives each segment kind its own pixel form and count', () => {
    const px = (kind: SegKind) => planSegment({ id: 'x', kind }, D);
    expect(px('band').px).toBe(16);
    expect(px('band').pixel.form).toBe('ring');
    expect(px('helix').px).toBe(12);
    expect(px('helix').pixel.form).toBe('pcb');
    expect(px('ring').pixel.form).toBe('node');
    expect(px('ring').px % 8).toBe(0);
    expect(px('lattice').pixel.form).toBe('strip');
    expect(px('lattice').px).toBe(4 * 5);
    expect(px('louver').pixel.form).toBe('pcb');
    expect(px('louver').px % 4).toBe(0);
    expect(px('louver').px).toBeGreaterThanOrEqual(8);
    // Ring band follows the ring PCB param.
    expect(planSegment({ id: 'x', kind: 'band' }, csDims(csParams({ ringPixel: 'ring-24-ws2812b' }))).px).toBe(24);
  });

  it('caps node rings at what fits inside the column', () => {
    const narrow = csDims(csParams({ dia: 80 }));
    const warns: string[] = [];
    const s = planSegment({ id: 'x', kind: 'ring', n: 16 }, narrow, (w) => warns.push(w));
    expect(s.n).toBe(maxNodesPerRing(narrow));
    expect(s.n).toBeLessThan(16);
    expect(warns.length).toBe(1);
  });

  it('keeps every segment within the A1 mini and dedupes identical ones', () => {
    const mini = csDims(csParams({ printer: 'bambu-a1mini' }));
    for (const kind of ['helix', 'band', 'lattice', 'louver', 'ring'] as SegKind[]) expect(planSegment({ id: 'x', kind, h: 500 }, mini).h + mini.J).toBeLessThanOrEqual(mini.bed.z);
    const plan = planColumns(PRESETS[0].make(), P);
    const keys = plan.stacks[0].segs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length - 1); // two identical ring bands
  });
});

describe('M6 Column Stack: design', () => {
  it('parses defensively and round-trips the presets', () => {
    for (const p of PRESETS) {
      const d = p.make();
      expect(parseDesign(JSON.stringify(d))).toEqual(d);
    }
    expect(parseDesign('{nope')).toEqual({ name: 'Untitled', stacks: [] });
    const bad = parseDesign(JSON.stringify({ stacks: [{ pos: [0, 0], segments: [] }, { pos: [1, 2, 3], mount: 'x', segments: [{ kind: 'zz' }, { kind: 'band' }, { id: 'S01', kind: 'ring' }, { id: 'S01', kind: 'helix' }], cap: 'q' }] }));
    expect(bad.stacks).toHaveLength(1);
    expect(bad.stacks[0].mount).toBe('floor');
    expect(bad.stacks[0].cap).toBe('dome');
    expect(bad.stacks[0].segments.map((s) => s.kind)).toEqual(['band', 'ring', 'helix']);
    expect(new Set(bad.stacks[0].segments.map((s) => s.id)).size).toBe(3);
  });

  it('removes stacks and segments', () => {
    const d = PRESETS[0].make();
    const seg = d.stacks[0].segments[2];
    const r1 = columnStackCore.remove!(d, { kind: 'segment', id: seg.id });
    expect(r1.stacks[0].segments).toHaveLength(d.stacks[0].segments.length - 1);
    expect(r1.stacks[0].segments.some((s) => s.id === seg.id)).toBe(false);
    expect(columnStackCore.remove!(d, { kind: 'stack', id: d.stacks[0].id }).stacks).toHaveLength(0);
  });
});

describe('M6 Column Stack: build', () => {
  it('builds the first preset manifold, with pixels and one schedule line per lit unit', async () => {
    const wasm = await loadManifold();
    const d = PRESETS[0].make();
    const out = inArena(wasm, () => {
      const o = columnStack.build(makeCtx(wasm), resolveParams(columnStack, { design: JSON.stringify(d) }));
      return { px: o.pixels.length, schedule: o.schedule, parts: o.parts.map((p) => ({ ok: p.solid.status() === 'NoError', vol: p.solid.volume(), n: p.instances.length })) };
    });
    expect(out.px).toBeGreaterThan(0);
    for (const p of out.parts) {
      expect(p.ok).toBe(true);
      expect(p.vol).toBeGreaterThan(1);
    }
    expect(out.schedule.map((s) => s.unit)).toEqual(['C1-S01', 'C1-S02', 'C1-S03', 'C1-S04', 'C1-S05', 'C1-S06', 'C1-CAP']);
    expect(out.schedule.map((s) => s.pixelId)).toEqual(['pcb-9-ws2812b', 'ring-16-ws2812b', 'strip-60-ws2812b', 'pcb-9-ws2812b', 'node-12-bullet', 'ring-16-ws2812b', 'jewel-7-ws2812b']);
    expect(out.schedule.reduce((a, s) => a + s.px, 0)).toBe(out.px);
    // Two identical ring bands print as one part ×2.
    expect(out.parts.some((p) => p.n === 2)).toBe(true);
  });
});
