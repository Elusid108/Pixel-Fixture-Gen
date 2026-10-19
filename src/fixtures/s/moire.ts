import type { CrossSection, Manifold } from 'manifold-3d';
import { FIT_PARAMS, sideOf } from '../../fit';
import { Geo } from '../../geom/geo';
import { Rx, T } from '../../geom/mat';
import { getPixel } from '../../pixels/library';
import type { FixtureDef, PartSpec, PixelPlacement } from '../../types';
import { layFlat, num, str } from '../util';
import { sector } from './common';

/** Helix for a strip of length L rising H around radius r: turns and rise per turn. */
export function stripHelix(L: number, H: number, r: number): { rise: number; turns: number } {
  const rise = Math.min(H, L * 0.98);
  return { rise, turns: Math.sqrt(Math.max(0, L * L - rise * rise)) / (2 * Math.PI * r) };
}

/**
 * S7 Moiré Lantern: two nested slotted shells over a glowing core.
 *
 * The slots twist in opposite hands, so the two gratings cross. Looking through both, the
 * crossings beat into broad moiré bands, and because the shells sit a gap apart, the bands
 * walk as you move past. Inside, a vase-mode diffuser sleeve turns a helix of strip on the
 * core into soft travelling colour. No moving parts; the motion is parallax and the chase.
 *
 * Fit: every shell and the sleeve stand in ring grooves in the base and cap with the fit gap
 * across the wall and half a gap at the cap end; the core sits in pockets the same way.
 */
