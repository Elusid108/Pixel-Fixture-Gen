import { describe, expect, it } from 'vitest';
import { loadManifold, inArena, makeCtx } from '../src/geom/manifold';
import { resolveParams } from '../src/fixtures/util';
import { dist, norm, sub } from '../src/geom/vec';
import { planeXY, planeXZ, type SketchPath } from '../src/sketch/types';
import type { Params, Vec3 } from '../src/types';
import { linea } from '../src/modules/linea/build';
import { moveVertex, relockRun } from '../src/modules/linea/lock';
import { emptyDesign, type LineaDesign } from '../src/modules/linea/model';
import { bedAngle, jointArm, linDims, lineaParams, maxBarLength } from '../src/modules/linea/params';
import { edgePixels, planLinea, splitSpan } from '../src/modules/linea/plan';
import { lineaCore } from '../src/modules/linea/system';

const P = (given: Params = {}) => lineaParams(given);
const path = (pts: Vec3[], closed = false, plane = planeXY(0)): SketchPath => ({ id: 'p', pts, closed, plane });
const draw = (paths: SketchPath[], params: Params = {}, d: LineaDesign = emptyDesign()) => lineaCore.fromPaths!(paths, d, P(params));

/** Every straight a whole number of pitches, and the straights fill each span exactly. */
function expectPitchLocked(d: LineaDesign, params: Params = {}) {
  const plan = planLinea(d, P(params));
  const p = plan.D.pitch;
  for (const e of plan.edges) {
    for (const c of e.straights) {
      const L = c * p;
      expect(Math.abs(L / p - Math.round(L / p))).toBeLessThan(1e-6);
    }
    const filled = e.straights.reduce((s, c) => s + c * p, 0);
    expect(Math.abs(e.length - e.armA - e.armB - filled)).toBeLessThan(1e-6);
  }
  return plan;
}

describe('M2 Linea: sketch adapter', () => {
  it('M2 Linea: L path gives one exact 90° corner and pitch-locked straights', () => {
    const d = draw([path([
      [0, 0, 0],
      [300, 0, 0],
      [300, 200, 0],
    ])]);
    expect(d.runs).toHaveLength(1);
    const plan = expectPitchLocked(d);
    const corners = plan.nodes.filter((n) => n.kind === 'corner');
    expect(corners).toHaveLength(1);
    expect(Math.abs(corners[0].angle! - 90)).toBeLessThan(1e-9);
    expect(corners[0].nearest).toBe(90);
    // The lock moved vertices along their segments only: directions are exactly as drawn.
    const [a, b, c] = d.runs[0].pts;
    expect(norm(sub(b, a))).toEqual([1, 0, 0]);
    expect(norm(sub(c, b))).toEqual([0, 1, 0]);
    // Locked runs leave nothing for rigid joints to absorb: corner arms are symmetric.
    const D = linDims(P());
    expect(corners[0].arms.map((x) => x.len)).toEqual([jointArm(D, 90), jointArm(D, 90)]);
    for (const e of plan.edges) {
      const straight = e.length - e.armA - e.armB;
      expect(Math.abs(straight / D.pitch - Math.round(straight / D.pitch))).toBeLessThan(1e-6);
    }
    // Light faces the plane normal: up on the floor.
    expect(d.runs[0].face).toEqual([0, 0, 1]);
  });

  it('keeps any drawn angle exactly (no snapping) and reports the nearest catalogue angle', () => {
    const t = (100 * Math.PI) / 180;
    const d = draw([path([
      [0, 0, 0],
      [250, 0, 0],
      [250 + 200 * Math.cos(Math.PI - t), 200 * Math.sin(Math.PI - t), 0],
    ])]);
    const plan = expectPitchLocked(d);
    const c = plan.nodes.find((n) => n.kind === 'corner')!;
    expect(c.angle!).toBeCloseTo(100, 9);
    expect(c.nearest).toBe(90);
  });

  it('a path ending on another run makes a T, sliding along its own direction', () => {
    const wall = planeXZ(0);
    const host = draw([path([[-300, 0, 100], [300, 0, 100]], false, wall)]);
    const d = draw([path([[-40, 0, 300], [-40, 0, 104]], false, wall)], {}, host);
    expect(d.runs).toHaveLength(2);
    const branch = d.runs[1];
    // Landed exactly on the host line, still vertical.
    expect(branch.pts[1][2]).toBeCloseTo(100, 9);
    expect(branch.pts[1][0]).toBeCloseTo(-40, 9);
    expect(branch.face).toEqual([0, -1, 0]);
    const plan = expectPitchLocked(d);
    const tees = plan.nodes.filter((n) => n.kind === 'tee');
    expect(tees).toHaveLength(1);
    expect([...tees[0].gaps].sort((x, y) => x - y).map((g) => Math.round(g * 1e6) / 1e6)).toEqual([90, 90, 180]);
    expect(plan.edges).toHaveLength(3);
  });

  it('two runs crossing make an X', () => {
    const d = draw([path([[-200, 0, 0], [200, 0, 0]]), path([[0, -200, 0], [0, 200, 0]])]);
    const plan = expectPitchLocked(d);
    expect(plan.nodes.filter((n) => n.kind === 'cross')).toHaveLength(1);
    expect(plan.nodes.filter((n) => n.kind === 'end')).toHaveLength(4);
    expect(plan.edges).toHaveLength(4);
  });

  it('closed regular polygons lock by uniform scale: exact angles, one corner part (plus the feed corner)', () => {
    const pts: Vec3[] = Array.from({ length: 6 }, (_, i) => [190 * Math.cos((i * Math.PI) / 3), 190 * Math.sin((i * Math.PI) / 3), 0]);
    const d = draw([path(pts, true)]);
    expect(d.runs[0].closed).toBe(true);
    const plan = expectPitchLocked(d);
    const corners = plan.nodes.filter((n) => n.kind === 'corner');
    expect(corners).toHaveLength(6);
    for (const c of corners) expect(c.angle!).toBeCloseTo(120, 9);
    expect(plan.classes.map((c) => c.members.length).sort()).toEqual([1, 5]);
    expect(plan.nodes.find((n) => n.feed)!.classId).not.toBe(plan.nodes.find((n) => !n.feed)!.classId);
  });

  it('simplifies sampled curves into chords long enough for a straight', () => {
    const arc: Vec3[] = Array.from({ length: 60 }, (_, i) => [300 * Math.cos((i / 59) * Math.PI), 300 * Math.sin((i / 59) * Math.PI), 0]);
    const d = draw([path(arc)]);
    const plan = expectPitchLocked(d);
    expect(d.runs[0].pts.length).toBeLessThan(20);
    expect(plan.edges.every((e) => e.k >= 1)).toBe(true);
  });

  it('merges into an existing design instead of replacing it', () => {
    const one = draw([path([[0, 0, 0], [200, 0, 0]])]);
    const two = draw([path([[0, 100, 0], [200, 100, 0]])], {}, one);
    expect(two.runs.map((r) => r.id)).toEqual(['R01', 'R02']);
    expect(two.runs[0]).toEqual(one.runs[0]);
  });
});

