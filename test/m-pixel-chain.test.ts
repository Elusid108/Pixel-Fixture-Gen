import { describe, expect, it } from 'vitest';
import { resolveParams } from '../src/fixtures/util';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { add, dist, scale } from '../src/geom/vec';
import { planeXY, planeXZ, type SketchPath } from '../src/sketch/types';
import type { Vec3 } from '../src/types';
import { pixelChain } from '../src/modules/pixel-chain/build';
import { catenaryBySag, catenaryForLinks, pointAtArc, sagOf } from '../src/modules/pixel-chain/catenary';
import { emptyDesign, parseDesign, removeFromDesign, type PcDesign } from '../src/modules/pixel-chain/model';
import { layoutLinks, planChain } from '../src/modules/pixel-chain/plan';
import { FLOOR_CLEAR, HANG_Z, PC_PRESETS, garlandsFromPaths, pixelChainCore } from '../src/modules/pixel-chain/system';

const path = (pts: Vec3[], plane = planeXY(0), closed = false): SketchPath => ({ id: 'P1', pts, closed, plane, source: 'draw' });
const LEAD = 100;

describe('M7 Pixel Chain: sketch adapter', () => {
  it('M7 Pixel Chain: drawn path gives links within lead length', () => {
    const drawn = path([
      [-400, 0, 0],
      [-130, 150, 0],
      [130, -150, 0],
      [400, 0, 0],
    ]);
    const d = garlandsFromPaths([drawn], emptyDesign(), {});
    expect(d.garlands).toHaveLength(1);
    expect(d.garlands[0].anchors).toHaveLength(4);

    const links = layoutLinks(d, {});
    const plan = planChain(d, {});
    const gp = plan.garlands[0];
    expect(links.length).toBeGreaterThan(8);
    // Every node-to-node distance fits the strand's lead, with the slack kept back.
    for (let i = 1; i < links.length; i++) {
      const c = dist(links[i - 1].pos, links[i].pos);
      expect(c).toBeLessThanOrEqual(LEAD);
      expect(c).toBeLessThanOrEqual(gp.pitch + 1e-6);
    }
    // Link count follows the chain's length: one link per pitch along the pin line.
    expect(Math.abs(gp.arc / gp.pitch - (links.length - 1))).toBeLessThan(0.05 * links.length);
    const along = links.slice(1).reduce((s, l, i) => s + dist(links[i].pos, l.pos), 0);
    expect(along / gp.pitch).toBeGreaterThan((links.length - 1) * 0.9);
    expect(along / gp.pitch).toBeLessThanOrEqual(links.length - 1 + 1e-6);
  });

  it('simplifies a freehand stroke to its corners and hangs a floor drawing at hang height', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= 40; i++) pts.push([i * 10, (i % 2) * 0.8, 0]);
    for (let i = 1; i <= 40; i++) pts.push([400 + (i % 2) * 0.8, i * 10, 0]);
    const d = garlandsFromPaths([path(pts)], emptyDesign(), {});
    const a = d.garlands[0].anchors;
    expect(a).toHaveLength(3);
    expect(dist(a[1], [400, 0, HANG_Z])).toBeLessThan(3);
    expect(a.every((p) => p[2] === HANG_Z)).toBe(true);
  });

  it('keeps Z for a vertical drawing, lifts deep drapes off the floor and appends', () => {
    const start = PC_PRESETS[0].make();
    const d = garlandsFromPaths(
      [
        path(
          [
            [0, 0, 300],
            [300, 0, 300],
          ],
          planeXZ(0),
        ),
      ],
      start,
      {},
    );
    expect(d.garlands).toHaveLength(2);
    expect(d.garlands[1].id).toBe('G02');
    expect(d.garlands[1].anchors[0][2]).toBe(300);
    // A low, deep drape gets lifted until its lowest bead clears the floor.
    const low = garlandsFromPaths(
      [
        path(
          [
            [0, 0, 60],
            [800, 0, 60],
          ],
          planeXY(60),
        ),
      ],
      emptyDesign(),
      {},
    );
    expect(planChain(low, {}).garlands[0].minZ).toBeGreaterThanOrEqual(FLOOR_CLEAR - 1e-6);
  });

  it('turns closed paths into rings', () => {
    const ring = path(
      [
        [0, 0, 0],
        [400, 0, 0],
        [400, 400, 0],
        [0, 400, 0],
      ],
      planeXY(0),
      true,
    );
    const d = garlandsFromPaths([ring], emptyDesign(), {});
    expect(d.garlands[0].closed).toBe(true);
    expect(d.garlands[0].sags).toHaveLength(4);
    const gp = planChain(d, {}).garlands[0];
    expect(gp.turns.every((t) => t.yawQ === 90)).toBe(true);
    expect(dist(gp.links[gp.links.length - 1].pos, gp.links[0].pos)).toBeLessThanOrEqual(LEAD);
  });
});

