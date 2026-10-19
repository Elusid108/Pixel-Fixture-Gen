import { FIT_PARAMS } from '../../fit';
import { Geo } from '../../geom/geo';
import { norm, scale } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import type { FixtureDef, HardwareLine, ScheduleLine } from '../../types';
import { num, str } from '../util';
import { fmt, geodesic, massG, SPLIT_PARAMS, splitCfg } from './common';
import {
  ACCENT_PCBS,
  accentParam,
  buildCappedShell,
  capHardware,
  crownAssembly,
  crownHardware,
  faceLine,
  facePixels,
  fmtGap,
  leadWarning,
  optPixel,
  planShell,
  starLine,
  starPixels,
  type ShellPlan,
} from './shell';

/**
 * L1 The Orb: a geodesic sphere, one lit panel per face and a star at every vertex.
 *
 * Two pixel types. Every face is a light box: a flat diffuser, skirts in the planes through the
 * sphere's centre so neighbours butt flush, and a 45° funnel (support-free, face down on the
 * plate) up to a collar that holds one 12 mm node aimed back at the face. Every vertex cap
 * carries the second pixel: a Ø9.5 mm PCB (or a jewel) in its spigot, shining out through a
 * printed lens. Run faces and stars as two looks, or set the stars to none.
 *
 * Panels join at the vertices from the outside (see shell.ts): each cap's spigot drops into the
 * round corner hole the panels leave, with the fit gap, and screws into their corner bosses.
 * Nothing has to be reached from inside, so the last panel goes on as easily as the first.
 *
 * The top vertex gets the crown: a 1/8 IPS nipple through the crown and the panel corners,
 * locked by a nut and fender washer on the inside, so the shell hangs from the pipe in
 * compression on the corner bosses. Power comes down the hoist chain and in through the pipe.
 */

export type OrbPlan = ShellPlan & { R: number };

/** Geometry and dedupe for an orb, no kernel needed. */
export function planOrb(freq: number, diameter: number): OrbPlan {
  const R = diameter / 2;
  const geo = geodesic(freq);
  const plan = planShell({ points: geo.verts.map((u) => scale(u, R)), faces: geo.faces, spoke: (p) => scale(norm(p), -1), crown: true, size: R });
  return { ...plan, R };
}