describe('M2 Linea: plan', () => {
  it('splits long spans into few, equal catalogue straights', () => {
    expect(splitSpan(18, [6, 9, 12, 15])).toEqual([9, 9]);
    expect(splitSpan(30, [6, 9, 12, 15])).toEqual([15, 15]);
    expect(splitSpan(4, [6, 9, 12, 15])).toEqual([4]);
    expect(splitSpan(16, [6, 9, 12, 15]).reduce((s, c) => s + c, 0)).toBe(16);
  });

  it('caps straights to what fits the bed, diagonally if needed', () => {
    const big = linDims(P({ printer: 'bambu-256' }));
    const mini = linDims(P({ printer: 'bambu-a1mini' }));
    expect(big.maxCount * big.pitch).toBeGreaterThan(248); // 250 mm only fits laid diagonally
    expect(bedAngle(big.bed, big.maxCount * big.pitch, big.W + 1)).toBeGreaterThan(0);
    expect(mini.maxCount * mini.pitch).toBeLessThanOrEqual(maxBarLength(mini.bed, mini.W));
    const d = lineaCore.presets[0].make();
    for (const e of planLinea(d, P({ printer: 'bambu-a1mini' })).edges) for (const c of e.straights) expect(c).toBeLessThanOrEqual(mini.maxCount);
  });

  it('orders data along runs from the feed, every lit bar once, pixels a pitch apart', () => {
    const d = lineaCore.presets[0].make();
    const plan = planLinea(d, P());
    const lit = plan.chain.lit.map((r) => r.strut).sort();
    expect(lit).toEqual(plan.edges.filter((e) => e.k).map((e) => e.id).sort());
    expect(plan.chain.steps[0].from).toBe(plan.feedNode);
    expect(plan.nodes.find((n) => n.id === plan.feedNode)!.kind).toBe('end');
    for (const r of plan.chain.lit) {
      const e = plan.edges.find((x) => x.id === r.strut)!;
      const px = edgePixels(plan, e, r.from);
      expect(px).toHaveLength(e.k);
      for (let i = 1; i < px.length; i++) expect(dist(px[i], px[i - 1])).toBeCloseTo(plan.D.pitch, 9);
    }
    // The T branch costs one return run back to the main line.
    expect(plan.chain.jumps).toBe(0);
  });

  it('the window preset has four corners, four T joints and an X', () => {
    const plan = planLinea(lineaCore.presets.find((p) => p.id === 'window')!.make(), P());
    expect(plan.stats.corners.reduce((s, c) => s + c.n, 0)).toBe(4);
    expect(plan.stats.tees).toBe(4);
    expect(plan.stats.crosses).toBe(1);
    expect(plan.warnings.filter((w) => w.includes('too short'))).toEqual([]);
  });

  it('re-locks a dragged vertex so both of its segments stay whole pixels', () => {
    const d = draw([path([[0, 0, 0], [300, 0, 0], [300, 200, 0]])]);
    const moved = moveVertex(d, 'R01', 1, [287, 13, 0], P());
    const plan = expectPitchLocked(moved);
    const corner = plan.nodes.find((n) => n.kind === 'corner')!;
    // Only the dragged vertex moved, close to where it was dropped.
    expect(moved.runs[0].pts[0]).toEqual(d.runs[0].pts[0]);
    expect(moved.runs[0].pts[2]).toEqual(d.runs[0].pts[2]);
    expect(dist(moved.runs[0].pts[1], [287, 13, 0])).toBeLessThan(plan.D.pitch);
    expect(corner.arms[0].len).toBeCloseTo(corner.arms[1].len, 9);
  });
});

