import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/runBuild';
import { packPlates } from '../src/export/plates';
import { declaresFit } from '../src/fit';
import { couponGaps, FIT_COUPON } from '../src/fixtures/fit-coupon';
import { getFixture } from '../src/fixtures/registry';
import { resolveParams } from '../src/fixtures/util';
import { Geo } from '../src/geom/geo';
import { inArena, loadManifold, makeCtx } from '../src/geom/manifold';
import { dovetailSlotHalf, splitToBed } from '../src/geom/split';
import { getPrinter } from '../src/printers';
import type { FixtureOutput, Params, Vec3 } from '../src/types';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

/** Every catalogue fixture this audit covers (L1 Orb has its own builder). */
const CATALOGUE = ['swatchbook', 'fresnel', 'leko-jr', 'scrim-box', 'litho-relight', 'louver-sconce', 'moire-lantern', 'contour', 'cascade', 'gasolier', 'armillary', 'bloom', 'helix', 'hive', 'fit-coupon', 'fit-gap-coupon'];

/** Build a fixture and hand its live solids to `fn` (freed when it returns). */
function withBuild<T>(id: string, given: Params, fn: (out: FixtureOutput, g: Geo) => T): T {
  return inArena(wasm, () => {
    const def = getFixture(id);
    const ctx = makeCtx(wasm);
    return fn(def.build(ctx, resolveParams(def, given)), new Geo(ctx));
  });
}

/** One printed copy of a part, in its assembled pose. */
function placed(out: FixtureOutput, id: string, i = 0): Manifold {
  const p = out.parts.find((q) => q.id === id);
  if (!p) throw new Error(`no part ${id}`);
  return p.solid.transform(p.instances[i] as unknown as Parameters<Manifold['transform']>[0]);
}

const size = (m: Manifold, axis: 0 | 1 | 2): number => {
  const b = m.boundingBox();
  return b.max[axis] - b.min[axis];
};
/** Extent of a part's material inside a probe box. */
const solidIn = (g: Geo, m: Manifold, lo: Vec3, hi: Vec3, axis: 0 | 1 | 2) => size(g.box(lo, hi).intersect(m), axis);
/** Extent of the empty space a part leaves inside a probe box (a hole, slot or groove). The box must sit inside the part's material apart from that feature. */
const voidIn = (g: Geo, m: Manifold, lo: Vec3, hi: Vec3, axis: 0 | 1 | 2) => size(g.box(lo, hi).subtract(m), axis);
/** A thin probe through (cx, cy) along X or Y, `half` either side, between z0 and z1. */
const slab = (cx: number, cy: number, axis: 0 | 1, half: number, z0: number, z1: number): [Vec3, Vec3] =>
  axis === 0 ? [[cx - half, cy - 0.01, z0], [cx + half, cy + 0.01, z1]] : [[cx - 0.01, cy - half, z0], [cx + 0.01, cy + half, z1]];

describe('fit across the catalogue', () => {
  it('every fixture takes the shared fit params, has no private clearance param, and lists its build in order', () => {
    for (const id of CATALOGUE) {
      const def = getFixture(id);
      expect(declaresFit(def), id).toBe(true);
      expect(
        def.params.filter((p) => ['tol', 'clearance', 'clr'].includes(p.key)).map((p) => p.key),
        id,
      ).toEqual([]);
      const r = runBuild(wasm, id);
      expect(r.errors, id).toEqual([]);
      expect(r.assembly.length, id).toBeGreaterThanOrEqual(2);
      // Steps name real parts (split pieces count as their part).
      const ids = new Set(r.parts.map((p) => p.id));
      for (const st of r.assembly) {
        expect(st.title.length, `${id} title`).toBeGreaterThan(0);
        for (const pid of st.parts ?? []) expect(ids.has(pid), `${id}: step "${st.title}" names ${pid}`).toBe(true);
      }
    }
  });

  it.each(CATALOGUE)('%s: assembled parts do not fuse at the default 0.4 mm gap', (id) => {
    withBuild(id, {}, (out) => {
      const copies: { name: string; m: Manifold; b: ReturnType<Manifold['boundingBox']> }[] = [];
      for (const p of out.parts)
        p.instances.forEach((_, i) => {
          const m = placed(out, p.id, i);
          copies.push({ name: `${p.id}#${i}`, m, b: m.boundingBox() });
        });
      const hits: string[] = [];
      for (let i = 0; i < copies.length; i++)
        for (let j = i + 1; j < copies.length; j++) {
          const [a, b] = [copies[i].b, copies[j].b];
          if ([0, 1, 2].some((k) => a.max[k] < b.min[k] || b.max[k] < a.min[k])) continue;
          const v = copies[i].m.intersect(copies[j].m).volume();
          // Butt seams between auto-split pieces can carry a few µm of float noise; anything that
          // fuses is orders of magnitude more.
          if (v > 0.25) hits.push(`${copies[i].name} × ${copies[j].name}: ${v.toFixed(2)} mm³`);
        }
      expect(hits).toEqual([]);
    });
  }, 120_000);
});