export const orb: FixtureDef = {
  id: 'orb',
  code: 'L1',
  name: 'The Orb',
  family: 'assembly',
  tagline: 'Geodesic sphere: a lit panel per face and a star in every vertex cap, identical parts deduped into print counts.',
  description:
    'A hanging geodesic sphere with two pixel types. Every face is a printed light box with one 12 mm node; every vertex cap holds a Ø9.5 mm PCB behind a little lens. The panels join from the outside with the vertex caps, so the whole shell closes without reaching in. The crown hangs it on a 1/8 IPS nipple and brings power down the hoist chain.',
  params: [
    {
      key: 'freq',
      label: 'Frequency',
      type: 'select',
      default: '3',
      options: [
        { value: '2', label: '2V · 80 faces' },
        { value: '3', label: '3V · 180 faces' },
        { value: '4', label: '4V · 320 faces' },
      ],
      group: 'Shape',
    },
    { key: 'diameter', label: 'Diameter', type: 'number', default: 500, min: 300, max: 900, step: 10, unit: 'mm', group: 'Shape' },
    { key: 'pixel', label: 'Face node', type: 'pixel', default: 'node-12-bullet', pixels: ['node-12-bullet', 'node-12-bullet-12v'], group: 'Pixels' },
    accentParam('accent', 'Vertex star', ACCENT_PCBS, 'pcb-9-ws2812b', 'Second pixel type: a PCB in every vertex cap behind a printed lens. None leaves plain caps.'),
    ...FIT_PARAMS,
    ...SPLIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const freq = Number(str(params, 'freq'));
    const D = num(params, 'diameter');
    const pixel = getPixel(str(params, 'pixel'));
    const accent = optPixel(params, 'accent');
    const plan = planOrb(freq, D);
    const warnings: string[] = [];

    const sh = buildCappedShell(g, plan, { params, split: splitCfg(params), facePixel: pixel, accent, crown: true });
    const { parts, j } = sh;

    // Faces by latitude band, then the stars: two units, each in data order.
    const pixels = [...facePixels(plan, pixel, 'L1-F'), ...starPixels(plan, accent, 'L1-V')];
    const schedule: ScheduleLine[] = [faceLine(plan, pixel, 'L1-F', 'Face panels, top band first, serpentine')];
    if (accent) schedule.push(starLine(plan, accent, 'L1-V', true));

    const F = plan.faces.length;
    const stars = plan.vertOrder.length;
    const hardware: HardwareLine[] = [...capHardware(plan, accent), ...crownHardware(pixel)];
    if (sh.splitPins) hardware.push({ item: '1.75 mm filament pins', qty: sh.splitPins, note: 'For split panels' });

    const faceW = F * pixel.wattsPerPx;
    const starW = accent ? stars * accent.pxPerUnit * accent.wattsPerPx : 0;
    const amps5 = (pixel.volts === 5 ? faceW : 0) / 5 + starW / 5;
    if (amps5 > 8)
      warnings.push(`${amps5.toFixed(1)} A at 5 V full white${accent ? ` (faces ${fmt(faceW)} W + stars ${fmt(starW)} W)` : ''} is a lot to send down a hoist line. Use the 12 V nodes, cap the brightness in WLED, or put the 5 V supply inside the orb.`);
    if (accent && pixel.volts === 12) warnings.push(`The stars are 5 V PCBs and the faces 12 V nodes: two supplies, or a 12→5 V buck inside the orb for ${fmt(starW)} W of stars.`);
    const lead = leadWarning(plan, pixel);
    if (lead) warnings.push(lead);
    if (plan.minEdge < 40) warnings.push(`Faces are small (${fmt(plan.minEdge)} mm edges) for 12 mm nodes. Go up in diameter or down a frequency.`);
    if (sh.tight) warnings.push(`Vertex caps are crowded at ${freq}V Ø${D}: the ${accent?.name ?? 'cap'} joint wants more corner than ${fmt(plan.minEdge)} mm edges leave. Go up in diameter or down a frequency.`);
    if (sh.splitPieces) warnings.push(`${sh.splitPieces} panel pieces: the ${freq}V faces are bigger than your bed at Ø${D} and were split with keyed joints. 3V or 4V keeps every panel whole.`);
    const totalKg = (massG(parts) + F * 6 + stars * 2) / 1000;
    warnings.push(
      `Weight: about ${totalKg.toFixed(1)} kg printed in PETG with pixels. It hangs on the 1/8 IPS nipple, which bears on the five top corner bosses through the washer.${totalKg > 4 ? ' That is heavy for printed bosses: add a steel safety cable from the loop to a bottom washer.' : ''}`,
    );
    warnings.push(
      `${plan.faceClasses.length} panel shapes (${plan.faceClasses.map((c) => `${c.id} ×${c.members.length}`).join(', ')}) and ${plan.vertexClasses.length - 1} cap shapes for ${plan.verts.length - 1} vertices. Label the bags: mixing shapes up is the classic geodesic mistake.`,
    );
    warnings.push(`Fit gap ${fmtGap(j.fit)}: cap spigots Ø${fmt(2 * j.spigR, 1)} into Ø${fmt(2 * j.holeR, 1)} corner holes; panel skirts stand ${fmtGap(j.side)} back from every seam.`);

    return { parts, pixels, schedule, hardware, warnings, assembly: crownAssembly(plan, parts, j, pixel, accent), enclosureCm3: (4 / 3) * Math.PI * (plan.R / 10) ** 3 };
  },
};
