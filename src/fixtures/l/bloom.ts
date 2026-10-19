import type { Manifold } from 'manifold-3d';
import { FIT_PARAMS, seatOf, sideOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { apply, mul, Rz, T } from '../../geom/mat';
import { splitParts, splitToBed } from '../../geom/split';
import { basis } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { num, str } from '../util';
import { assembledBounds, fmt, loftBand, runtimeHours, SPLIT_PARAMS, splitCfg } from './common';

/**
 * L5 Bloom: a table centrepiece that stays under the 14″ sightline, so guests still see each
 * other across the table.
 *
 * Three tiers of translucent petals key into a faceted receptacle. Each tier's sockets face
 * along that tier's petals, and each tier has its own tab width, so a petal only fits its own
 * tier. The tab is a light pipe: it stands on a pixel PCB at the bottom of the socket and
 * carries the light up into the petal. A stamen cluster over a 7-pixel jewel sits in the middle.
 *
 * It runs on two 18650 cells in the base with an ESP32, and the warnings give a runtime at
 * the average level you set.
 *
 * Fit: petal tabs drop into their sockets with the fit gap in width and thickness and stand on
 * the PCB; split keys take the gap too. PCBs and the jewel take the seat clearance.
 */

/** 14 inches. Taller than this and the centrepiece blocks the view across the table. */
export const SIGHTLINE = 355.6;

const ALPHA = [20, 40, 62];
const TAB_W = [9, 11.5, 14];
const TAB_T = 3.6;
const TAB_L = 10;
const SHELL_T = 1.2;
const BAND_L = 18;
const RT = 18;

export interface BloomTier {
  count: number;
  alpha: number;
  /** Socket centre on the receptacle surface, (r, z) in receptacle coords. */
  s: [number, number];
  length: number;
  width: number;
  tab: number;
  phase: number;
}

const TIER_COUNTS: Record<string, number[]> = { '6/8/10': [6, 8, 10], '5/7/9': [5, 7, 9], '4/6/8': [4, 6, 8] };

export function bloomTiers(counts: string, height: number, printerZ: number): { tiers: BloomTier[]; zt: number; base: number; clamped: boolean; capped: boolean } {
  const n = TIER_COUNTS[counts] ?? TIER_COUNTS['6/8/10'];
  const base = 39;
  // Receptacle profile: faces perpendicular to each tier's petals, from the top flat down.
  const pts: P2[] = [[RT, 0]];
  for (const a of ALPHA) {
    const r = (a * Math.PI) / 180;
    const [x, y] = pts[pts.length - 1];
    pts.push([x + BAND_L * Math.cos(r), y - BAND_L * Math.sin(r)]);
  }
  const drop = -pts[3][1];
  const zt = drop + 12;
  const s = ALPHA.map((a, k): [number, number] => {
    const r = (a * Math.PI) / 180;
    return [pts[k][0] + (BAND_L / 2) * Math.cos(r), zt + pts[k][1] - (BAND_L / 2) * Math.sin(r)];
  });
  // Under the sightline with a little margin, and no taller than the printer can print a petal.
  const target = Math.min(height, SIGHTLINE - 5);
  const capped = height > SIGHTLINE - 5;
  const a1 = (ALPHA[0] * Math.PI) / 180;
  let L1 = (target - base - s[0][1]) / Math.cos(a1) - 2;
  const maxL = printerZ - TAB_L - 1;
  const clamped = L1 > maxL;
  L1 = Math.max(60, Math.min(L1, maxL));
  const tiers = ALPHA.map((a, k) => ({
    count: n[k],
    alpha: a,
    s: s[k],
    length: Math.round(L1 * [1, 0.92, 0.84][k]),
    width: [30, 38, 46][k],
    tab: TAB_W[k],
    phase: [0, 0.5, 0.25][k],
  }));
  return { tiers, zt, base, clamped, capped };
}

export const bloom: FixtureDef = {
  id: 'bloom',
  code: 'L5',
  name: 'Bloom',
  family: 'assembly',
  tagline: 'Below-sightline table centrepiece: three tiers of keyed petals on a battery base.',
  description:
    'Translucent petals key into a faceted receptacle in three tiers, each lit through its tab from a pixel underneath. A stamen cluster glows over a jewel in the middle. Two 18650 cells and an ESP32 in the base run it cordless for a dinner service; the height is held under the 14″ sightline.',
  params: [
    {
      key: 'tiers',
      label: 'Petals per tier',
      type: 'select',
      default: '6/8/10',
      options: Object.keys(TIER_COUNTS).map((k) => ({ value: k, label: `${k} (inner/middle/outer)` })),
      group: 'Shape',
    },
    { key: 'height', label: 'Overall height', type: 'number', default: 260, min: 160, max: 355, step: 5, unit: 'mm', group: 'Shape', help: 'Capped under the 14″ (355 mm) sightline.' },
    { key: 'pixel', label: 'Petal pixel', type: 'pixel', default: 'pcb-9-ws2812b', pixels: ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw'], group: 'Pixels' },
    { key: 'mah', label: '18650 capacity', type: 'number', default: 3000, min: 2000, max: 3500, step: 100, unit: 'mAh', group: 'Battery' },
    { key: 'level', label: 'Average level', type: 'number', default: 20, min: 5, max: 100, step: 5, unit: '%', group: 'Battery', help: 'Average brightness across the evening, for the runtime estimate.' },
    ...SPLIT_PARAMS,
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const split = splitCfg(params);
    const pixel = getPixel(str(params, 'pixel'));
    const jewel = getPixel(pixel.chPerPx === 4 ? 'jewel-7-sk6812-rgbw' : 'jewel-7-ws2812b');
    const tol = seatOf(params);
    const side = sideOf(params);
    const plan = bloomTiers(str(params, 'tiers'), num(params, 'height'), split.printer.z);
    const { tiers, zt, base } = plan;
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];
    const add = (spec: Omit<PartSpec<Manifold>, 'solid' | 'instances'>, solid: Manifold, instances: Mat4[]) => {
      if (split.on) parts.push(...splitParts(splitToBed(g, solid, split.printer, split.opts), spec, instances));
      else parts.push({ ...spec, solid, instances });
    };

    /* ---------- Battery base: tray + lid ---------- */
    const Rb = 75;
    const trayH = 36;
    const lidT = base - trayH;
    const bosses = [45, 135, 225, 315].map((a) => g.place(g.cylZ(4.5, 0, trayH - 0.01, Rb - 9, 0), Rz(a)));
    const tray = g.cut(g.union([g.cut(g.cylZ(Rb, 0, trayH), [g.cylZ(Rb - 2.4, 2.4, trayH + 1)]), ...bosses]), [
      ...[45, 135, 225, 315].map((a) => g.place(g.heatSet(3).translate([Rb - 9, 0, trayH]), Rz(a))),
      g.box([Rb - 4, -4.75, 6], [Rb + 1, 4.75, 9.75]), // USB-C charge port
      g.cylX(6.1, -Rb - 1, -Rb + 4, 0, 18), // 12 mm latching switch
      ...[0, 90, 180, 270].map((a) => g.place(g.cylZ(5.2, -1, 1, Rb - 16, 0), Rz(a + 45))), // rubber feet
    ]);
    add({ id: 'tray', name: 'Battery tray', role: 'body', note: '2×18650 holder, USB-C charge/boost board and an ESP32-C3 inside. USB-C slot and switch hole in the wall.' }, tray, [T(0, 0, 0)]);
    const lid = g.cut(g.cylZ(Rb, 0, lidT), [
      ...[45, 135, 225, 315].map((a) => g.place(g.union([g.cylZ(1.7, -1, lidT + 1, Rb - 9, 0), g.coneZ(1.7, 3.4, lidT - 1.7, lidT + 0.01, Rb - 9, 0)]), Rz(a))),
      ...[30, 150, 270].map((a) => g.place(g.cylZ(1.7, -1, lidT + 1, 48, 0), Rz(a))),
      g.cylZ(6, -1, lidT + 1),
    ]);
    add({ id: 'lid', name: 'Base lid', role: 'body' }, lid, [T(0, 0, trayH)]);

    /* ---------- Receptacle ---------- */
    const prof: P2[] = [[RT, zt]];
    for (const a of ALPHA) {
      const r = (a * Math.PI) / 180;
      const [x, y] = prof[prof.length - 1];
      prof.push([x + BAND_L * Math.cos(r), y - BAND_L * Math.sin(r)]);
    }
    const rBase = prof[3][0];
    const body = g.revolve([[0, 0], [rBase, 0], ...prof.slice().reverse(), [0, zt]]);
    const cavity = g.revolve([
      [0, -1],
      [40, -1],
      [40, 6],
      [6, 40],
      [0, 40],
    ]);
    const cuts: Manifold[] = [cavity];
    const socketFrame = (t: BloomTier, k: number): Mat4 => {
      const a = (t.alpha * Math.PI) / 180;
      const th = ((k + t.phase) * 360) / t.count;
      return mul(Rz(th), basis([0, 1, 0], [-Math.cos(a), 0, Math.sin(a)], [Math.sin(a), 0, Math.cos(a)], [t.s[0], 0, t.s[1]]));
    };
    for (const t of tiers)
      for (let k = 0; k < t.count; k++) {
        const F = socketFrame(t, k);
        cuts.push(g.place(g.box([-t.tab / 2 - side, -TAB_T / 2 - side, -TAB_L], [t.tab / 2 + side, TAB_T / 2 + side, 3]), F));
        cuts.push(g.place(socketCutter(g, pixel, { tol, wire: 0, over: 0.5 }), mul(F, T(0, 0, -TAB_L))));
        cuts.push(g.place(g.cylZ(1.6, -TAB_L - 24, -TAB_L - 2), F));
      }
    cuts.push(g.place(socketCutter(g, jewel, { tol, wire: 8, over: 0.5 }), T(0, 0, zt)));
    cuts.push(...[30, 150, 270].map((a) => g.place(g.cylZ(1.25, -1, 9, 48, 0), Rz(a))));
    const receptacle = g.cut(body, cuts);
    add({ id: 'receptacle', name: 'Receptacle', role: 'body', note: 'Upright. Three tiers of keyed sockets; a pixel PCB sits at the bottom of each.' }, receptacle, [T(0, 0, base)]);
    if (rBase > 60) warnings.push('The receptacle is wider than the lid screws allow.');

    /* ---------- Stamen cluster over the jewel ---------- */
    const filaments: Manifold[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i * 2 * Math.PI) / 6;
      const r0 = i ? 5 : 0;
      const h = i ? 18 + (i % 3) * 4 : 28;
      const lean = i ? 0.25 : 0;
      const p0: Vec3 = [r0 * Math.cos(a), r0 * Math.sin(a), 9];
      const p1: Vec3 = [p0[0] + lean * h * Math.cos(a), p0[1] + lean * h * Math.sin(a), 10 + h];
      filaments.push(g.M.hull([g.cylZ(1.4, p0[2], p0[2] + 0.1, p0[0], p0[1]), g.cylZ(1.4, p1[2] - 0.1, p1[2], p1[0], p1[1])]));
      filaments.push(g.union([g.coneZ(1.2, 2.6, p1[2] - 1.4, p1[2] + 0.5, p1[0], p1[1]), g.coneZ(2.6, 0.6, p1[2] + 0.5, p1[2] + 2.5, p1[0], p1[1])]));
    }
    const stamen = g.union([g.cylZ(17, 0, 2.5), g.coneZ(17, 8, 2.4, 10), ...filaments]);
    add({ id: 'stamen', name: 'Stamen cluster', role: 'diffuser', note: 'Natural PETG, upright. Glue it over the jewel.' }, stamen, [T(0, 0, base + zt)]);

    /* ---------- Petals: lofted cupped shells on a light-pipe tab ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const jewelOff = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [7.6 * Math.cos((i * Math.PI) / 3 + Math.PI / 2), 7.6 * Math.sin((i * Math.PI) / 3 + Math.PI / 2)])];
    for (const [x, y] of jewelOff) pixels.push({ pos: [x, y, base + zt + 10], normal: [0, 0, 1], unit: 'L5-C' });
    schedule.push({ unit: 'L5-C', position: 'Centre', purpose: 'Stamens', pixelId: jewel.id, units: 1, px: 7, notes: 'Jewel under the stamen cluster.' });

    tiers.forEach((t, ti) => {
      const Rc = t.width * 0.8;
      const layers: Vec3[][] = [];
      const K = 28;
      const NP = 13;
      for (let j = 0; j <= K; j++) {
        const u = j / K;
        // Width: from just over the tab, out to full at 55%, to a soft point.
        const w = u < 0.55 ? t.tab + 3 + (t.width - t.tab - 3) * Math.sin(((u / 0.55) * Math.PI) / 2) : 3 + (t.width - 3) * Math.cos((((u - 0.55) / 0.45) * Math.PI) / 2);
        const phi = Math.asin(Math.min(0.95, w / 2 / Rc));
        const lean = -0.22 * t.length * u * u;
        const z = TAB_L + 1.2 + u * t.length;
        const outer: Vec3[] = [];
        const inner: Vec3[] = [];
        for (let i = 0; i < NP; i++) {
          const b = -phi + (2 * phi * i) / (NP - 1);
          outer.push([Rc * Math.sin(b), lean + Rc * (1 - Math.cos(b)) - TAB_T / 2, z]);
          inner.push([(Rc - SHELL_T) * Math.sin(b), lean + Rc - (Rc - SHELL_T) * Math.cos(b) - TAB_T / 2, z]);
        }
        layers.push([...outer, ...inner.reverse()]);
      }
      const shell = loftBand(ctx, layers);
      const tab = g.box([-t.tab / 2, -TAB_T / 2, 0], [t.tab / 2, TAB_T / 2, TAB_L + 1.6]);
      const petal = g.union([shell, tab]);
      const inst = Array.from({ length: t.count }, (_, k) => mul(T(0, 0, base), socketFrame(t, k), T(0, 0, -TAB_L)));
      add(
        { id: `petal-${ti + 1}`, name: `Petal · tier ${ti + 1}`, role: 'diffuser', note: `Natural PETG, standing on its tab. ${fmt(t.tab, 1)} mm tab: fits tier ${ti + 1} only.` },
        petal,
        inst,
      );
      const unit = `L5-T${ti + 1}`;
      for (const M of inst) {
        const p = apply(M, [0, -TAB_T / 2, TAB_L + 14]);
        const q = apply(M, [0, -TAB_T / 2 - 1, TAB_L + 14]);
        const n: Vec3 = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        pixels.push({ pos: q, normal: [-n[0], -n[1], -n[2]], unit });
      }
      schedule.push({ unit, position: ['Inner tier', 'Middle tier', 'Outer tier'][ti], purpose: `${t.count} petals`, pixelId: pixel.id, units: t.count, px: t.count, notes: `${t.alpha}° from vertical, ${t.length} mm petals.` });
    });

    /* ---------- Height check, runtime, paperwork ---------- */
    const box = assembledBounds(parts);
    const height = box.max[2] - box.min[2];
    if (plan.capped) warnings.push(`Height held to ${fmt(SIGHTLINE - 5)} mm: a centrepiece over 14″ (${fmt(SIGHTLINE)} mm) blocks the view across the table.`);
    if (plan.clamped) warnings.push(`Petals are limited to ${fmt(split.printer.z - TAB_L - 1)} mm by your printer's height, so the bloom stands ${fmt(height)} mm.`);
    if (height > SIGHTLINE) warnings.push(`At ${fmt(height)} mm this is over the 14″ sightline.`);
    const px = 7 + tiers.reduce((s, t) => s + t.count, 0);
    const level = num(params, 'level') / 100;
    const mah = num(params, 'mah');
    const rt = runtimeHours({ cells: 2, mAh: mah, px, wattsPerPx: pixel.wattsPerPx, level });
    const rtQuiet = runtimeHours({ cells: 2, mAh: mah, px, wattsPerPx: pixel.wattsPerPx, level, controllerW: 0.15 });
    warnings.push(
      `Runtime about ${rt.hours.toFixed(1)} h at ${fmt(level * 100)}% average (${rt.watts.toFixed(1)} W from ${rt.wh.toFixed(0)} Wh usable). With Wi-Fi off (buttons or ESP-NOW) about ${rtQuiet.hours.toFixed(1)} h.`,
    );
    const peakA = (px * pixel.wattsPerPx) / 5;
    if (peakA > 2) warnings.push(`Full white draws ${peakA.toFixed(1)} A; set WLED's current limiter to 2 A for the boost board.`);
    warnings.push(`${fmt(height)} mm tall, ${fmt(box.max[0] - box.min[0])} mm across.`);

    const ids = (pre: string) => parts.filter((p) => p.id === pre || p.id.startsWith(`${pre}-p`)).map((p) => p.id);
    const assembly = [
      { title: 'Inserts', parts: ids('tray'), hardware: '4 × M3 heat-set insert', note: 'Into the four tray bosses.' },
      { title: 'Light the receptacle', parts: ids('receptacle'), hardware: `${px - 7} × ${pixel.name}, ${jewel.name}`, note: 'One PCB face up at the bottom of each petal socket, jewel on top. Wires out the holes underneath.' },
      { title: 'Receptacle on the lid', parts: [...ids('receptacle'), ...ids('lid')], hardware: '3 × M3×10 pan-head self-tapping screw', note: 'From below, through the lid. Leads down the centre hole.' },
      { title: 'Fill the tray', parts: ids('tray'), hardware: '2 × 18650, holder, IP5306 board, ESP32-C3, 12 mm switch, 4 rubber feet', note: 'USB-C to the wall slot, switch in its hole. Feet on.' },
      { title: 'Close the base', parts: [...ids('lid'), ...ids('tray')], hardware: '4 × M3×8 countersunk screw', note: 'Lid onto the tray.' },
      { title: 'Stamens', parts: ids('stamen'), hardware: 'CA glue', note: 'Over the jewel.' },
      { title: 'Petals', parts: tiers.flatMap((_, ti) => ids(`petal-${ti + 1}`)), note: 'Inner tier first. Each tab only fits its own tier; it stands on the PCB.' },
    ];
    const hardware: HardwareLine[] = [
      { item: '18650 cell (protected, flat top)', qty: 2, note: `${mah} mAh, in parallel` },
      { item: '2×18650 parallel holder', qty: 1 },
      { item: 'IP5306 USB-C charge + 5 V boost board', qty: 1, note: '2.4 A out' },
      { item: 'ESP32-C3 SuperMini (WLED)', qty: 1 },
      { item: '12 mm latching push switch', qty: 1 },
      { item: 'M3 heat-set insert', qty: 4, note: 'Tray bosses' },
      { item: 'M3×8 countersunk screw', qty: 4, note: 'Lid to tray' },
      { item: 'M3×10 pan-head self-tapping screw', qty: 3, note: 'Lid into the receptacle, from below' },
      { item: 'Ø10 mm rubber foot', qty: 4 },
    ];
    return { parts, pixels, schedule, hardware, warnings, assembly };
  },
};