describe('M7 Pixel Chain: catenary', () => {
  it('hits the sag asked for, with uneven anchors too', () => {
    for (const dv of [0, 150, -220]) {
      const c = catenaryBySag(600, dv, 90);
      expect(sagOf(c)).toBeCloseTo(90, 3);
      const end = pointAtArc(c, c.length);
      expect(end[0]).toBeCloseTo(600, 3);
      expect(end[1]).toBeCloseTo(dv, 3);
    }
  });

  it('places rigid links: every chord is exactly the pitch and the last joint lands on the end', () => {
    const { c, joints } = catenaryForLinks(500, 80, 9, 70);
    for (let j = 1; j < joints.length; j++) {
      const [x0, z0] = pointAtArc(c, joints[j - 1]);
      const [x1, z1] = pointAtArc(c, joints[j]);
      expect(Math.hypot(x1 - x0, z1 - z0)).toBeCloseTo(70, 4);
    }
    const [xe, ze] = pointAtArc(c, joints[joints.length - 1]);
    expect(xe).toBeCloseTo(500, 2);
    expect(ze).toBeCloseTo(80, 2);
  });

  it('pins line up: each knuckle pin is the next clevis pin', () => {
    const gp = planChain(PC_PRESETS[2].make(), {}).garlands[0];
    const P = gp.pitch / 2;
    for (let i = 1; i < gp.links.length; i++) {
      const a = gp.links[i - 1];
      const b = gp.links[i];
      const knuckle = a.kind === 'anchor' ? add(a.pos, scale(rot(a.x, a.yaw), P)) : add(a.pos, scale(a.x, P));
      const clevis = add(b.pos, scale(b.x, -P));
      expect(dist(knuckle, clevis)).toBeLessThan(0.05);
    }
  });
});

function rot(v: Vec3, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t), v[2]];
}

describe('M7 Pixel Chain: limits and warnings', () => {
  it('caps the pitch at lead length minus slack and says so', () => {
    const d = PC_PRESETS[0].make();
    const plan = planChain(d, { pitch: 100, slack: 12 });
    expect(plan.garlands[0].pitch).toBe(88);
    expect(plan.maxChord).toBeLessThanOrEqual(88 + 1e-6);
    expect(plan.warnings.some((w) => w.includes('longer than the 100 mm lead'))).toBe(true);
    // A garland's own pitch is capped the same way.
    const own: PcDesign = { ...d, garlands: [{ ...d.garlands[0], pitch: 120 }] };
    expect(planChain(own, {}).garlands[0].pitch).toBe(88);
  });

  it('raises a pitch so short the beads would touch', () => {
    const plan = planChain(PC_PRESETS[0].make(), { pitch: 40, beadD: 50 });
    expect(plan.garlands[0].pitch).toBeGreaterThan(50);
    expect(plan.warnings.some((w) => w.includes('touch'))).toBe(true);
  });

  it('warns where to splice when one strand is not enough', () => {
    const long: PcDesign = {
      name: 'long',
      garlands: [{ id: 'G01', anchors: Array.from({ length: 9 }, (_, i) => [i * 500, 0, 900] as Vec3), sags: Array(8).fill(20) }],
    };
    const plan = planChain(long, {});
    expect(plan.px).toBeGreaterThan(50);
    expect(plan.strands).toBe(Math.ceil(plan.px / 50));
    expect(plan.splices[0]).toMatchObject({ strand: 2, gid: 'G01', link: 51 });
    expect(plan.warnings.some((w) => w.includes('Splice at G01 link 51'))).toBe(true);
  });

  it('flags bends past the hinge range', () => {
    const plan = planChain(PC_PRESETS[1].make(), { shape: 'bell', beadD: 56 });
    expect(plan.garlands[0].hinge.down).toBeLessThan(60);
    expect(plan.garlands[0].worst?.ok).toBe(false);
    expect(plan.warnings.some((w) => w.includes('hinges allow'))).toBe(true);
  });

  it('reverses data order and chains garlands in order', () => {
    const d = PC_PRESETS[0].make();
    const two: PcDesign = { ...d, garlands: [d.garlands[0], { ...d.garlands[0], id: 'G02', anchors: d.garlands[0].anchors.map((a) => [a[0], 600, a[2]] as Vec3), reverse: true }] };
    const plan = planChain(two, {});
    const g2 = plan.garlands[1];
    expect(g2.order[0]).toBe(g2.links[g2.links.length - 1]);
    expect(plan.order[plan.garlands[0].order.length]).toBe(g2.order[0]);
    expect(plan.jumps).toHaveLength(1);
  });
});