describe('female = male + fit', () => {
  const FITS = [0.2, 0.6];

  it('S1: the cap bore and the leaf pivot clear the post by the fit gap', () => {
    const gaps = FITS.map((fit) =>
      withBuild('swatchbook', { fit, numbers: false }, (out, g) => {
        const base = placed(out, 'base');
        const cap = placed(out, 'cap');
        const cz = cap.boundingBox().min[2];
        const post = solidIn(g, base, ...slab(0, 0, 1, 20, cz + 1, cz + 1.5), 1);
        const bore = voidIn(g, cap, ...slab(0, 0, 1, 9, cz + 1, cz + 1.5), 1);
        const leaf = out.parts.find((p) => p.id === 'leaf')!.solid; // print pose: pivot on the origin
        const pivot = voidIn(g, leaf, ...slab(0, 0, 1, 15, 0.5, 1), 1);
        return { bore: bore - post, pivot: pivot - post };
      }),
    );
    gaps.forEach((gp, i) => {
      expect(gp.bore).toBeCloseTo(FITS[i], 2);
      expect(gp.pivot).toBeCloseTo(FITS[i], 2);
    });
  });

  it('S4: scrim panels sit in grooves one fit gap wider than the panel', () => {
    const gaps = FITS.map((fit) =>
      withBuild('scrim-box', { fit }, (out, g) => {
        const layer = placed(out, 'layer-1');
        const b = layer.boundingBox();
        const yc = (b.min[1] + b.max[1]) / 2;
        const groove = voidIn(g, placed(out, 'shell'), [-5, yc - 4, b.min[2] + 0.2], [5, yc + 4, b.min[2] + 0.6], 1);
        return groove - size(layer, 1);
      }),
    );
    gaps.forEach((gp, i) => expect(gp).toBeCloseTo(FITS[i], 3));
  });

  it('S7: shell grooves in the base are the wall plus the fit gap', () => {
    const gaps = FITS.map((fit) =>
      withBuild('moire-lantern', { fit }, (out, g) => {
        const shell = placed(out, 'outer');
        const z0 = shell.boundingBox().min[2];
        // Outer shell: 73–75 mm, base Ø158. Probe inside the base, across the groove.
        const wall = solidIn(g, shell, [40, -0.01, z0 + 0.5], [90, 0.01, z0 + 1.5], 0);
        const groove = voidIn(g, placed(out, 'base'), [70, -0.01, z0 + 0.5], [78, 0.01, z0 + 1.5], 0);
        return groove - wall;
      }),
    );
    gaps.forEach((gp, i) => expect(gp).toBeCloseTo(FITS[i], 2));
  });

  it('M1: carrier and baffle drop into the shell well with the fit gap; the bowtie key is the pockets less the gap', () => {
    const res = FITS.map((fit) =>
      withBuild('hive', { fit }, (out, g) => {
        const carrier = placed(out, 'carrier');
        const shell = placed(out, 'shell');
        const z = carrier.boundingBox().min[2];
        const A = size(shell, 1) / 2; // outer apothem
        const well = voidIn(g, shell, ...slab(0, 0, 1, A - 1, z + 0.5, z + 1), 1);
        const key = out.parts.find((p) => p.id === 'bowtie')!.solid;
        return { carrier: well - size(carrier, 1), baffle: well - size(placed(out, 'baffle'), 1), keyLen: size(key, 1), keyT: size(key, 2) };
      }),
    );
    res.forEach((r, i) => {
      expect(r.carrier).toBeCloseTo(FITS[i], 3);
      expect(r.baffle).toBeCloseTo(FITS[i], 3);
      // Two 10 mm half-pockets, half a gap off each end; 2 mm deep, half a gap short.
      expect(r.keyLen).toBeCloseTo(20 - FITS[i], 3);
      expect(r.keyT).toBeCloseTo(2 - FITS[i] / 2, 3);
    });
  });

  it('L3: the candle cup socket is the arm end plus the fit gap both ways', () => {
    const res = FITS.map((fit) =>
      withBuild('gasolier', { fit, autosplit: false }, (out, g) => {
        const cup = placed(out, 'cup');
        const cb = cup.boundingBox();
        const cx = (cb.min[0] + cb.max[0]) / 2;
        const cy = (cb.min[1] + cb.max[1]) / 2;
        const arm = placed(out, 'arm');
        // Cup wall is Ø26 here: probe ±10 across the socket, radially (x) and tangentially (y).
        return ([0, 1] as const).map((ax) => {
          const [lo, hi] = slab(cx, cy, ax, 10, cb.min[2] + 3, cb.min[2] + 4);
          return voidIn(g, cup, lo, hi, ax) - solidIn(g, arm, lo, hi, ax);
        });
      }),
    );
    res.forEach((r, i) => r.forEach((gp) => expect(gp).toBeCloseTo(FITS[i], 3)));
  });

  it('L2: hanger plugs clear the crown holes and the tube bore by the fit gap', () => {
    const res = FITS.map((fit) =>
      withBuild('cascade', { fit, autosplit: false, rows: '1', outer: 8 }, (out, g) => {
        const plug = placed(out, 'plug');
        const pb = plug.boundingBox();
        const cx = (pb.min[0] + pb.max[0]) / 2;
        const cy = (pb.min[1] + pb.max[1]) / 2;
        // Spigot just under the crown floor, inside the tube top.
        const z = pb.min[2] + 2;
        const spigot = solidIn(g, plug, ...slab(cx, cy, 0, 30, z, z + 0.5), 0);
        // The top tube segment under this plug: same axis, highest.
        let best: { id: string; i: number; top: number } | null = null;
        for (const p of out.parts.filter((q) => q.id.startsWith('tube-')))
          p.instances.forEach((M, i) => {
            if (Math.hypot(M[12] - cx, M[13] - cy) > 0.5) return;
            const top = placed(out, p.id, i).boundingBox().max[2];
            if (!best || top > best.top) best = { id: p.id, i, top };
          });
        const tube = placed(out, best!.id, best!.i);
        // Probe inside the 0.8 mm vase wall: half the outer diameter less 0.4.
        const bore = voidIn(g, tube, ...slab(cx, cy, 0, size(tube, 0) / 2 - 0.4, z, z + 0.5), 0);
        // And the crown floor hole the spigot passes through.
        const crown = placed(out, 'crown');
        const hole = voidIn(g, crown, ...slab(cx, cy, 0, 12, pb.max[2] - 4, pb.max[2] - 3.5), 0);
        return { tube: bore - spigot, hole: hole - spigot };
      }),
    );
    res.forEach((gp, i) => {
      expect(gp.tube).toBeCloseTo(FITS[i], 2);
      expect(gp.hole).toBeCloseTo(FITS[i], 2);
    });
  });
});

