import type { Manifold } from 'manifold-3d';
import { Geo, type P2 } from '../geom/geo';
import { apply, applyDir, mul, Rx, Rz, T } from '../geom/mat';
import { getPixel, pcbLedOffsets } from '../pixels/library';
import { socketCutter } from '../pixels/sockets';
import type { FixtureDef, PartSpec, PixelPlacement, Vec3 } from '../types';
import { bool, layFlat, num, str } from './util';

/**
 * S2 Fresnel: a desk-scale Fresnel built the way the real ones are.
 *
 * - The lens is a true Fresnel collapse of a spherical surface: constant step height, so the
 *   rings tighten toward the edge exactly like the glass in a 6" Fresnel.
 * - The lamp house floor seats a ring PCB and a jewel. Ring = iris/ripple, jewel = hot spot.
 * - The bezel carries real colour-frame guides: two gel frames (sandwich your own gel) and a
 *   four-leaf barn door slide in from the top and rest on the rail stops.
 * - Yoke with M4 tilt knobs on heat-set trunnions, M5 pan lock into the stand.
 *
 * Can-local frame: axis +Z, floor at z=0, front at z=H. The assembled beam points along +Y.
 */
export const fresnel: FixtureDef = {
  id: 'fresnel',
  code: 'S2',
  name: 'Fresnel',
  family: 'single',
  tagline: 'Stepped lens, colour-frame guides, four-leaf barn doors, yoke and stand.',
  description:
    'Ring and jewel PCBs fire through a computed Fresnel lens printed in natural PETG. The lens does not focus; the rings break up the light the way the glass does. Gels and barn doors use the real colour-frame slot. The barn-door leaves hinge on 1.75 mm filament.',
  params: [
    { key: 'ring', label: 'Ring PCB', type: 'pixel', default: 'ring-24-ws2812b', pixels: ['ring-24-ws2812b', 'ring-16-ws2812b', 'ring-12-ws2812b'], group: 'Pixels' },
    { key: 'jewel', label: 'Centre PCB', type: 'pixel', default: 'jewel-7-ws2812b', pixels: ['jewel-7-ws2812b', 'jewel-7-sk6812-rgbw'], group: 'Pixels' },
    { key: 'lens', label: 'Lens diameter', type: 'number', default: 110, min: 90, max: 150, step: 5, unit: 'mm', group: 'Lamp house' },
    { key: 'length', label: 'Can length', type: 'number', default: 85, min: 60, max: 130, step: 5, unit: 'mm', group: 'Lamp house' },
    {
      key: 'curve',
      label: 'Lens curvature radius',
      type: 'number',
      default: 150,
      min: 80,
      max: 300,
      step: 10,
      unit: 'mm',
      group: 'Lamp house',
      help: 'Tighter radius gives more, narrower rings toward the edge.',
    },
    { key: 'barndoors', label: 'Barn doors', type: 'boolean', default: true, group: 'Accessories' },
    { key: 'gels', label: 'Gel frames', type: 'boolean', default: true, group: 'Accessories' },
    { key: 'tilt', label: 'Tilt (view)', type: 'number', default: 20, min: -30, max: 60, step: 5, unit: '°', group: 'View' },
    { key: 'doors', label: 'Barn door open (view)', type: 'number', default: 100, min: 0, max: 170, step: 5, unit: '°', group: 'View' },
    { key: 'tol', label: 'Socket clearance', type: 'number', default: 0.2, min: 0, max: 0.5, step: 0.05, unit: 'mm', group: 'Fit' },
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const ring = getPixel(str(params, 'ring'));
    const jewel = getPixel(str(params, 'jewel'));
    const tol = num(params, 'tol');
    const R = num(params, 'lens') / 2;
    const H = num(params, 'length');
    const Rc = num(params, 'curve');
    const wall = 2.4;
    const ringOD = ring.shape.kind === 'ring' ? ring.shape.od : 66;
    const warnings: string[] = [];

    /* ---------- Lens ---------- */
    const lt = 3.2; // rim thickness
    const lb = 1.2; // web under the teeth
    const hT = 1.6; // step height
    const rimW = 3.5;
    const rFlat = R - rimW;
    const sag = (r: number) => Rc - Math.sqrt(Math.max(0, Rc * Rc - r * r));
    const zoneR: number[] = [0];
    for (let k = 1; ; k++) {
      if (k * hT >= Rc) break;
      const r = Math.sqrt(Rc * Rc - (Rc - k * hT) ** 2);
      if (r >= rFlat) break;
      zoneR.push(r);
    }
    const zoneZ = (k: number, r: number) => lb + hT - (sag(r) - k * hT);
    const profile: P2[] = [
      [0, 0],
      [R, 0],
      [R, lt],
      [rFlat, lt],
    ];
    for (let k = zoneR.length - 1; k >= 0; k--) {
      const outer = k === zoneR.length - 1 ? rFlat : zoneR[k + 1];
      const inner = zoneR[k];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const r = outer - ((outer - inner) * i) / steps;
        profile.push([r, zoneZ(k, r)]);
      }
    }
    const lens = g.revolve(profile, 120);

    /* ---------- Can ---------- */
    const Rb = R + 0.3;
    const Ro = Rb + wall;
    const Ri = R - 3;
    if (ringOD / 2 + 2 > Ri) warnings.push(`The ${ring.name} is wider than the lamp house. Use a bigger lens or a smaller ring.`);
    const floorT = Math.max(ring.shape.depth, jewel.shape.depth) + 1.6;
    const zl = H - lt - 0.2;
    const zt = H * 0.5;
    const cutters: (Manifold | false)[] = [
      g.cylZ(Ri, floorT, H + 1),
      g.cylZ(Rb, zl, H + 1),
      g.place(socketCutter(g, ring, { tol, over: 1, wire: floorT + 1 }), T(0, 0, floorT)),
      g.place(socketCutter(g, jewel, { tol, over: 1, wire: floorT + 1 }), T(0, 0, floorT)),
      g.cylZ(3.2, -1, floorT + 1, 0, (ringOD / 2 + Ri) / 2), // cable entry, rear-bottom when hung
    ];
    for (let i = 0; i < 16; i++) {
      const a = (i * 360) / 16;
      const fromTrunnion = Math.min(a % 180, 180 - (a % 180));
      if (fromTrunnion < 25) continue;
      cutters.push(g.place(g.box([Ri - 1, -1.5, floorT + 3], [Ro + 1, 1.5, floorT + 15]), Rz(a)));
    }
    for (const sy of [-1, 1]) cutters.push(g.cylY(1.25, sy > 0 ? Ro - 5 : -Ro - 1, sy > 0 ? Ro + 1 : -Ro + 5, 0, H - 6));
    const bosses: Manifold[] = [];
    for (const sx of [-1, 1]) {
      const [a, b] = sx > 0 ? [Ro - 1, Ro + 4] : [-Ro - 4, -Ro + 1];
      bosses.push(g.cylX(8, a, b, 0, zt));
      cutters.push(sx > 0 ? g.cylX(2.8, Ro + 4 - 8.2, Ro + 4.1, 0, zt) : g.cylX(2.8, -Ro - 4.1, -Ro - 4 + 8.2, 0, zt));
    }
    const can = g.cut(g.union([g.cylZ(Ro, 0, H), ...bosses]), cutters);

    /* ---------- Bezel + colour-frame guides ---------- */
    const pt = 3;
    const F = 2 * R + 16; // colour frame size
    const Fp = F + 2 * (0.5 + 3);
    const slotH = 6.2;
    let bezel = g.union([g.extrude(g.roundRect(Fp, Fp, 4), 0, pt), g.tubeZ(Ro + 2.65, Ro + 0.25, pt - 0.01, pt + 10)]);
    const bezelCuts: Manifold[] = [g.cylZ(R - 3, -1, pt + 1), g.cylZ(Ro + 0.25, pt, pt + 11)];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) bezelCuts.push(g.cylZ(1.55, -1, pt + 1, sx * (F / 2 + 2), (sy * Fp) / 4));
    for (const sy of [-1, 1]) bezelCuts.push(g.cylY(1.65, sy > 0 ? Ro : -Ro - 4, sy > 0 ? Ro + 4 : -Ro, 0, pt + 6));
    bezel = g.cut(bezel, bezelCuts);

    // Rails in "front" coords: plate plane XY, +Z forward out of the instrument.
    const rail = (sx: number): Manifold => {
      const span = (a: number, b: number): [number, number] => (sx > 0 ? [a, b] : [-b, -a]);
      const [s0, s1] = span(F / 2 + 0.5, F / 2 + 3.5);
      const [l0, l1] = span(F / 2 + 0.5 - 4, F / 2 + 3.5);
      return g.union([
        g.box([s0, -Fp / 2, 0], [s1, Fp / 2, slotH]),
        g.box([l0, -Fp / 2, slotH], [l1, Fp / 2, slotH + 2]),
        g.box([l0, -Fp / 2, 0], [l1, -Fp / 2 + 4, slotH + 2]),
        ...[-1, 1].map((sy) => g.cylZ(1.4, -2.8, 0.01, sx * (F / 2 + 2), (sy * Fp) / 4)),
      ]);
    };

    /* ---------- Gel frames + barn doors ---------- */
    const vc = 0.3; // frames rest on the rail stops
    const gelFrame = g.cut(
      g.extrude(g.CS.union([g.roundRect(F, F, 3), g.roundRect(24, 10, 2, 0, F / 2 + 2)]), 0, 1.2),
      [g.cylZ(R - 2, -1, 2)],
    );

    const kl = 8;
    const clr = 0.4;
    const yk = F / 2 - 4;
    const xk = F / 2 - 7;
    const spanTop = F - 24;
    const spanSide = 0.55 * F;
    const frameSegs = (S: number): [number, number][] => [
      [-S / 2, -S / 2 + kl],
      [-kl / 2, kl / 2],
      [S / 2 - kl, S / 2],
    ];
    const leafSegs = (S: number): [number, number][] => [
      [-S / 2 + kl + clr, -kl / 2 - clr],
      [kl / 2 + clr, S / 2 - kl - clr],
    ];
    // Frame knuckles for one edge, in edge coords (axis along X at y=e, z=6), then rotated.
    const frameHinge = (S: number, e: number, rot: number): Manifold[] =>
      frameSegs(S).flatMap(([a, b]) => [
        g.place(g.union([g.cylX(3, a, b, e, 6), g.box([a, e - 3, 3 - 0.01], [b, e + 3, 6])]), Rz(rot)),
      ]);
    const hingePins = (S: number, e: number, rot: number) => g.place(g.cylX(1.0, -S / 2 - 1, S / 2 + 1, e, 6), Rz(rot));
    const barnFrame = g.cut(
      g.union([
        g.extrude(g.roundRect(F, F, 3), 0, 3),
        ...frameHinge(spanTop, yk, 0),
        ...frameHinge(spanTop, yk, 180),
        ...frameHinge(spanSide, xk, -90),
        ...frameHinge(spanSide, xk, 90),
      ]),
      [
        g.extrude(g.roundRect(2 * R - 4, 2 * R - 4, 4), -1, 4),
        hingePins(spanTop, yk, 0),
        hingePins(spanTop, yk, 180),
        hingePins(spanSide, xk, -90),
        hingePins(spanSide, xk, 90),
      ],
    );
    // Leaf in print coords: hinge axis along X at y=0, z=3; blade toward +Y.
    const barnLeaf = (S: number, len: number): Manifold =>
      g.cut(
        g.union([
          g.box([-S / 2, 3.4, 0], [S / 2, len, 2]),
          ...leafSegs(S).flatMap(([a, b]) => [g.cylX(3, a, b, 0, 3), g.box([a, 0, 0], [b, 3.6, 2])]),
        ]),
        [g.cylX(1.0, -S / 2 - 1, S / 2 + 1, 0, 3)],
      );

    /* ---------- Yoke + stand (assembled frame, Z up, beam +Y) ---------- */
    const Hc = 40;
    const Hp = Hc + 6 + Ro + 18;
    const xa = Ro + 4 + 0.5 + 3;
    const yokeAsm = g.cut(
      g.union([
        ...[-1, 1].flatMap((sx) => [
          g.box([sx * xa - 3, -9, Hc], [sx * xa + 3, 9, Hp]),
          g.cylX(9, sx * xa - 3, sx * xa + 3, 0, Hp),
        ]),
        g.box([-xa - 3, -9, Hc], [xa + 3, 9, Hc + 6]),
      ]),
      [g.cylX(2.25, -xa - 4, xa + 4, 0, Hp), g.cylZ(2.75, Hc - 1, Hc + 7)],
    );
    const yoke = layFlat(g, yokeAsm, Rx(-90));
    const standR = Ro * 0.85 + 10;
    const stand = g.cut(g.union([g.cylZ(standR, 0, 8), g.coneZ(13, 9, 7, Hc)]), [g.cylZ(3.2, Hc - 10.2, Hc + 0.1)]);

    /* ---------- Assembly ---------- */
    const tilt = num(params, 'tilt');
    const Mcan = mul(T(0, 0, Hp), Rx(tilt), Rx(-90), T(0, 0, -zt));
    const Mfront = mul(Mcan, T(0, 0, H + pt));
    const beam = applyDir(Mcan, [0, 0, 1]);
    const ex = (k: number, side: Vec3 = [0, 0, 0]): Vec3 => [beam[0] * k + side[0], beam[1] * k + side[1], beam[2] * k + side[2]];

    const parts: PartSpec<Manifold>[] = [
      { id: 'stand', name: 'Stand', role: 'body', solid: stand, instances: [T(0, 0, 0)], explode: [0, 0, -1] },
      { id: 'yoke', name: 'Yoke', role: 'body', solid: yoke.solid, instances: [yoke.instance], explode: [0, 0, -0.4] },
      { id: 'can', name: 'Lamp house', role: 'body', solid: can, instances: [Mcan], explode: [0, 0, 0] },
      {
        id: 'lens',
        name: 'Fresnel lens',
        role: 'diffuser',
        solid: lens,
        instances: [mul(Mcan, T(0, 0, zl + lt), Rx(180))],
        explode: ex(1.2),
        note: 'Natural PETG, flat face on the plate. Steps face the LEDs.',
      },
      { id: 'bezel', name: 'Bezel + frame holder', role: 'body', solid: bezel, instances: [mul(Mfront, Rx(180))], explode: ex(2) },
    ];
    for (const sx of [-1, 1]) {
      const r = layFlat(g, rail(sx), Rx(180), Mfront);
      parts.push({ id: `rail-${sx > 0 ? 'r' : 'l'}`, name: `Frame rail ${sx > 0 ? 'R' : 'L'}`, role: 'body', solid: r.solid, instances: [r.instance], explode: ex(2.6, [sx * 0.4, 0, 0]) });
    }
    if (bool(params, 'gels')) {
      parts.push({
        id: 'gel-frame',
        name: 'Gel frame',
        role: 'body',
        solid: gelFrame,
        instances: [mul(Mfront, T(0, vc, 0.2)), mul(Mfront, T(0, vc, 1.4))],
        explode: ex(3.2),
        note: 'Two halves sandwich a cut of real gel.',
      });
    }
    if (bool(params, 'barndoors')) {
      const Mbf = mul(Mfront, T(0, vc, 2.8));
      const open = num(params, 'doors');
      const leafAt = (rot: number, e: number) => mul(Mbf, Rz(rot), T(0, e, 6), Rx(open), T(0, 0, -3));
      parts.push({ id: 'barn-frame', name: 'Barn door frame', role: 'body', solid: barnFrame, instances: [Mbf], explode: ex(3.8) });
      parts.push({
        id: 'barn-leaf-l',
        name: 'Barn door leaf (top/bottom)',
        role: 'body',
        solid: barnLeaf(spanTop, 0.42 * F),
        instances: [leafAt(0, yk), leafAt(180, yk)],
        explode: ex(4.6),
      });
      parts.push({
        id: 'barn-leaf-s',
        name: 'Barn door leaf (side)',
        role: 'body',
        solid: barnLeaf(spanSide, 0.28 * F),
        instances: [leafAt(-90, xk), leafAt(90, xk)],
        explode: ex(4.6),
      });
    }

    const lensFace = zl + lt;
    const pixels: PixelPlacement[] = [];
    const place = (offsets: [number, number][], unit: string) => {
      for (const [x, y] of offsets) {
        pixels.push({ pos: apply(Mcan, [x, y, lensFace]), normal: applyDir(Mcan, [0, 0, 1]), unit });
      }
    };
    place(pcbLedOffsets(ring), 'S2-1');
    place(pcbLedOffsets(jewel), 'S2-2');

    const pins = bool(params, 'barndoors') ? ((2 * spanTop + 2 * spanSide + 8) / 1000).toFixed(2) : null;
    return {
      parts,
      pixels,
      schedule: [
        {
          unit: 'S2-1',
          position: 'Lamp house floor, outer',
          purpose: 'Ring / iris / ripple',
          pixelId: ring.id,
          units: 1,
          px: ring.pxPerUnit,
          notes: `${zoneR.length} lens zones over it.`,
        },
        { unit: 'S2-2', position: 'Lamp house floor, centre', purpose: 'Hot spot', pixelId: jewel.id, units: 1, px: jewel.pxPerUnit },
      ],
      hardware: [
        { item: 'M4 heat-set insert', qty: 2, note: 'Trunnions' },
        { item: 'M4×10 thumb screw', qty: 2, note: 'Tilt lock' },
        { item: 'M5 heat-set insert', qty: 1, note: 'Stand post' },
        { item: 'M5×16 thumb screw', qty: 1, note: 'Pan lock' },
        { item: 'M3×8 self-tapping screw', qty: 2, note: 'Bezel to can' },
        ...(pins ? [{ item: '1.75 mm filament hinge pins', qty: Number(pins), note: 'metres, cut to each hinge' }] : []),
        { item: 'WLED controller (ESP32)', qty: 1, note: 'Remote, via JST-SM pigtail through the cable entry' },
      ],
      warnings,
      enclosureCm3: (Math.PI * Ri * Ri * (zl - floorT)) / 1000,
    };
  },
};
