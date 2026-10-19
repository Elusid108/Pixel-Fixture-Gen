import type { CrossSection, Manifold } from 'manifold-3d';
import { FIT_PARAMS, fitOf } from '../fit';
import { Geo } from '../geom/geo';
import { mul, Rx, T } from '../geom/mat';
import { basis } from '../geom/vec';
import type { AssemblyStep, FixtureDef, Mat4, PartSpec } from '../types';

/** Nominal (male) sizes on the T1 coupon, mm. Each female feature is these plus the gap. */
export const FIT_COUPON = {
  /** Round spigot diameter and length (= plate thickness). */
  spigotD: 10,
  /** Dovetail: neck width at the plate edge, tail width, depth into the plate. */
  dovetail: { a: 6, b: 10, d: 8 },
  /** Square key side and the depth it reaches into its pocket. */
  key: 8,
  keyL: 4,
  /** Sliding tab width and thickness. */
  tab: { w: 12, t: 2 },
  /** Hinge: tongue (middle knuckle) thickness, its round-end radius, printed pin diameter. */
  knuckle: 4,
  knuckleR: 5,
  pinD: 3,
  /** Sample pitch along a row and the row pitch. */
  pitch: 22,
  row: 30,
  /** Female plate thickness. */
  plate: 6,
} as const;

/** The three gaps a coupon prints: one step either side of the fit gap, never below zero. */
export function couponGaps(fit: number, step = 0.1): number[] {
  return [fit - step, fit, fit + step].map((v) => Math.max(0, Math.round(v * 100) / 100));
}

/** Row order, front to back. */
export const COUPON_ROWS = ['round', 'dovetail', 'square', 'tab', 'hinge'] as const;

/**
 * T1 Fit gap coupon: print this before a multi-part fixture. Five joints from the catalogue, each
 * at three gaps (fit − 0.1, fit, fit + 0.1) with the gap engraved beside it: a round spigot in a
 * socket, a dovetail, a square key in a pocket, a tab sliding in a slot and a hinge knuckle on a
 * printed pin. One male piece per sample; the female plates carry the gap. Everything prints flat
 * and support-free on a 180 mm bed. Try each joint and set the gap that goes together by hand,
 * without sanding and without rattling, as the Fit gap in the header.
 *
 * Assembled frame: rows run along X, the coupon stacks rows along +Y, plates on z=0. The view
 * shows every male piece seated in its sample.
 */