describe('auto-split joints take the fit gap', () => {
  it('cuts the dovetail slot half a gap off the key, square to the flank', () => {
    const [a, b, d] = [6, 10, 8];
    const phi = Math.atan((b - a) / (2 * d));
    for (const side of [0.1, 0.3]) {
      // Horizontal distance between key flank and slot flank at any depth, times cos φ = side.
      for (const w of [0, d / 2, d]) {
        const key = a / 2 + ((b - a) / 2) * (w / d);
        expect((dovetailSlotHalf(a, b, d, side, w) - key) * Math.cos(phi)).toBeCloseTo(side, 9);
      }
    }
  });

  it('opens up as the fit grows, and the pieces never overlap', () => {
    const lost = [0.2, 0.8].map((fit) =>
      inArena(wasm, () => {
        const g = new Geo(makeCtx(wasm));
        const bar = g.box([0, 0, 0], [600, 40, 20]);
        const r = splitToBed(g, bar, getPrinter('bambu-256'), { joint: 'dovetail', pins: false, fit });
        const pieces = r.parts.flatMap((p) => p.instances.map((M) => g.place(p.solid, M)));
        for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) expect(pieces[i].intersect(pieces[j]).volume()).toBeLessThan(0.05);
        return bar.volume() - pieces.reduce((s, p) => s + p.volume(), 0);
      }),
    );
    expect(lost[0]).toBeGreaterThan(0);
    // Three times the gap: roughly three times the clearance volume.
    expect(lost[1] / lost[0]).toBeGreaterThan(2.5);
    expect(lost[1] / lost[0]).toBeLessThan(4.5);
  });
});