describe('M7 Pixel Chain: design', () => {
  it('round-trips every preset and survives junk', () => {
    for (const p of PC_PRESETS) expect(parseDesign(JSON.stringify(p.make()))).toEqual(p.make());
    expect(parseDesign('{nope')).toEqual(emptyDesign());
    const fixed = parseDesign(JSON.stringify({ name: 3, garlands: [{ id: 'G01', anchors: [[0, 0, 500], [400, 0, 500], 'x'], sags: [] }, { id: 'G01', anchors: [] }, null] }));
    expect(fixed.name).toBe('Untitled');
    expect(fixed.garlands).toHaveLength(1);
    expect(fixed.garlands[0].sags).toHaveLength(1);
  });

  it('removes anchors (merging spans) and garlands', () => {
    const d = PC_PRESETS[0].make();
    d.garlands[0].sags = [10, 20, 30];
    const one = removeFromDesign(d, { kind: 'anchor', id: 'G01:1' });
    expect(one.garlands[0].anchors).toHaveLength(3);
    expect(one.garlands[0].sags).toEqual([10, 30]);
    const two = removeFromDesign(removeFromDesign(one, { kind: 'anchor', id: 'G01:0' }), { kind: 'anchor', id: 'G01:0' });
    expect(two.garlands).toHaveLength(0);
    expect(pixelChainCore.remove!(d, { kind: 'garland', id: 'G01' }).garlands).toHaveLength(0);
  });

  it('frames the design with room to spare', () => {
    const f = pixelChainCore.frame(PC_PRESETS[0].make());
    expect(f.radius).toBeGreaterThan(800);
    expect(f.center[2]).toBeGreaterThan(500);
  });
});

describe('M7 Pixel Chain: build', () => {
  it('builds the first preset: manifold links, deduped, pixels in data order', async () => {
    const wasm = await loadManifold();
    const d = PC_PRESETS[0].make();
    const plan = planChain(d, {});
    const out = inArena(wasm, () => {
      const o = pixelChain.build(makeCtx(wasm), resolveParams(pixelChain, { design: JSON.stringify(d) }));
      return {
        px: o.pixels.length,
        first: o.pixels[0].pos,
        schedule: o.schedule.map((s) => s.px),
        parts: o.parts.map((p) => ({ ok: p.solid.status() === 'NoError', vol: p.solid.volume(), n: p.instances.length, z: p.solid.boundingBox().min[2] })),
        hardware: o.hardware.map((h) => h.item),
      };
    });
    expect(out.px).toBe(plan.px);
    expect(out.first).toEqual(plan.order[0].pos);
    expect(out.schedule).toEqual([plan.px]);
    expect(out.parts).toHaveLength(2);
    for (const p of out.parts) {
      expect(p.ok).toBe(true);
      expect(p.vol).toBeGreaterThan(100);
      expect(p.z).toBeCloseTo(0, 6);
    }
    expect(out.parts.reduce((s, p) => s + p.n, 0)).toBe(plan.px);
    expect(out.hardware.some((h) => h.includes('filament pin'))).toBe(true);
  });
});