export const moire: FixtureDef = {
  id: 'moire-lantern',
  code: 'S7',
  name: 'Moiré Lantern',
  family: 'single',
  tagline: 'Two slotted shells, twisted opposite ways. The pattern walks as people pass.',
  description:
    'A lantern of two slotted shells over a diffused core. The slots twist in opposite directions, so the gratings cross and beat into moiré bands that move with the viewer. Inside, a metre of strip spirals up a core in a guide groove behind a vase-mode diffuser sleeve. Print the shells in black or a dark colour, the sleeve in natural PETG. Sits on a table or hangs from the cap.',
  params: [
    { key: 'pixel', label: 'Strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: ['strip-60-ws2812b', 'strip-60-ws2815', 'strip-144-ws2812b'], group: 'Pixels' },
    { key: 'count', label: 'Pixels', type: 'number', default: 60, min: 30, max: 90, step: 1, group: 'Pixels', help: 'Strip length is pixels × pitch; the helix winds tighter to fit it.' },
    { key: 'slots', label: 'Slots per shell', type: 'number', default: 36, min: 18, max: 60, step: 1, group: 'Shells' },
    { key: 'twist', label: 'Slot twist', type: 'number', default: 45, min: 0, max: 90, step: 5, unit: '°', group: 'Shells', help: 'Outer shell twists this way, inner shell the other. 0 gives straight slots and a simple beat.' },
    { key: 'gap', label: 'Shell gap', type: 'number', default: 8, min: 4, max: 16, step: 1, unit: 'mm', group: 'Shells', help: 'Wider gap means more parallax: the bands move faster as you walk.' },
    { key: 'height', label: 'Shell height', type: 'number', default: 200, min: 140, max: 220, step: 5, unit: 'mm', group: 'Shells' },
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const pixel = getPixel(str(params, 'pixel'));
    const sp = pixel.shape.kind === 'strip' ? pixel.shape : { width: 10, pitch: 1000 / 60, depth: 3 };
    const count = num(params, 'count');
    const N = num(params, 'slots');
    const twist = num(params, 'twist');
    const gap = num(params, 'gap');
    const Hs = num(params, 'height');
    const side = sideOf(params);
    const warnings: string[] = [];

    /* ---------- Radii ---------- */
    const wall = 2;
    const R1o = 75;
    const R1i = R1o - wall;
    const R2o = R1i - gap;
    const R2i = R2o - wall;
    const R3o = R2i - 4;
    const R3i = R3o - 1;
    const Rc = 35;
    const Rci = Rc - 3;
    const grooveD = 1.2;
    const rg = Rc - grooveD; // strip back
    const rLed = rg + sp.depth;

    /* ---------- Heights ---------- */
    const hb = 14; // base
    const seat = 3; // groove depth in base and cap
    const z0 = hb - seat; // shell bottom
    const zTop = z0 + Hs - seat; // cap underside
    const capT = 6;
    const band = 10; // solid band above and below the slots

    /* ---------- Shells ---------- */
    const slotCs = (rIn: number, rOut: number): CrossSection => {
      const w = (0.5 * 360) / N;
      return g.CS.union(Array.from({ length: N }, (_, k) => sector(g, rIn - 1, rOut + 1, (k * 360) / N - w / 2, (k * 360) / N + w / 2, 2)));
    };
    const slotH = Hs - 2 * seat - 2 * band;
    const shell = (rOut: number, rIn: number, tw: number): Manifold => {
      const cutter = slotCs(rIn, rOut)
        .rotate(-tw / 2)
        .extrude(slotH, Math.max(1, Math.ceil(Math.abs(tw) / 3)), tw)
        .translate([0, 0, seat + band]);
      return g.tubeZ(rOut, rIn, 0, Hs).subtract(cutter);
    };
    const outer = shell(R1o, R1i, twist);
    const inner = shell(R2o, R2i, -twist);
    const sleeve = g.tubeZ(R3o, R3i, 0, Hs);

    /* ---------- Core with a helical strip groove ---------- */
    const Hc = zTop + 4 - (hb - 4) - side; // sits 4 deep in the base and 4 deep in the cap, half a gap short
    const zs = band + 6; // helix start above the core bottom
    const L = count * sp.pitch;
    const avail = Hc - zs - band - 4;
    const { rise, turns } = stripHelix(L, avail, rg);
    const perTurn = turns > 0.01 ? rise / turns : Infinity;
    const cosA = Math.cos(Math.atan2(rise, turns * 2 * Math.PI * rg));
    const hv = (sp.width + 1) / Math.max(0.2, cosA);
    if (perTurn < hv + 2) warnings.push(`At ${count} px the helix pitch (${perTurn.toFixed(0)} mm) is tighter than the strip. Use fewer pixels or a taller lantern.`);
    let core = g.tubeZ(Rc, Rci, 0, Hc);
    const ext = hv;
    const rate = turns > 0.01 ? (turns * 360) / rise : 0; // degrees per mm
    const halfDeg = turns > 0.01 ? Math.min(170, ((hv / perTurn) * 360) / 2) : ((sp.width + 1) / rg) * (90 / Math.PI);
    const groove = sector(g, rg, Rc + 1, -halfDeg, halfDeg, 8)
      .rotate(-rate * ext)
      .extrude(rise + 2 * ext, Math.max(1, Math.ceil((rate * (rise + 2 * ext)) / 4)), rate * (rise + 2 * ext))
      .translate([0, 0, zs - ext]);
    core = g.cut(core, [
      groove.intersect(g.cylZ(Rc + 2, zs - sp.width, zs + rise + sp.width)),
      g.cylX(3, Rci - 1, Rc + 1, 0, zs - 8), // strip lead into the core
    ]);

    /* ---------- Base: grooves for every shell, ESP32 bay below ---------- */
    // Chimney: air in through the base and out through the cap, up the strip annulus.
    const rAir = (Rc + R3i) / 2;
    const airHoles = (a: number, b: number) =>
      Array.from({ length: 6 }, (_, k) => g.cylZ(2.5, a, b, rAir * Math.cos((k * Math.PI) / 3 + 0.3), rAir * Math.sin((k * Math.PI) / 3 + 0.3)));
    const Rb = R1o + 4;
    // Shells rest on the base groove floors; the cap grooves run half a gap deeper than the shells reach.
    const ring = (ro: number, ri: number, a: number, b: number) => g.tubeZ(ro + side, ri - side, a, b);
    const base = g.cut(g.cylZ(Rb, 0, hb), [
      ring(R1o, R1i, hb - seat, hb + 1),
      ring(R2o, R2i, hb - seat, hb + 1),
      ring(R3o, R3i, hb - seat, hb + 1),
      g.cylZ(Rc + side, hb - 4, hb + 1),
      g.box([-15, -12, -1], [15, 12, 9]), // ESP32-C3 bay
      g.box([-Rb - 1, -5, 1.6], [-14, 5, 7]), // USB-C
      g.cylZ(4, 8, hb + 1), // leads up into the core
      ...airHoles(-1, hb + 1),
    ]);

    /* ---------- Cap: same grooves from below, hanging hole, air out ---------- */
    const capAsm = g.cut(g.cylZ(R1o + 2, zTop, zTop + capT), [
      ring(R1o, R1i, zTop - 1, zTop + seat + side),
      ring(R2o, R2i, zTop - 1, zTop + seat + side),
      ring(R3o, R3i, zTop - 1, zTop + seat + side),
      g.cylZ(Rc + side, zTop - 1, zTop + 4),
      g.cylZ(4, zTop - 1, zTop + capT + 1),
      ...airHoles(zTop - 1, zTop + capT + 1),
    ]);
    const cap = layFlat(g, capAsm, Rx(180));

    const parts: PartSpec<Manifold>[] = [
      { id: 'base', name: 'Base', role: 'body', solid: base, instances: [T(0, 0, 0)], explode: [0, 0, -1] },
      { id: 'core', name: 'Core', role: 'body', solid: core, instances: [T(0, 0, hb - 4)], explode: [0, 0, 0], note: 'White. The strip spirals up the guide groove.' },
      { id: 'sleeve', name: 'Diffuser sleeve', role: 'diffuser', solid: sleeve, instances: [T(0, 0, z0)], explode: [0, 0, 0.5], note: 'Natural PETG. Vase mode works: one 0.8–1 mm wall.' },
      { id: 'inner', name: `Inner shell (${N} slots, ${-twist}°)`, role: 'body', solid: inner, instances: [T(0, 0, z0)], explode: [0, 0, 1], note: 'Black or dark. The slot tops bridge about 6 mm into the top band.' },
      { id: 'outer', name: `Outer shell (${N} slots, +${twist}°)`, role: 'body', solid: outer, instances: [T(0, 0, z0)], explode: [0, 0, 1.5] },
      { id: 'cap', name: 'Cap', role: 'body', solid: cap.solid, instances: [cap.instance], explode: [0, 0, 2.2] },
    ];

    /* ---------- Pixels up the helix, read on the sleeve ---------- */
    const pixels: PixelPlacement[] = [];
    const zc = hb - 4; // core bottom in the assembly
    for (let i = 0; i < count; i++) {
      const f = ((i + 0.5) * sp.pitch) / L;
      const z = zc + zs + f * rise;
      const a = (f * turns * 2 * Math.PI) % (2 * Math.PI);
      pixels.push({ pos: [R3o * Math.cos(a), R3o * Math.sin(a), z], normal: [Math.cos(a), Math.sin(a), 0], unit: 'S7-A' });
    }

    return {
      parts,
      pixels,
      assembly: [
        { title: 'Fit the controller', parts: ['base'], hardware: 'ESP32-C3 SuperMini, 3 rubber feet', note: 'Into the base bay, USB-C out the side.' },
        { title: 'Wind the strip', parts: ['core'], hardware: `${count} px ${pixel.name}`, note: 'Lead in through the side hole, then up the helix groove, LEDs out.' },
        { title: 'Stand the core', parts: ['core', 'base'], note: 'Into the base pocket. Lead down into the bay.' },
        { title: 'Sleeve and shells', parts: ['sleeve', 'inner', 'outer'], note: 'Each into its base groove: sleeve, inner shell, outer shell.' },
        { title: 'Cap on', parts: ['cap'], hardware: 'Cord or eyebolt (optional)', note: 'All four grooves engage at once. Hang it from the centre hole if you like.' },
      ],
      schedule: [
        {
          unit: 'S7-A',
          position: `Core helix, ${turns.toFixed(1)} turns, bottom up`,
          purpose: 'Travelling colour behind the gratings',
          pixelId: pixel.id,
          units: Math.round(L),
          px: count,
          notes: `${(L / 1000).toFixed(2)} m, ${perTurn === Infinity ? 'straight' : `${perTurn.toFixed(0)} mm per turn`}. Feed from the base; LEDs face out at r ${rLed.toFixed(0)} mm.`,
        },
      ],
      hardware: [
        { item: 'ESP32-C3 SuperMini (WLED)', qty: 1, note: 'Base bay, USB-C out the side' },
        { item: 'Cord or eyebolt', qty: 1, note: 'Optional, through the cap centre to hang it' },
        { item: 'Rubber feet', qty: 3 },
      ],
      warnings,
      enclosureCm3: (Math.PI * (R3i * R3i - Rc * Rc) * Hs) / 1000,
    };
  },
};