describe('T1 Fit gap coupon', () => {
  it('prints fit − 0.1, fit and fit + 0.1, never below zero', () => {
    expect(couponGaps(0.4)).toEqual([0.3, 0.4, 0.5]);
    expect(couponGaps(0.05)).toEqual([0, 0.05, 0.15]);
  });

  it('cuts every female sample at male + gap, and the gaps follow the header fit', () => {
    const C = FIT_COUPON;
    for (const fit of [0.3, 0.5]) {
      const gaps = couponGaps(fit);
      withBuild('fit-gap-coupon', { fit }, (out, g) => {
        const xs = [-C.pitch, 0, C.pitch];
        const rowY = (k: number) => (k - 2) * C.row + 2;
        const female = (id: string) => placed(out, id);
        gaps.forEach((gp, i) => {
          const x = xs[i];
          // Round: diameter across the socket vs the spigot.
          const hole = voidIn(g, female('round-socket'), [x - 9, rowY(0) - 0.01, 2], [x + 9, rowY(0) + 0.01, 3], 0);
          expect(hole - C.spigotD, `round ${gp}`).toBeCloseTo(gp, 2);
          // Dovetail: halfway down the tail, the slot is the key plus the gap square to the flank.
          const { a, b, d } = C.dovetail;
          const yMid = (k: number) => (k - 2) * C.row + 10 - d / 2;
          const phi = Math.atan((b - a) / (2 * d));
          const slot = voidIn(g, female('dovetail-slot'), [x - 9, yMid(1) - 0.01, 2], [x + 9, yMid(1) + 0.01, 3], 0);
          const key = solidIn(g, placed(out, 'dovetail-key', i), [x - 9, yMid(1) - 0.01, 2], [x + 9, yMid(1) + 0.01, 3], 0);
          expect(slot - key, `dovetail ${gp}`).toBeCloseTo(gp / Math.cos(phi), 3);
          // Square key and pocket, tab and slot: straight across.
          const pocket = voidIn(g, female('square-pocket'), [x - 9, rowY(2) - 0.01, 5], [x + 9, rowY(2) + 0.01, 5.5], 0);
          expect(pocket - C.key, `square ${gp}`).toBeCloseTo(gp, 3);
          const tabW = voidIn(g, female('tab-slot'), [x - 9, rowY(3) - 0.01, 2], [x + 9, rowY(3) + 0.01, 3], 0);
          const tabT = voidIn(g, female('tab-slot'), [x - 0.01, rowY(3) - 4, 2], [x + 0.01, rowY(3) + 4, 3], 1);
          expect(tabW - C.tab.w, `tab width ${gp}`).toBeCloseTo(gp, 3);
          expect(tabT - C.tab.t, `tab thickness ${gp}`).toBeCloseTo(gp, 3);
          // Hinge: knuckle gap across the fork, pin hole across its diameter.
          const zp = 11;
          const knuckle = voidIn(g, female('hinge-fork'), [x - 6.9, rowY(4) - 0.01, zp + 4], [x + 6.9, rowY(4) + 0.01, zp + 4.5], 0);
          expect(knuckle - C.knuckle, `knuckle ${gp}`).toBeCloseTo(gp, 3);
          const pinHole = voidIn(g, female('hinge-fork'), [x - 6.5, rowY(4) - 5, zp - 0.01], [x - 6, rowY(4) + 5, zp + 0.01], 1);
          expect(pinHole - C.pinD, `pin ${gp}`).toBeCloseTo(gp, 2);
        });
      });
    }
  });

  it('fits on one 180 mm plate, flat', () => {
    const r = runBuild(wasm, 'fit-gap-coupon');
    expect(r.errors).toEqual([]);
    const plates = packPlates(
      r.parts.map((p) => ({ id: p.id, bounds: p.bounds, count: p.instances.length })),
      getPrinter('bambu-a1mini'),
    );
    expect(plates).toHaveLength(1);
    expect(plates[0].items.some((it) => it.oversize)).toBe(false);
    for (const p of r.parts) expect(p.bounds.min[2]).toBeCloseTo(0, 6);
  });
});