describe('M2 Linea: pixel change', () => {
  it('a run locked for one pitch still plans whole pixels at another, and re-locks exactly', () => {
    const d = draw([path([[0, 0, 0], [400, 0, 0], [400, 250, 0], [100, 250, 0]])]);
    const p30 = { pixel: 'strip-30-ws2812b' };
    expectPitchLocked(d, p30);
    const re = relockRun(d, 'R01', P(p30));
    const plan = expectPitchLocked(re, p30);
    for (const n of plan.nodes.filter((x) => x.kind === 'corner')) expect(n.arms[0].len).toBeCloseTo(n.arms[1].len, 9);
    for (const n of plan.nodes.filter((x) => x.kind === 'corner')) expect(n.angle!).toBeCloseTo(90, 9);
  });
});

describe('M2 Linea: design', () => {
  it('parses presets round-trip and survives garbage', () => {
    for (const p of lineaCore.presets) {
      const d = p.make();
      expect(lineaCore.parse(JSON.stringify(d))).toEqual(d);
    }
    expect(lineaCore.parse('{nope')).toEqual(emptyDesign());
    expect(lineaCore.parse(JSON.stringify({ runs: [{ id: 'R01', pts: [[0, 0, 0]] }, { id: 'R02', pts: [[0, 0, 0], [1, 'x', 2], [100, 0, 0]] }] })).runs).toHaveLength(1);
  });

  it('removes bars (splitting the run), joints and runs', () => {
    const d = draw([path([[0, 0, 0], [300, 0, 0], [300, 200, 0], [0, 200, 0]])]);
    const plan = planLinea(d, P());
    const mid = plan.edges.find((e) => e.seg === 1)!;
    const cut = lineaCore.remove!(d, { kind: 'bar', id: mid.id });
    expect(cut.runs).toHaveLength(2);
    const corner = plan.nodes.find((n) => n.kind === 'corner')!;
    expect(lineaCore.remove!(d, { kind: 'joint', id: corner.id }).runs[0].pts).toHaveLength(3);
    expect(lineaCore.remove!(d, { kind: 'run', id: 'R01' }).runs).toHaveLength(0);
  });
});

describe('M2 Linea: build', () => {
  it('builds preset 0 into valid parts with pixels in data order', async () => {
    const wasm = await loadManifold();
    const d = lineaCore.presets[0].make();
    const params = resolveParams(linea, { design: JSON.stringify(d) });
    const out = inArena(wasm, () => {
      const o = linea.build(makeCtx(wasm), params);
      return {
        px: o.pixels.length,
        units: o.schedule.map((s) => s.unit),
        firstUnit: o.pixels[0]?.unit,
        parts: o.parts.map((p) => ({ ok: p.solid.status() === 'NoError', vol: p.solid.volume(), n: p.instances.length })),
      };
    });
    const plan = planLinea(d, params);
    expect(out.px).toBe(plan.stats.px);
    expect(out.units).toEqual(plan.chain.lit.map((r) => r.strut));
    expect(out.firstUnit).toBe(out.units[0]);
    for (const p of out.parts) {
      expect(p.ok).toBe(true);
      expect(p.vol).toBeGreaterThan(0.01);
      expect(p.n).toBeGreaterThan(0);
    }
  });
});
