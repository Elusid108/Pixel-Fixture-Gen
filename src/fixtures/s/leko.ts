import type { CrossSection, Manifold } from 'manifold-3d';
import { FIT_PARAMS, fitOf, seatOf, sideOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { apply, applyDir, mul, Rx, Rz, T } from '../../geom/mat';
import { getPixel, pcbLedOffsets } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, Mat4, PartSpec, PixelPlacement } from '../../types';
import { decodeImage, imageFrom, type GrayImage } from '../image';
import { bool, layFlat, num, str } from '../util';
import { fieldFromImage, isoRegion, rng } from './common';

export const GOBOS = ['breakup', 'window', 'stars', 'custom'] as const;
export type Gobo = (typeof GOBOS)[number];

/** Pattern radius on the plate: a 1:3 A-size gobo has a 25 mm image. */
const PAT_R = 12.6;

/** Built-in art for the custom slot: a crescent moon with a few stars. White = light through. */
export const defaultGoboImage = (): GrayImage =>
  imageFrom(96, 96, (u, v) => {
    const moon = Math.hypot(u - 0.46, v - 0.52) < 0.33 && Math.hypot(u - 0.6, v - 0.43) > 0.29;
    const star = [
      [0.78, 0.2, 0.035],
      [0.82, 0.62, 0.025],
      [0.66, 0.82, 0.03],
    ].some(([x, y, r]) => Math.hypot(u - x, v - y) < r);
    return moon || star ? 1 : 0;
  });

function starPts(R: number, cx: number, cy: number, rot: number): P2[] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = rot + (i * Math.PI) / 5 + Math.PI / 2;
    const r = i % 2 ? R * 0.42 : R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2;
  });
}

/** The open (light-passing) area of a gobo, centred on the origin, clipped to the image circle. */
export function goboHoles(g: Geo, kind: Gobo, seed: number, img: GrayImage | null): CrossSection {
  const clip = g.circle(PAT_R);
  if (kind === 'breakup') {
    const r = rng(seed);
    const leaves: CrossSection[] = [];
    for (let i = 0; i < 28; i++) {
      const rho = 12.5 * Math.sqrt(r());
      const phi = r() * Math.PI * 2;
      leaves.push(
        g.CS.circle(1, 24)
          .scale([1.3 + 2 * r(), 0.7 + 0.9 * r()])
          .rotate(r() * 180)
          .translate([rho * Math.cos(phi), rho * Math.sin(phi)]),
      );
    }
    return g.CS.union(leaves).intersect(clip);
  }
  if (kind === 'window') {
    const k = 0.3; // shear: the window falls across the floor at an angle
    const pane = (cx: number, cy: number, w: number, h: number) =>
      g.poly(
        [
          [cx - w / 2, cy - h / 2],
          [cx + w / 2, cy - h / 2],
          [cx + w / 2, cy + h / 2],
          [cx - w / 2, cy + h / 2],
        ].map(([x, y]) => [x + k * y, y] as P2),
      );
    const panes: CrossSection[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const ty of [-1, 1]) panes.push(pane(sx * 4.6, sy * 5.6 + ty * 2.55, 7.8, 4.3));
    return g.CS.union(panes).intersect(clip);
  }
  if (kind === 'stars') {
    const r = rng(seed + 101);
    const placed: [number, number, number][] = [];
    for (let tries = 0; tries < 600 && placed.length < 16; tries++) {
      const R = 1.8 + 2 * r();
      const rho = (PAT_R - R - 0.6) * Math.sqrt(r());
      const phi = r() * Math.PI * 2;
      const c: [number, number, number] = [rho * Math.cos(phi), rho * Math.sin(phi), R];
      if (placed.every(([x, y, q]) => Math.hypot(x - c[0], y - c[1]) > q + R + 1.2)) placed.push(c);
    }
    return g.CS.union(placed.map(([x, y, R]) => g.poly(starPts(R, x, y, r() * 1.2))));
  }
  const art = img ?? defaultGoboImage();
  const fd = fieldFromImage(art, 72, 72);
  return isoRegion(g, fd, 0.5, -PAT_R, -PAT_R, 2 * PAT_R, 2 * PAT_R)
    .offset(-0.3, 'Round')
    .offset(0.3, 'Round')
    .intersect(clip);
}