export const fitCoupon: FixtureDef = {
  id: 'fit-gap-coupon',
  code: 'T1',
  name: 'Fit gap coupon',
  family: 'utility',
  tagline: 'Print before a big build. Five joints at three gaps: pick the one that assembles.',
  description:
    'Round spigot, dovetail, square key, sliding tab and hinge knuckle, each at the fit gap and 0.1 mm either side, with the gap engraved beside each. Print it on one plate, flat with no supports, push every male piece into its three samples and set the gap that goes together by hand without sanding as the Fit gap in the header. Every fixture models its joints with that gap.',
  params: [...FIT_PARAMS],
  build(ctx, params) {
    const g = new Geo(ctx);
    const C = FIT_COUPON;
    const gaps = couponGaps(fitOf(params));
    const xs = [-C.pitch, 0, C.pitch];
    const W = 3 * C.pitch + 4;
    const y0 = -12;
    const y1 = 10;
    const yc = 2; // feature centre line, local to each plate
    const rowY = (k: number) => (k - 2) * C.row;
    const pt = C.plate;
    const SEGS = 64; // round fits: male and female share facets so the gap holds all round

    const label = (x: number, top: number, gap: number): Manifold => g.extrude(g.text(gap.toFixed(2), 3.5, 0.6).translate([x, y0 + 4]), top - 0.6, top + 1);
    const plate = (h: number): Manifold => g.extrude(g.roundRect(W, y1 - y0, 3, 0, (y0 + y1) / 2), 0, h);
    // Axis-along-X frame for things modelled along Z: local x → world y, y → z, z → x.
    const alongX = basis([0, 1, 0], [0, 0, 1], [1, 0, 0]);

    const parts: PartSpec<Manifold>[] = [];
    const FEMALE = new Set(['round-socket', 'dovetail-slot', 'square-pocket', 'tab-slot', 'hinge-fork']);
    const add = (id: string, name: string, solid: Manifold, instances: Mat4[], note?: string) =>
      parts.push({ id, name, role: 'body', solid, instances, explode: [0, 0, FEMALE.has(id) ? 0 : 1], note });

    /* ---------- Round spigot in a socket ---------- */
    {
      const r = C.spigotD / 2;
      const holes = gaps.map((gp, i) => g.cylZ(r + gp / 2, -1, pt + 1, xs[i], yc, SEGS));
      const female = g.cut(plate(pt), [...holes, ...gaps.map((gp, i) => label(xs[i], pt, gp))]);
      const male = g.union([g.cylZ(r + 3, 0, 2, 0, 0, SEGS), g.cylZ(r, 2, 2 + pt, 0, 0, SEGS)]);
      add('round-socket', 'Round · sockets', female, [T(0, rowY(0), 0)], 'Through holes: spigot Ø + gap.');
      add('round-spigot', 'Round · spigot', male, xs.map((x) => T(x, rowY(0) + yc, -2)), 'Flange down. One per socket.');
    }

    /* ---------- Dovetail: the slot is the tail grown by half the gap, square to every face ---------- */
    {
      const { a, b, d } = C.dovetail;
      const tail = (x: number): CrossSection =>
        g.poly([
          [x - a / 2, y1],
          [x + a / 2, y1],
          [x + b / 2, y1 - d],
          [x - b / 2, y1 - d],
        ]);
      const slots = gaps.map((gp, i) => g.extrude(tail(xs[i]).offset(gp / 2, 'Miter'), -1, pt + 1));
      const female = g.cut(plate(pt), [...slots, ...gaps.map((gp, i) => label(xs[i], pt, gp))]);
      // Key: the tail plus a handle that stops on the plate's back edge.
      const male = g.extrude(g.CS.union([tail(0), g.rect(a + 0.01, 1, 0, y1 - 0.4), g.roundRect(14, 6, 1.5, 0, y1 + 3)]), 0, pt);
      const centre = (y1 - d + y1 + 6) / 2;
      add('dovetail-slot', 'Dovetail · slots', female, [T(0, rowY(1), 0)], 'Slots open at the back edge, through the plate.');
      add('dovetail-key', 'Dovetail · key', g.place(male, T(0, -centre, 0)), xs.map((x) => T(x, rowY(1) + centre, 0)), 'Prints flat. Slides down into a slot from above.');
    }

    /* ---------- Square key in a pocket ---------- */
    {
      const k = C.key;
      const pockets = gaps.map((gp, i) => g.box([xs[i] - (k + gp) / 2, yc - (k + gp) / 2, pt - C.keyL - gp / 2], [xs[i] + (k + gp) / 2, yc + (k + gp) / 2, pt + 1]));
      const female = g.cut(plate(pt), [...pockets, ...gaps.map((gp, i) => label(xs[i], pt, gp))]);
      const male = g.union([g.box([-7, -7, 0], [7, 7, 2]), g.box([-k / 2, -k / 2, 2 - 0.01], [k / 2, k / 2, 2 + C.keyL])]);
      add('square-pocket', 'Square · pockets', female, [T(0, rowY(2), 0)], `Pockets: key + gap wide, ${C.keyL} mm + half the gap deep.`);
      add('square-key', 'Square · key', male, xs.map((x) => mul(T(x, rowY(2) + yc, pt + 2), Rx(180))), 'Head down. The head rests on the plate.');
    }

    /* ---------- Sliding tab in a slot ---------- */
    {
      const { w, t } = C.tab;
      const slots = gaps.map((gp, i) => g.box([xs[i] - (w + gp) / 2, yc - (t + gp) / 2, -1], [xs[i] + (w + gp) / 2, yc + (t + gp) / 2, pt + 1]));
      const female = g.cut(plate(pt), [...slots, ...gaps.map((gp, i) => label(xs[i], pt, gp))]);
      // Blade with a T-head that stops on the plate (print: flat, blade along +y, head at the top).
      const male = g.union([g.box([-w / 2, -4, 0], [w / 2, 12.01, t]), g.extrude(g.roundRect(w + 6, 4, 1, 0, 14), 0, t)]);
      add('tab-slot', 'Tab · slots', female, [T(0, rowY(3), 0)], 'Through slots: tab + gap in width and thickness.');
      add('tab', 'Tab', male, xs.map((x) => mul(T(x, rowY(3) + yc, -6), Rx(90), T(0, 0, -t / 2))), 'Prints flat. Slides down through a slot until the head stops.');
    }

    /* ---------- Hinge knuckle on a printed pin ---------- */
    {
      const kt = C.knuckle;
      const kr = C.knuckleR;
      const pr = C.pinD / 2;
      const base = 3;
      const fw = 14; // fork width along the pin
      const zp = base + 8; // pin axis
      const teardrop = (r: number): CrossSection => g.CS.union([g.CS.circle(r, 24), g.poly([[-r * Math.SQRT1_2, r * Math.SQRT1_2], [r * Math.SQRT1_2, r * Math.SQRT1_2], [0, r * Math.SQRT2]])]);
      const forks = xs.map((x) => g.box([x - fw / 2, yc - 6, base - 0.01], [x + fw / 2, yc + 6, zp + 6]));
      const cuts = gaps.flatMap((gp, i) => [
        // Knuckle gap: the tongue plus the gap across, and half a gap under its round end.
        g.box([xs[i] - (kt + gp) / 2, yc - 7, zp - kr - gp / 2], [xs[i] + (kt + gp) / 2, yc + 7, zp + 7]),
        // Pin hole: pin + gap, a teardrop so it prints without support.
        g.place(g.extrude(teardrop(pr + gp / 2), -fw / 2 - 1, fw / 2 + 1), mul(T(xs[i], yc, zp), alongX)),
        label(xs[i], base, gp),
      ]);
      const female = g.cut(g.union([plate(base), ...forks]), cuts);
      // Tongue (print: flat, pin hole on the origin, arm along +x). The pin presses into it.
      const tongue = g.cut(g.extrude(g.CS.union([g.CS.circle(kr, 48), g.rect(22, 2 * kr, 11, 0)]), 0, kt), [g.cylZ(pr, -1, kt + 1, 0, 0, 24)]);
      const pin = g.union([g.cylZ(pr + 1.5, 0, 1.5, 0, 0, 24), g.cylZ(pr, 1.5 - 0.01, 1.5 + fw, 0, 0, 24)]);
      add('hinge-fork', 'Hinge · forks', female, [T(0, rowY(4), 0)], 'Fork slot: knuckle + gap. Pin holes: pin + gap.');
      add('hinge-tongue', 'Hinge · knuckle', tongue, xs.map((x) => mul(T(x - kt / 2, rowY(4) + yc, zp), alongX)), 'Prints flat. The pin presses into it and turns in the fork.');
      add('hinge-pin', 'Hinge · pin', pin, xs.map((x) => mul(T(x - fw / 2 - 1.5, rowY(4) + yc, zp), alongX)), `Ø${C.pinD} printed pin, head down.`);
    }

    const g3 = gaps.map((v) => v.toFixed(2)).join(' / ');
    const assembly: AssemblyStep[] = [
      { title: 'Print one plate', parts: parts.map((p) => p.id), note: `Flat, no supports, your usual material and layer height. Gaps ${g3} mm.` },
      { title: 'Round', parts: ['round-spigot', 'round-socket'], note: 'Spigot up into each socket from below.' },
      { title: 'Dovetail', parts: ['dovetail-key', 'dovetail-slot'], note: 'Slide each key down into its slot.' },
      { title: 'Square key', parts: ['square-key', 'square-pocket'], note: 'Key head down into each pocket.' },
      { title: 'Tab', parts: ['tab', 'tab-slot'], note: 'Slide each tab down through its slot.' },
      { title: 'Hinge', parts: ['hinge-tongue', 'hinge-pin', 'hinge-fork'], note: 'Tongue into the fork, pin through both. It should swing freely.' },
      { title: 'Pick the gap', note: 'The smallest gap that goes together by hand on every joint, without sanding. Set it as Fit in the header.' },
    ];

    return { parts, pixels: [], schedule: [], hardware: [], warnings: [], assembly };
  },
};
