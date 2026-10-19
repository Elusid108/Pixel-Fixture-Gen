import type { Manifold } from 'manifold-3d';
import { FIT_PARAMS, sideOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { mul, Rx, Rz, T } from '../../geom/mat';
import { splitLinear, splitParts, splitToBed } from '../../geom/split';
import { cluster1D } from '../../graph/dedupe';
import { getPixel } from '../../pixels/library';
import type { FixtureDef, HardwareLine, PartSpec, PixelPlacement, ScheduleLine } from '../../types';
import { num, str } from '../util';
import { fmt, rng, SPLIT_PARAMS, splitCfg } from './common';

/**
 * L2 Cascade: a rain chandelier.
 *
 * A trough-section crown ring carries rows of drop tubes. Each tube is a vase-mode diffuser
 * hung from a printed hanger plug that sits in the crown floor; a strip of pixels drops down
 * inside it to the tip, so a chase reads as rain. Tube lengths follow a pattern.
 *
 * The crown splits radially on the tube pitch into keyed arcs that all print the same (the
 * four suspension lugs make a second arc shape). The lid drops onto ledges inside the trough
 * and is cut into plain arcs. Tubes longer than the printer is tall split into equal
 * segments joined by printed spigot couplers.
 *
 * Fit: plug spigots in the crown holes and inside the tubes, couplers in the tubes, the lid
 * between the trough walls and the crown's split keys all take the fit gap.
 */

export type CascadePattern = 'cone' | 'wave' | 'spiral' | 'random';

export interface Drop {
  row: number;
  k: number;
  angle: number;
  radius: number;
  length: number;
}

const ROW_PITCH = 40;
const EDGE = 22;

/** Tube layout and lengths, no kernel needed. Row 0 is outermost; each inner row has half the tubes. */
export function cascadeDrops(o: { diameter: number; rows: number; outer: number; pattern: CascadePattern; shortest: number; longest: number; seed: number }): Drop[] {
  const out: Drop[] = [];
  const r0 = o.diameter / 2 - EDGE;
  const rand = rng(o.seed);
  const span = Math.max(0, o.longest - o.shortest);
  const rMin = r0 - (o.rows - 1) * ROW_PITCH;
  for (let row = 0; row < o.rows; row++) {
    const n = Math.max(2, Math.round(o.outer / 2 ** row));
    const radius = r0 - row * ROW_PITCH;
    for (let k = 0; k < n; k++) {
      const angle = ((k + (row ? 0.5 : 0)) * 360) / n;
      let t: number;
      switch (o.pattern) {
        case 'cone':
          t = o.rows > 1 ? (r0 - radius) / (r0 - rMin) : 1;
          break;
        case 'wave':
          t = 0.5 + 0.5 * Math.sin((angle * 3 * Math.PI) / 180 + row * 0.9);
          break;
        case 'spiral':
          t = (angle / 360 + row * 0.17) % 1;
          break;
        default:
          t = rand();
      }
      out.push({ row, k, angle, radius, length: Math.round((o.shortest + span * t) / 5) * 5 });
    }
  }
  return out;
}

export const cascade: FixtureDef = {
  id: 'cascade',
  code: 'L2',
  name: 'Cascade',
  family: 'assembly',
  tagline: 'Rain chandelier. Keyed crown ring, vase-mode drop tubes, lengths by pattern.',
  description:
    'A crown ring of keyed arcs hangs rows of vase-mode diffuser tubes. A short run of strip sits at the bottom of each tube, so rain falls through the whole chandelier. Long tubes split at printed spigot couplers to fit your printer.',
  params: [
    { key: 'diameter', label: 'Crown diameter', type: 'number', default: 500, min: 360, max: 800, step: 10, unit: 'mm', group: 'Crown' },
    {
      key: 'rows',
      label: 'Rows',
      type: 'select',
      default: '2',
      options: [
        { value: '1', label: '1 row' },
        { value: '2', label: '2 rows' },
        { value: '3', label: '3 rows' },
      ],
      group: 'Crown',
      help: 'Each inner row has half the tubes of the row outside it.',
    },
    { key: 'outer', label: 'Tubes in the outer row', type: 'number', default: 16, min: 8, max: 32, step: 4, group: 'Crown' },
    {
      key: 'pattern',
      label: 'Length pattern',
      type: 'select',
      default: 'cone',
      options: [
        { value: 'cone', label: 'Cone (long in the middle)' },
        { value: 'wave', label: 'Wave' },
        { value: 'spiral', label: 'Spiral staircase' },
        { value: 'random', label: 'Random (seeded)' },
      ],
      group: 'Tubes',
    },
    { key: 'shortest', label: 'Shortest tube', type: 'number', default: 260, min: 200, max: 600, step: 10, unit: 'mm', group: 'Tubes' },
    { key: 'longest', label: 'Longest tube', type: 'number', default: 600, min: 250, max: 1200, step: 10, unit: 'mm', group: 'Tubes' },
    { key: 'seed', label: 'Random seed', type: 'number', default: 7, min: 1, max: 999, step: 1, group: 'Tubes' },
    { key: 'tubeD', label: 'Tube diameter', type: 'number', default: 25, min: 20, max: 40, step: 1, unit: 'mm', group: 'Tubes' },
    { key: 'pixel', label: 'Strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: ['strip-60-ws2812b', 'strip-60-ws2815', 'strip-30-ws2812b'], group: 'Pixels' },
    { key: 'px', label: 'Pixels per tube', type: 'number', default: 10, min: 3, max: 30, step: 1, group: 'Pixels', help: 'A short run at the bottom of each tube: the "drop".' },
    ...SPLIT_PARAMS,
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const split = splitCfg(params);
    const side = sideOf(params);
    const D = num(params, 'diameter');
    const rows = Number(str(params, 'rows'));
    const outer = num(params, 'outer');
    const pattern = str(params, 'pattern') as CascadePattern;
    const pixel = getPixel(str(params, 'pixel'));
    const pitch = pixel.shape.kind === 'strip' ? pixel.shape.pitch : 1000 / 60;
    const pxPer = num(params, 'px');
    const tubeR = num(params, 'tubeD') / 2;
    const wall = 0.8;
    const tubeIR = tubeR - wall;
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];

    const lit = pxPer * pitch;
    const spigotL = 15;
    const minLen = Math.ceil((lit + spigotL + 15) / 10) * 10;
    let shortest = num(params, 'shortest');
    let longest = Math.max(shortest, num(params, 'longest'));
    if (shortest < minLen) {
      warnings.push(`${pxPer} px of strip need tubes of at least ${minLen} mm. The shortest tube was raised to fit.`);
      shortest = minLen;
      longest = Math.max(longest, shortest);
    }
    const drops = cascadeDrops({ diameter: D, rows, outer, pattern, shortest, longest, seed: num(params, 'seed') });

    /* ---------- Crown: trough ring, floor holes for the hanger plugs, lugs ---------- */
    const rOut = D / 2;
    const rIn = Math.min(...drops.map((d) => d.radius)) - EDGE;
    const H = 30;
    const floor = 8;
    const profile: P2[] = [
      [rIn, 0],
      [rOut, 0],
      [rOut, H],
      [rOut - 4, H],
      [rOut - 4, 26],
      [rOut - 6.5, 26],
      [rOut - 6.5, 23.5],
      [rOut - 4, 21],
      [rOut - 4, floor],
      [rIn + 4, floor],
      [rIn + 4, 21],
      [rIn + 6.5, 23.5],
      [rIn + 6.5, 26],
      [rIn + 4, 26],
      [rIn + 4, H],
      [rIn, H],
    ];
    // A multiple of the outer tube count, so every crown arc is an exact copy.
    const segs = outer * Math.max(1, Math.round((D * 0.6) / outer));
    const plugR = tubeIR - side; // spigot inside the tube
    const holeR = plugR + side; // and through the crown floor
    const lugAngles = [0, 90, 180, 270];
    const lugs = lugAngles.map((a) => g.place(g.cut(g.union([g.box([rOut - 4, -8, H - 1], [rOut, 8, H + 8]), g.cylX(8, rOut - 4, rOut, 0, H + 8)]), [g.cylX(2.6, rOut - 5, rOut + 1, 0, H + 8)]), Rz(a)));
    const holes = drops.map((d) => g.place(g.cylZ(holeR, -1, floor + 1, d.radius, 0), Rz(d.angle)));
    const crown = g.cut(g.union([g.M.revolve(g.poly(profile), segs), ...lugs]), holes);
    const ztop = longest + 40;
    const crownAt = T(0, 0, ztop);
    const crownBase = { id: 'crown', name: 'Crown arc', role: 'body' as const, explode: [0, 0, 0.6] as [number, number, number], note: `Trough up. ${drops.length} hanger holes, gripple lugs on the rim.` };
    if (split.on) {
      let sp = splitToBed(g, crown, split.printer, { ...split.opts, mode: 'radial', sectors: (n) => outer % n === 0, phase: () => 180 / outer });
      if (!sp.fits) {
        // More arcs than tubes in the outer row: seams go wherever they clear the hanger holes.
        const deg = (mm: number, r: number) => (mm / r) * (180 / Math.PI);
        const avoid = [...drops.map((d) => ({ angle: d.angle, half: deg(holeR + 12, d.radius) })), ...lugAngles.map((a) => ({ angle: a, half: deg(20, rOut) }))];
        sp = splitToBed(g, crown, split.printer, { ...split.opts, mode: 'radial', sectors: (n) => n > outer, avoid });
      }
      parts.push(...splitParts(sp, crownBase, [crownAt]));
      if (!sp.fits) warnings.push('The crown does not split to fit this printer. Reduce the diameter.');
      if (sp.pins) warnings.push(`Crown joints: ${sp.pins} filament pins (1.75 mm), about ${fmt(sp.pinMm)} mm in total.`);
    } else {
      parts.push({ ...crownBase, name: 'Crown', solid: crown, instances: [crownAt] });
    }

    // Lid: a flat ring resting on the ledges, half a gap off each trough wall. Plain arcs, no keys needed.
    const lid = g.revolve(
      [
        [rIn + 4 + side, 0],
        [rOut - 4 - side, 0],
        [rOut - 4 - side, 2.4],
        [rIn + 4 + side, 2.4],
      ],
      segs,
    );
    const lidAt = T(0, 0, ztop + 26);
    const lidBase = { id: 'lid', name: 'Crown lid', role: 'body' as const, explode: [0, 0, 1.4] as [number, number, number], note: 'Rests on the trough ledges and hides the wiring.' };
    if (split.on) {
      // Seams staggered half a tube pitch from the crown's, so the lid bridges every crown joint.
      const sp = splitToBed(g, lid, split.printer, { mode: 'radial', joint: 'none', pins: false, sectors: (n) => segs % n === 0, phase: () => 180 / outer + 90 / outer });
      parts.push(...splitParts(sp, lidBase, [lidAt]));
    } else {
      parts.push({ ...lidBase, solid: lid, instances: [lidAt] });
    }

    /* ---------- Hanger plug: flange in the trough, spigot below for the tube ---------- */
    const boreR = Math.min(plugR - 1.6, 6.5);
    const zE = 3 + floor + spigotL;
    const plug = g.revolve([
      [boreR, 0],
      [holeR + 4, 0],
      [holeR + 4, 3],
      [plugR, 3],
      [plugR, zE - 0.8],
      [plugR - 0.8, zE],
      [boreR, zE],
    ]);
    // Printed flange-down; assembled flange-up in the trough, spigot hanging below the floor.
    const plugInst = drops.map((d) => mul(Rz(d.angle), T(d.radius, 0, ztop + floor + 3), Rx(180)));
    parts.push({ id: 'plug', name: 'Hanger plug', role: 'body', solid: plug, instances: plugInst, explode: [0, 0, 0.3], note: 'Flange down on the plate. The tube top slides over the spigot (glue optional); the strip drops through the bore.' });
    if (boreR < 5.5) warnings.push(`The plug bore is Ø${fmt(2 * boreR, 1)}: tight for a 10 mm strip with a connector. Use a wider tube.`);

    /* ---------- Tubes: equal segments per tube, joined by spigot couplers ---------- */
    const ridge = 3;
    const ins = 12;
    const maxSeg = split.on ? split.printer.z - 1 : Infinity;
    const plan = drops.map((d) => ({ d, ...splitLinear(d.length, maxSeg, ridge) }));
    const entries: { closed: boolean; len: number; M: number[] }[] = [];
    const couplers: number[][] = [];
    for (const { d, count, length } of plan) {
      const x = d.radius * Math.cos((d.angle * Math.PI) / 180);
      const y = d.radius * Math.sin((d.angle * Math.PI) / 180);
      // The tube's open top meets the crown floor; the plug spigot is inside it.
      const bottom = ztop - d.length;
      for (let k = 0; k < count; k++) {
        const z0 = bottom + k * (length + ridge);
        entries.push({ closed: k === 0, len: length, M: T(x, y, z0) });
        if (k > 0) couplers.push(T(x, y, z0 - ridge - ins));
      }
    }
    const segs2: { closed: boolean; len: number; inst: number[][] }[] = [];
    for (const closed of [true, false]) {
      const groups = cluster1D(
        entries.filter((e) => e.closed === closed),
        (e) => e.len,
        0.01,
      );
      for (const grp of groups) segs2.push({ closed, len: grp[0].len, inst: grp.map((e) => e.M) });
    }
    segs2.forEach((s, i) => {
      const body = s.closed ? g.cut(g.cylZ(tubeR, 0, s.len), [g.cylZ(tubeIR, 1.0, s.len + 1)]) : g.tubeZ(tubeR, tubeIR, 0, s.len);
      parts.push({
        id: `tube-${i}`,
        name: `${s.closed ? 'Drop tube' : 'Tube extension'} · ${fmt(s.len)} mm`,
        role: 'diffuser',
        solid: body,
        instances: s.inst,
        explode: [0, 0, -0.4],
        note: s.closed ? 'Spiral vase mode, natural PETG. Closed tip.' : 'Spiral vase mode with 0 bottom layers (open both ends).',
      });
    });
    if (couplers.length) {
      const coupler = g.cut(g.union([g.cylZ(plugR, 0, 2 * ins + ridge), g.cylZ(tubeR, ins, ins + ridge)]), [g.cylZ(boreR, -1, 2 * ins + ridge + 1)]);
      parts.push({ id: 'coupler', name: 'Spigot coupler', role: 'diffuser', solid: coupler, instances: couplers, explode: [0, 0, -0.2], note: 'Joins tube segments. The ridge sits flush with the tube.' });
    }

    /* ---------- Pixels: a short run at the tip of every tube, top to bottom ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const ordered = [...drops].sort((a, b) => a.row - b.row || (a.row % 2 ? b.angle - a.angle : a.angle - b.angle));
    ordered.forEach((d, i) => {
      const unit = `T${String(i + 1).padStart(2, '0')}`;
      const a = (d.angle * Math.PI) / 180;
      const dir: [number, number, number] = [Math.cos(a), Math.sin(a), 0];
      const tip = ztop - d.length + 12;
      for (let k = pxPer - 1; k >= 0; k--) {
        const z = tip + (k + 0.5) * pitch;
        pixels.push({ pos: [d.radius * dir[0] + tubeR * dir[0], d.radius * dir[1] + tubeR * dir[1], z], normal: dir, unit });
      }
      schedule.push({
        unit,
        position: `Row ${d.row + 1}, ${fmt(d.angle, 1)}°`,
        purpose: `${fmt(d.length)} mm tube`,
        pixelId: pixel.id,
        units: Math.round(lit),
        px: pxPer,
        notes: 'DIN at the top. Data returns up the tube on the third wire.',
      });
    });

    /* ---------- Paperwork ---------- */
    const total = drops.length * pxPer;
    const watts = total * pixel.wattsPerPx;
    const amps = watts / pixel.volts;
    if (pixel.volts === 5 && amps > 6)
      warnings.push(`${fmt(amps, 1)} A at 5 V full white over ${drops.length} tubes. Use WS2815 12 V strip (${fmt((total * 0.24) / 12, 1)} A): thinner feed wire, and its backup data line keeps the rain going if one pixel dies.`);
    const lens = drops.map((d) => d.length);
    warnings.push(`${drops.length} tubes from ${Math.min(...lens)} to ${Math.max(...lens)} mm (${pattern}). The lowest tip hangs ${fmt(Math.max(...lens) + 50)} mm below the crown's top.`);
    const segCount = entries.length;
    const hardware: HardwareLine[] = [
      { item: 'Gripple suspension kit (1 m)', qty: lugAngles.length, note: 'Through the crown lugs to the canopy' },
      { item: 'JST-SM 3-pin pigtail pair', qty: drops.length, note: 'One per tube so tubes unplug for service' },
      { item: '3-core 22 AWG wire', qty: Math.ceil((lens.reduce((s, l) => s + l, 0) * 1.2) / 100) / 10, note: 'Metres. Down each tube to the strip and back up' },
      { item: 'Canopy with 2-core + data feed', qty: 1, note: 'Power comes down one suspension cable' },
    ];
    if (segCount > drops.length) warnings.push(`${segCount - drops.length} tube joints: tubes longer than ${fmt(maxSeg)} mm split into equal segments on spigot couplers.`);

    const ids = (pre: string) => parts.filter((p) => p.id === pre || p.id.startsWith(`${pre}-`)).map((p) => p.id);
    const crownIds = ids('crown');
    const assembly = [
      {
        title: 'Join the crown',
        parts: crownIds,
        hardware: crownIds[0] !== 'crown' ? `${split.opts.pins ? '1.75 mm filament pins, ' : ''}CA glue` : undefined,
        note: crownIds[0] !== 'crown' ? 'Arcs drop together on their keys, trough up. Pins across each joint.' : 'Trough up.',
      },
      { title: 'Hang the crown', parts: crownIds, hardware: `${lugAngles.length} × Gripple kit`, note: 'Through the rim lugs to the canopy. Level it before the tubes go on.' },
      { title: 'Hanger plugs', parts: ['plug'], note: `${drops.length} plugs, flange up in the trough, spigot through each floor hole.` },
      { title: 'Strips into tubes', parts: ids('tube'), hardware: `${drops.length} × ${pxPer} px ${pixel.name}, JST-SM pigtails`, note: 'Feed each run down through its plug bore to the tip.' },
      ...(couplers.length ? [{ title: 'Join long tubes', parts: ['coupler', ...ids('tube')], note: 'Coupler spigots into both segments, ridge between them.' }] : []),
      { title: 'Tubes on', parts: ids('tube'), hardware: 'CA glue (optional)', note: 'Each tube up over its plug spigot to the crown floor.' },
      { title: 'Lid on', parts: ids('lid'), note: 'Arcs onto the trough ledges, seams across the crown joints.' },
    ];
    return { parts, pixels, schedule, hardware, warnings, assembly, enclosureCm3: (drops.length * Math.PI * tubeIR * tubeIR * lit) / 1000 };
  },
};