/**
 * S3 Leko Jr.: a 1:3 ellipsoidal reflector spotlight.
 *
 * Can frame: beam along +Z, z=0 the rear face of the reflector housing. From the back: lamp
 * cap (translucent, 8 PCBs glowing into it), carrier with the "lamp" post holding the jewel,
 * reflector housing, gate (frost, four shutter planes, template slot), lens barrel.
 * The jewel backlights a frost disc behind the gobo, so the gobo glows in the gate the way a
 * real one looks from the front of house. Nothing focuses: there is no lens to project it.
 *
 * Fit: the cap sleeve, carrier, gate spigot, frost seat, shutter planes, template slot, barrel
 * spigot and yoke cheeks take the fit gap; the jewel and cap PCBs take the seat clearance.
 */
export const leko: FixtureDef = {
  id: 'leko-jr',
  code: 'S3',
  name: 'Leko Jr.',
  family: 'single',
  tagline: '1:3 ERS. Sliding shutters, a template slot and printable gobos.',
  description:
    'A one-third-scale ellipsoidal with reflector housing, lamp cap, four sliding shutters in their own planes and an A-size (1:3) template slot. The app prints a gobo library: breakup, window, stars and one from your own picture. Plainly: it backlights the gobo, it does not project it. There are no optics. A 7-px jewel on the lamp post lights a frost disc behind the gobo, so the pattern glows in the gate; an 8-PCB ring glows through the translucent lamp cap. Every part fits a 180 mm bed.',
  params: [
    { key: 'jewel', label: 'Gate PCB', type: 'pixel', default: 'jewel-7-ws2812b', pixels: ['jewel-7-ws2812b', 'jewel-7-sk6812-rgbw'], group: 'Pixels' },
    { key: 'capPixel', label: 'Lamp cap PCBs', type: 'pixel', default: 'pcb-9-ws2812b', pixels: ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw'], group: 'Pixels' },
    {
      key: 'gobo',
      label: 'Gobo in the slot',
      type: 'select',
      default: 'breakup',
      options: [
        { value: 'breakup', label: 'Breakup (leaves)' },
        { value: 'window', label: 'Window' },
        { value: 'stars', label: 'Stars' },
        { value: 'custom', label: 'Custom (picture)' },
      ],
      group: 'Gobos',
    },
    { key: 'image', label: 'Custom gobo art', type: 'image', default: '', group: 'Gobos', help: 'White passes light. Thresholded at 50%; islands that would fall out are dropped.' },
    { key: 'library', label: 'Print the whole library', type: 'boolean', default: true, group: 'Gobos', help: 'Every gobo plate, not just the one in the slot.' },
    { key: 'seed', label: 'Pattern seed', type: 'number', default: 7, min: 1, max: 99, step: 1, group: 'Gobos', help: 'Reshuffles the breakup and stars.' },
    {
      key: 'lens',
      label: 'Lens tube',
      type: 'select',
      default: '26',
      options: [
        { value: '19', label: '19° (long)' },
        { value: '26', label: '26°' },
        { value: '36', label: '36°' },
        { value: '50', label: '50° (short)' },
      ],
      group: 'Body',
      help: 'Barrel length only, as on the real thing. There is no lens.',
    },
    { key: 'throw', label: 'Lamp to gate', type: 'number', default: 30, min: 20, max: 45, step: 1, unit: 'mm', group: 'Body', help: 'Jewel to frost. Longer is more even, shorter is brighter.' },
    { key: 'cut', label: 'Shutter cut (view)', type: 'number', default: 30, min: 0, max: 60, step: 5, unit: '%', group: 'View' },
    { key: 'tilt', label: 'Tilt (view)', type: 'number', default: 15, min: -20, max: 40, step: 5, unit: '°', group: 'View' },
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const jewel = getPixel(str(params, 'jewel'));
    const pcb = getPixel(str(params, 'capPixel'));
    const tol = seatOf(params);
    const fit = fitOf(params);
    const side = sideOf(params);
    const throwMm = num(params, 'throw');
    const seed = num(params, 'seed');
    const selected = str(params, 'gobo') as Gobo;
    const userImg = decodeImage(str(params, 'image'));
    const warnings: string[] = [];

    /* ---------- Reflector housing ---------- */
    const Rr = 33; // rear, straight for the cap sleeve
    const Rf = 34; // front
    const Rm = 50; // belly
    const Lh = 66;
    const wall = 2.4;
    const sleeve = 8;
    const rOut = (z: number) => {
      if (z <= sleeve) return Rr;
      const t = (z - sleeve) / (Lh - sleeve);
      return Rr + (Rf - Rr) * t + (Rm - (Rr + Rf) / 2) * Math.sin(Math.PI * t);
    };
    const bore = Rr - wall; // carrier seat
    const front = Rf - wall; // gate spigot bore
    const rIn = (z: number) => {
      const rear = z < 4 ? bore : z < 7 ? bore - (z - 4) : bore - 3 + (z - 7); // 45° seat, never overhanging
      const fr = z > Lh - 6 ? front : front + (Lh - 6 - z);
      return Math.min(rOut(z) - wall, rear, fr);
    };
    const zs = [0, 4, 7, sleeve, Lh - 6, Lh];
    for (let z = 1; z < Lh; z += 1.5) zs.push(z);
    zs.sort((a, b) => a - b);
    const prof: P2[] = [...zs.map((z) => [rOut(z), z] as P2), ...[...zs].reverse().map((z) => [rIn(z), z] as P2)];
    const zt = sleeve + (Lh - sleeve) / 2; // trunnions at the belly
    const Rt = rOut(zt);
    let housing = g.union([g.revolve(prof, 96), ...[-1, 1].map((s) => g.cylX(8, s > 0 ? Rt - 3 : -Rt - 4, s > 0 ? Rt + 4 : -Rt + 3, 0, zt))]);
    housing = g.cut(housing, [
      ...[-1, 1].map((s) => (s > 0 ? g.cylX(2.8, Rt + 4 - 8.2, Rt + 4.1, 0, zt) : g.cylX(2.8, -Rt - 4.1, -Rt - 4 + 8.2, 0, zt))),
      // Die-cast-style vent slots round the belly, kept clear of the trunnions.
      ...Array.from({ length: 12 }, (_, k) => k)
        .filter((k) => k % 6 !== 0)
        .map((k) => g.place(g.box([Rt - 12, -1.2, zt - 14], [Rt + 2, 1.2, zt - 4]), Rz(k * 30))),
    ]);

    /* ---------- Lamp cap (translucent) ---------- */
    const Lc = 20;
    const capR = Rr + 2 + side;
    // The sleeve slides over the housing with the fit gap. The ledge under the housing and the
    // carrier rim is chamfered at 45° so the cap prints rear face down.
    const rLedge = bore - side - 1;
    const capProf: P2[] = [
      [3.5, -Lc],
      [capR - 2, -Lc],
      [capR, -Lc + 2],
      [capR, sleeve],
      [Rr + side, sleeve],
      [Rr + side, 0],
      [rLedge, 0],
      [Rr + side, -(Rr + side - rLedge)],
      [Rr + side, -Lc + 1.6],
      [3.5, -Lc + 1.6],
    ];
    const fins = Array.from({ length: 8 }, (_, k) => g.place(g.box([capR - 0.5, -0.6, -Lc + 2.5], [capR + 2.5, 0.6, sleeve - 1]), Rz(22.5 + k * 45)));
    const capAsm = g.union([g.revolve(capProf, 96), ...fins]);

    /* ---------- Carrier + lamp post (jewel on top, 8 PCBs on the back) ---------- */
    const zJ = Lh - 6 - throwMm;
    const jR = (jewel.shape.kind === 'round' ? jewel.shape.d : 23) / 2;
    const postR = jR + tol + 2.4;
    const r8 = 20;
    const carrierCuts: Manifold[] = [
      g.cylZ(postR - 2.4, 4, zJ - 5),
      g.cylZ(3, -1, 5),
      g.place(socketCutter(g, jewel, { tol, over: 1, wire: 6 }), T(0, 0, zJ)),
      ...Array.from({ length: 8 }, (_, k) => {
        const a = (k * Math.PI) / 4 + Math.PI / 2;
        return g.place(socketCutter(g, pcb, { tol, over: 1, wire: 6 }), mul(T(r8 * Math.cos(a), r8 * Math.sin(a), 0), Rx(180)));
      }),
    ];
    // 96 facets, like the housing it sits in, so the fit gap holds all round.
    const carrier = g.cut(g.union([g.cylZ(bore - side, 0, 4, 0, 0, 96), g.cylZ(postR, 3.9, zJ)]), carrierCuts);

    /* ---------- Gate: frost seat, four shutter planes, template slot ---------- */
    const Rg = 36;
    const ap = 14; // aperture radius
    const Lg = 16;
    const shZ = (k: number) => Lh + 1.5 + k * 2.6;
    const zT = Lh + 12;
    const bw = 30; // shutter blade width
    const bt = 1.2; // blade and gobo thickness
    const frostR = 17;
    const plateW = 34;
    const plateBottom = -17;
    const dirs = [90, 270, 180, 0]; // top, bottom, stage left, stage right (outward)
    // Shutter planes and the template slot are sliding fits: blade or plate plus the fit gap,
    // in thickness and in width. The frost disc drops into its seat with the same gap.
    const gateCuts: Manifold[] = [
      g.cylZ(ap, Lh - 7, Lh + Lg + 6),
      g.cylZ(frostR + side, Lh - 7, Lh - 6 + 1.2 + side), // frost seat
      ...dirs.map((a, k) => g.place(g.box([-ap - 2, -bw / 2 - side, shZ(k)], [Rg + 2, bw / 2 + side, shZ(k) + bt + fit]), Rz(a))),
      g.box([-plateW / 2 - side, plateBottom - side, zT], [plateW / 2 + side, Rg + 2, zT + bt + fit]),
    ];
    const Rb = 31;
    // Revolved so the ring steps out from the rear spigot at 45°: prints rear face down, no supports.
    const gateBody = g.revolve(
      [
        [ap - 1, Lh - 6],
        [front - side, Lh - 6],
        [front - side, Lh],
        [Rf, Lh],
        [Rg, Lh + Rg - Rf],
        [Rg, Lh + Lg],
        [Rb - 2.5 - side, Lh + Lg],
        [Rb - 2.5 - side, Lh + Lg + 5],
        [ap - 1, Lh + Lg + 5],
      ],
      96,
    );
    const gate = g.cut(gateBody, gateCuts);
    const frost = g.cylZ(frostR, 0, 1.2);

    /* ---------- Barrel ---------- */
    const Lb = { '19': 72, '26': 56, '36': 44, '50': 34 }[str(params, 'lens')] ?? 56;
    const z0b = Lh + Lg;
    // 96 facets, like the gate spigot it slides over.
    const barrelAsm = g.cut(g.cylZ(Rb, z0b, z0b + Lb, 0, 0, 96), [g.cylZ(Rb - 2.5, z0b - 1, z0b + Lb - 2, 0, 0, 96), g.cylZ(Rb - 5, z0b, z0b + Lb + 1)]);
    const barrel = layFlat(g, barrelAsm, Rx(180));

    /* ---------- Shutter blade (print: flat, leading edge at x=0, grip at the far end) ---------- */
    const bl = Rg + 0.5 + ap;
    const blade = g.union([g.extrude(g.roundRect(bl + 2, bw, 1.5, (bl + 2) / 2 - 1, 0), 0, bt).translate([1, 0, 0]), g.extrude(g.roundRect(6, bw - 6, 1.5, bl + 3, 0), 0, 5)]);

    /* ---------- Gobo plates ---------- */
    const plateTop = Rg + 20;
    const library: Gobo[] = bool(params, 'library') ? GOBOS.filter((k) => k !== 'custom' || userImg || selected === 'custom') : [selected];
    if (!library.includes(selected)) library.push(selected);
    let dropped = 0;
    const plate = (kind: Gobo): Manifold => {
      const outline = g.roundRect(plateW, plateTop - plateBottom, 2, 0, (plateTop + plateBottom) / 2).subtract(g.circle(4, 0, plateTop - 7));
      const pieces = outline.subtract(goboHoles(g, kind, seed, userImg)).decompose();
      pieces.sort((a, b) => b.area() - a.area());
      if (kind === 'custom') dropped += pieces.length - 1;
      const body = g.extrude(pieces[0], 0, bt);
      const label = g.text(kind.toUpperCase(), 3.6, 0.6).translate([0, Rg + 4]);
      return g.cut(body, [g.extrude(label, 0.7, 2)]);
    };

    /* ---------- Yoke + stand (assembled frame, Z up, beam +Y) ---------- */
    const Hc = 30;
    const Hp = Hc + 6 + Rm + 14;
    const xa = Rt + 4 + side + 3; // yoke cheeks clear the trunnion bosses by half a gap each
    const yokeAsm = g.cut(
      g.union([
        ...[-1, 1].flatMap((sx) => [g.box([sx * xa - 3, -9, Hc], [sx * xa + 3, 9, Hp]), g.cylX(9, sx * xa - 3, sx * xa + 3, 0, Hp)]),
        g.box([-xa - 3, -9, Hc], [xa + 3, 9, Hc + 6]),
      ]),
      [g.cylX(2.25, -xa - 4, xa + 4, 0, Hp), g.cylZ(2.75, Hc - 1, Hc + 7)],
    );
    const yoke = layFlat(g, yokeAsm, Rx(-90));
    const stand = g.cut(g.union([g.cylZ(55, 0, 7), g.coneZ(13, 9, 6.9, Hc)]), [g.cylZ(3.2, Hc - 10.2, Hc + 0.1)]);

    /* ---------- Assembly ---------- */
    const tilt = num(params, 'tilt');
    // Beam (+Z) to +Y and the can's +Y (template slot, top shutter) to +Z.
    const Mcan: Mat4 = mul(T(0, 0, Hp), Rx(tilt), Rz(180), Rx(90), T(0, 0, -zt));
    const beam = applyDir(Mcan, [0, 0, 1]);
    const ex = (k: number): [number, number, number] => [beam[0] * k, beam[1] * k, beam[2] * k];
    const cut = num(params, 'cut') / 100;
    const cuts = [1, 0.7, 0.45, 0.85].map((f) => ap * (1 - 2 * cut * f));

    const parts: PartSpec<Manifold>[] = [
      { id: 'stand', name: 'Stand', role: 'body', solid: stand, instances: [T(0, 0, 0)], explode: [0, 0, -1] },
      { id: 'yoke', name: 'Yoke', role: 'body', solid: yoke.solid, instances: [yoke.instance], explode: [0, 0, -0.4] },
      { id: 'housing', name: 'Reflector housing', role: 'body', solid: housing, instances: [Mcan], explode: [0, 0, 0], note: 'Rear face down. White or silver inside throws more light to the gate.' },
      { id: 'carrier', name: 'Carrier + lamp post', role: 'body', solid: carrier, instances: [Mcan], explode: ex(-1.2), note: 'Jewel on the post, 8 PCBs face back into the cap.' },
      { id: 'cap', name: 'Lamp cap', role: 'diffuser', solid: g.place(capAsm, T(0, 0, Lc)), instances: [mul(Mcan, T(0, 0, -Lc))], explode: ex(-2.2), note: 'Natural PETG, rear face on the plate.' },
      { id: 'gate', name: 'Gate (shutters + template slot)', role: 'body', solid: g.place(gate, T(0, 0, -(Lh - 6))), instances: [mul(Mcan, T(0, 0, Lh - 6))], explode: ex(1.2) },
      { id: 'frost', name: 'Frost disc', role: 'diffuser', solid: frost, instances: [mul(Mcan, T(0, 0, Lh - 6))], explode: ex(0.7), note: 'Natural PETG, 1.2 mm. Sits in the seat behind the gate.' },
      { id: 'barrel', name: `Lens tube (${str(params, 'lens')}°)`, role: 'body', solid: barrel.solid, instances: [mul(Mcan, barrel.instance)], explode: ex(2.6) },
      {
        id: 'shutter',
        name: 'Shutter blade',
        role: 'body',
        solid: blade,
        instances: dirs.map((a, k) => mul(Mcan, T(0, 0, shZ(k) + side), Rz(a), T(cuts[k], 0, 0))),
        explode: ex(1.8),
        note: 'Black. Slides in its own plane; the grip is the stop.',
      },
    ];

    const slotAt = mul(Mcan, T(0, 0, zT + side));
    library.forEach((kind, i) => {
      const parked = library.filter((k) => k !== selected).indexOf(kind);
      parts.push({
        id: `gobo-${kind}`,
        name: `Gobo: ${kind}`,
        role: 'body',
        solid: plate(kind),
        instances: [kind === selected ? slotAt : T(Rm + 60 + parked * (plateW + 8), -40, 0)],
        explode: kind === selected ? [0, 0, 1.6] : [0, 0, 0.2 + i * 0.1],
        note: kind === selected ? 'In the template slot. Black PLA, 1.2 mm.' : 'Spare for the slot.',
      });
    });
    if (dropped > 0) warnings.push(`The custom art has ${dropped} island${dropped === 1 ? '' : 's'} that would fall out of the plate, so ${dropped === 1 ? 'it was' : 'they were'} dropped. Add ties to the art to keep them, as a real gobo does.`);

    /* ---------- Pixels: jewel read at the gobo, cap ring read on the cap face ---------- */
    const pixels: PixelPlacement[] = [];
    for (const [x, y] of pcbLedOffsets(jewel)) pixels.push({ pos: apply(Mcan, [x, y, zT + 0.9]), normal: beam, unit: 'S3-1' });
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 2;
      pixels.push({ pos: apply(Mcan, [r8 * Math.cos(a), r8 * Math.sin(a), -Lc]), normal: applyDir(Mcan, [0, 0, -1]), unit: 'S3-2' });
    }

    return {
      parts,
      pixels,
      assembly: [
        { title: 'Base and yoke', parts: ['stand', 'yoke'], hardware: 'M5 heat-set insert, M5×16 thumb screw', note: 'Insert in the stand post. Yoke on top, pan lock in.' },
        { title: 'Wire the carrier', parts: ['carrier'], hardware: `${jewel.name}, 8 × ${pcb.name}`, note: 'Jewel on the post, 8 PCBs on the back. Daisy-chain round the ring, data in at the jewel.' },
        { title: 'Close the rear', parts: ['carrier', 'cap', 'housing'], hardware: '3 × M2×6 self-tapping screw', note: 'Carrier into the housing bore. Cap sleeve over the rear, screws through the sleeve.' },
        { title: 'Frost and gate', parts: ['frost', 'gate'], hardware: '3 × M2×6 self-tapping screw', note: 'Frost disc into the seat behind the gate. Gate spigot into the housing front.' },
        { title: 'Lens tube', parts: ['barrel'], note: 'Over the gate front spigot. Glue optional.' },
        { title: 'Shutters', parts: ['shutter'], note: 'One blade per plane, grip out.' },
        { title: 'Gobo', parts: [`gobo-${selected}`], note: 'Drop into the template slot, label up.' },
        { title: 'Hang the housing', parts: ['housing', 'yoke'], hardware: '2 × M4 heat-set insert, 2 × M4×10 thumb screw', note: 'Inserts in the trunnions. Housing between the yoke arms, thumb screws in.' },
      ],
      schedule: [
        { unit: 'S3-1', position: 'Lamp post, behind the gate', purpose: 'Gobo backlight', pixelId: jewel.id, units: 1, px: jewel.pxPerUnit, notes: `${throwMm} mm behind the frost. Data in here.` },
        { unit: 'S3-2', position: 'Carrier rear, into the lamp cap', purpose: 'Lamp-cap glow', pixelId: pcb.id, units: 8, px: 8, notes: 'Ring of 8 PCBs, LEDs facing back. Daisy-chain round the ring.' },
      ],
      hardware: [
        { item: 'M4 heat-set insert', qty: 2, note: 'Trunnions' },
        { item: 'M4×10 thumb screw', qty: 2, note: 'Tilt lock' },
        { item: 'M5 heat-set insert', qty: 1, note: 'Stand post' },
        { item: 'M5×16 thumb screw', qty: 1, note: 'Pan lock' },
        { item: 'M2×6 self-tapping screw', qty: 6, note: 'Cap sleeve and gate spigot, three each' },
        { item: 'WLED controller (ESP32)', qty: 1, note: 'Remote; cable in through the cap knob hole' },
      ],
      warnings,
      enclosureCm3: (Math.PI * 38 * 38 * (Lh - 10)) / 1000,
    };
  },
};
