import type { Manifold } from 'manifold-3d';
import { DEFAULT_FIT_GAP, FIT_PARAMS, fitOf, seatOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { apply, mul, Rx, Rz, T } from '../../geom/mat';
import { splitParts, splitToBed } from '../../geom/split';
import { frameZ } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { num, str } from '../util';
import { fmt, SPLIT_PARAMS, splitCfg } from './common';

/**
 * L6 Helix: a DNA pendant. Two helical backbones joined by pixel-bar base pairs, stacked in
 * 120 mm segments on a centre tube.
 *
 * - Each rung is a translucent bar with three pixel PCBs. Its hub rides the centre tube beside
 *   the bar, not through it, so the bars pass just off the axis: that offset is what opens the
 *   major and minor grooves, as in the real molecule.
 * - Backbones are twist-extruded: every horizontal slice is the same arc section, so they print
 *   upright with each layer sitting almost on the one below. One segment part serves both
 *   strands and every height (helical symmetry), so the whole pendant is four printed shapes.
 * - Rung ends rest on lugs on the backbones (45° gussets underneath) and screw down.
 *
 * Fit: bar ends clear the backbones' inner faces by half the fit gap, and split keys take the
 * gap. Pixels take the seat clearance; the Ø8 tube and filament pins are hardware.
 */

const SEG = 120;
const BAR_W = 12;
const BAR_H = 10;
const HUB_R = 6.75;
const ROD_R = 4.25; // Ø8 tube
const RIB_T = 6; // radial
const E_OFF = BAR_W / 2 + HUB_R - 1; // bar centre to the axis

export interface HelixPlan {
  Rb: number;
  xEnd: number;
  twistPerSeg: number;
  /** Angle from a rung end (+x) to its partner (-x), about the axis. */
  groove: number;
  helixAngle: number;
  rungs: { z: number; psi: number }[];
}

/** Bar-end radius: the backbone's inner face less half the fit gap. */
export const barEndR = (Rb: number, fit = DEFAULT_FIT_GAP) => Rb - RIB_T / 2 - fit / 2;

export function planHelix(o: { segments: number; span: number; pitch: number; hand: 1 | -1; fit?: number }): HelixPlan {
  const R = o.span / 2;
  const Rb = Math.hypot(R, E_OFF);
  const xEnd = Math.sqrt(barEndR(Rb, o.fit) ** 2 - E_OFF ** 2);
  const twistPerSeg = (o.hand * 360 * SEG) / o.pitch;
  const endAng = (Math.atan2(E_OFF, xEnd) * 180) / Math.PI;
  const groove = 180 - 2 * endAng;
  const theta = (z: number) => (o.hand * 360 * z) / o.pitch;
  const rungs: { z: number; psi: number }[] = [];
  for (let k = 0; k < 2 * o.segments; k++) {
    const z = 15 + 60 * k;
    rungs.push({ z, psi: theta(z + BAR_H / 2) - endAng });
  }
  return { Rb, xEnd, twistPerSeg, groove, helixAngle: (Math.atan((2 * Math.PI * Rb) / o.pitch) * 180) / Math.PI, rungs };
}

export const helix: FixtureDef = {
  id: 'helix',
  code: 'L6',
  name: 'Helix',
  family: 'assembly',
  tagline: 'DNA pendant: two helical backbones, pixel-bar base pairs, stacked on a centre tube.',
  description:
    'A double-helix pendant built from 120 mm segments on a centre tube. The base pairs are translucent pixel bars that pass just off the axis, which opens the major and minor grooves. Backbones print upright as twist extrusions and carry their own pixels. Up to 1.2 m.',
  params: [
    { key: 'segments', label: 'Segments (120 mm)', type: 'number', default: 10, min: 2, max: 10, step: 1, group: 'Shape' },
    { key: 'span', label: 'Base-pair span', type: 'number', default: 140, min: 100, max: 200, step: 5, unit: 'mm', group: 'Shape' },
    { key: 'pitch', label: 'Pitch (one turn)', type: 'number', default: 340, min: 240, max: 480, step: 10, unit: 'mm', group: 'Shape', help: 'Longer pitch means a steeper backbone: easier to print.' },
    {
      key: 'hand',
      label: 'Handedness',
      type: 'select',
      default: 'right',
      options: [
        { value: 'right', label: 'Right (B-DNA)' },
        { value: 'left', label: 'Left (Z-DNA)' },
      ],
      group: 'Shape',
    },
    { key: 'pixel', label: 'Pixel', type: 'pixel', default: 'pcb-9-ws2812b', pixels: ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw'], group: 'Pixels' },
    ...SPLIT_PARAMS,
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const split = splitCfg(params);
    const n = num(params, 'segments');
    const span = num(params, 'span');
    const pitch = num(params, 'pitch');
    const hand: 1 | -1 = str(params, 'hand') === 'left' ? -1 : 1;
    const pixel = getPixel(str(params, 'pixel'));
    const tol = seatOf(params);
    const fit = fitOf(params);
    const plan = planHelix({ segments: n, span, pitch, hand, fit });
    const { Rb, xEnd, twistPerSeg, groove, rungs } = plan;
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];
    const add = (spec: Omit<PartSpec<Manifold>, 'solid' | 'instances'>, solid: Manifold, instances: Mat4[]) => {
      if (split.on) parts.push(...splitParts(splitToBed(g, solid, split.printer, split.opts), spec, instances));
      else parts.push({ ...spec, solid, instances });
    };
    const zBase = 70; // finial below the bottom segment
    const theta = (z: number) => (hand * 360 * z) / pitch;

    /* ---------- Backbone segment: twist-extruded arc section, lugs, pixel pockets, pins ---------- */
    const vThick = 16; // vertical thickness of the ribbon where a rung meets it
    // Angular width of the section that gives that vertical thickness at this pitch.
    const arcDeg = Math.min(60, (vThick / pitch) * 360 + 2);
    const sector = (r0: number, r1: number, a0: number, a1: number): P2[] => {
      const pts: P2[] = [];
      const steps = Math.max(3, Math.ceil((a1 - a0) / 3));
      for (let i = 0; i <= steps; i++) {
        const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
        pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
      }
      for (let i = steps; i >= 0; i--) {
        const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
        pts.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
      }
      return pts;
    };
    const sec = g.poly(sector(Rb - RIB_T / 2, Rb + RIB_T / 2, -arcDeg / 2, arcDeg / 2));
    const ribbon = sec.extrude(SEG, Math.max(12, Math.ceil(Math.abs(twistPerSeg) / 3)), twistPerSeg);
    // Rung end screws sit on the ray from the axis through the bar end, so strand B (strand A
    // turned by the groove angle) meets its screw exactly too.
    const endR = Math.hypot(xEnd, E_OFF);
    const sHole = (endR - 5.5) / endR;
    const lugs: Manifold[] = [];
    const ribCuts: Manifold[] = [];
    // Rungs in segment-local heights: 15 and 75. The A strand meets each rung's +x end.
    for (const zr of [15, 75]) {
      const a = theta(zr + BAR_H / 2);
      const top = g.box([Rb - RIB_T / 2 - 11, -6, zr - 0.01], [Rb - RIB_T / 2 + 1, 6, zr]);
      const foot = g.box([Rb - RIB_T / 2 - 1, -6, zr - 11], [Rb - RIB_T / 2 + 1, 6, zr - 10.99]);
      lugs.push(g.place(g.M.hull([top, foot]), Rz(a)));
      ribCuts.push(g.place(g.cylZ(1.25, zr - 9, zr + 1, endR - 5.5, 0), Rz(a)));
    }
    // Backbone pixels at 45 and 105: pocket from the inner face, 1.4 mm skin outside.
    const pxZ = [45, 105];
    for (const zp of pxZ) {
      const a = (theta(zp) * Math.PI) / 180;
      const dir: Vec3 = [Math.cos(a), Math.sin(a), 0];
      const face: Vec3 = [dir[0] * (Rb + RIB_T / 2 - 1.4), dir[1] * (Rb + RIB_T / 2 - 1.4), zp];
      const F = frameZ(dir, [0, 0, 1], face);
      ribCuts.push(g.place(socketCutter(g, pixel, { tol, wire: 0, over: 0 }), F));
      ribCuts.push(g.place(g.cylZ(pixel.shape.kind === 'round' ? pixel.shape.d / 2 + tol : 5, -RIB_T - 2, -2), F));
    }
    // Filament pins across the butt joints between segments.
    for (const z of [0, SEG]) {
      const a = (theta(z) * Math.PI) / 180;
      ribCuts.push(g.cylZ(1.05, z - 8, z + 8, Rb * Math.cos(a), Rb * Math.sin(a)));
    }
    const backbone = g.cut(g.union([ribbon, ...lugs]), ribCuts);
    const ribInst: Mat4[] = [];
    for (let k = 0; k < n; k++) for (const off of [0, groove]) ribInst.push(mul(T(0, 0, zBase + k * SEG), Rz(k * twistPerSeg + off)));
    add({ id: 'backbone', name: 'Backbone segment', role: 'diffuser', explode: [0, 0, 0], note: 'Upright, natural PETG. Both strands, every height: one shape. Filament pins across the joints.' }, backbone, ribInst);
    if (plan.helixAngle > 55) warnings.push(`The backbone leans ${fmt(plan.helixAngle)}° from vertical: its underside is a steep overhang. A longer pitch prints cleaner.`);

    /* ---------- Rung: pixel bar with an offset hub on the tube ---------- */
    const e = E_OFF;
    // Ends trimmed round so the corners clear the backbones' inner faces.
    const bar = g.box([-xEnd, e - BAR_W / 2, 0], [xEnd, e + BAR_W / 2, BAR_H]).intersect(g.cylZ(barEndR(Rb, fit), -1, BAR_H + 1, 0, 0, 180));
    const hubC = g.cylZ(HUB_R, 0, BAR_H);
    const pxX = [-0.55 * xEnd, 0, 0.55 * xEnd];
    const rungCuts: Manifold[] = [g.cylZ(ROD_R, -1, BAR_H + 1)];
    const pcbR = (pixel.shape.kind === 'round' ? pixel.shape.d : 9.5) / 2;
    for (const x of pxX) {
      // Emitter faces down into the bar; the pocket opens at the top for fitting.
      const zf = BAR_H - pixel.shape.depth - 0.2;
      rungCuts.push(g.place(socketCutter(g, pixel, { tol, wire: 0, over: 1 }), mul(T(x, e, zf), Rx(180))), g.cylZ(pcbR + tol, zf + 1, BAR_H + 1, x, e));
    }
    rungCuts.push(g.box([-xEnd + 3, e - 1.5, BAR_H - 2], [xEnd - 3, e + 1.5, BAR_H + 1]));
    rungCuts.push(g.box([-1.5, ROD_R - 0.5, BAR_H - 2], [1.5, e, BAR_H + 1]));
    for (const sx of [-1, 1]) rungCuts.push(g.cylZ(1.7, -1, BAR_H + 1, sx * sHole * xEnd, sHole * e));
    const rung = g.cut(g.union([bar, hubC]), rungCuts);
    const rungInst = rungs.map((r) => mul(T(0, 0, zBase + r.z), Rz(r.psi)));
    add({ id: 'rung', name: 'Base-pair bar', role: 'diffuser', note: 'Flat, natural PETG, pockets up. Three PCBs face down into the bar; wires in the top groove.' }, rung, rungInst);

    /* ---------- Spacers, top cap, finial ---------- */
    const spacerL = 60 - BAR_H;
    const spacer = g.tubeZ(HUB_R, ROD_R, 0, spacerL);
    const spacerInst = rungs.slice(0, -1).map((r) => T(0, 0, zBase + r.z + BAR_H));
    if (spacerInst.length) add({ id: 'spacer', name: 'Tube spacer', role: 'body', note: 'Between rung hubs.' }, spacer, spacerInst);
    const zTop = zBase + rungs[rungs.length - 1].z + BAR_H;
    const cap = g.cut(
      g.revolve([
        [ROD_R, 0],
        [16, 0],
        [16, 14],
        [10, 26],
        [ROD_R, 26],
      ]),
      [g.cylX(3.2, -17, 17, 0, 6)],
    );
    add({ id: 'cap', name: 'Top cap', role: 'body', note: 'Cord grip above; the cable enters the tube through the side slot.' }, cap, [T(0, 0, zTop)]);
    const finial = g.cut(
      g.revolve([
        [0, 0],
        [16, 0],
        [16, 8],
        [11, 30],
        [5, 52],
        [0, 60],
      ]),
      [g.cylZ(ROD_R, -1, 32)],
    );
    // Printed wide end down, hangs point down.
    add({ id: 'finial', name: 'Finial', role: 'body', note: 'Wide end down on the plate. Pushes onto the tube end under the lowest collar.' }, finial, [mul(T(0, 0, zBase + rungs[0].z), Rx(180))]);

    /* ---------- Pixels in data order: rungs top to bottom, strand A up, strand B down ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const order = [...rungs.keys()].reverse();
    order.forEach((ri, j) => {
      const r = rungs[ri];
      const unit = `R${String(j + 1).padStart(2, '0')}`;
      const M = mul(T(0, 0, zBase + r.z), Rz(r.psi));
      const xs = j % 2 ? [...pxX].reverse() : pxX;
      for (const x of xs) pixels.push({ pos: apply(M, [x, e, 0]), normal: [0, 0, -1], unit });
      schedule.push({ unit, position: `Rung ${j + 1} from the top`, purpose: 'Base pair', pixelId: pixel.id, units: 3, px: 3, notes: j % 2 ? 'Right to left.' : 'Left to right.' });
    });
    for (const [unit, off, up] of [
      ['BA', 0, true],
      ['BB', groove, false],
    ] as [string, number, boolean][]) {
      const pts: PixelPlacement[] = [];
      for (let k = 0; k < n; k++)
        for (const zp of pxZ) {
          const a = ((k * twistPerSeg + off + theta(zp)) * Math.PI) / 180;
          const dir: Vec3 = [Math.cos(a), Math.sin(a), 0];
          pts.push({ pos: [dir[0] * (Rb + RIB_T / 2), dir[1] * (Rb + RIB_T / 2), zBase + k * SEG + zp], normal: dir, unit });
        }
      if (!up) pts.reverse();
      pixels.push(...pts);
      schedule.push({ unit, position: up ? 'Strand A' : 'Strand B', purpose: 'Backbone', pixelId: pixel.id, units: pts.length, px: pts.length, notes: up ? 'Bottom to top.' : 'Top to bottom.' });
    }

    /* ---------- Paperwork ---------- */
    const total = pixels.length;
    const lengthMm = zTop + 26;
    warnings.push(`${fmt(lengthMm)} mm from finial tip to cap, ${fmt(2 * (Rb + RIB_T / 2))} mm across. ${hand > 0 ? 'Right' : 'Left'}-handed, ${fmt(groove)}° minor groove.`);
    if ((total * pixel.wattsPerPx) / 5 > 6) warnings.push('Over 6 A at full white: inject 5 V at the bottom of the tube as well as the top.');
    const ids = (pre: string) => parts.filter((p) => p.id === pre || p.id.startsWith(`${pre}-p`)).map((p) => p.id);
    const assembly = [
      { title: 'Light the bars', parts: ids('rung'), hardware: `${rungs.length * 3} × ${pixel.name}`, note: 'Three PCBs per bar, face down into the pockets. Wires along the top groove to the hub.' },
      { title: 'Light the backbones', parts: ids('backbone'), hardware: `${4 * n} × ${pixel.name}`, note: 'One PCB per pocket from the inner face.' },
      { title: 'Finial and first collar', parts: ids('finial'), hardware: 'Ø8 tube, shaft collar', note: 'Finial onto the tube end, collar above it.' },
      { title: 'Stack the column', parts: [...ids('rung'), ...ids('spacer')], note: 'Bar hub, spacer, bar hub… up the tube. Each bar turns to meet its lugs. Wires into the tube.' },
      { title: 'Backbones', parts: ids('backbone'), hardware: `${4 * n} × M3×16 self-tapping screw, ${2 * Math.max(0, n - 1)} × 16 mm filament pin`, note: 'Segments bottom up, pinned at each joint. Screw each bar end down onto its lug.' },
      { title: 'Cap and hang', parts: ids('cap'), hardware: 'Shaft collar, cord grip, canopy', note: 'Collar on top of the stack, then the cap. Cable in through the side slot.' },
    ];
    const hardware: HardwareLine[] = [
      { item: 'Ø8 × 1 mm aluminium tube', qty: Math.ceil((lengthMm + 80) / 10) / 100, note: 'Metres. The centre rod; all wires run inside it' },
      { item: 'Ø8 mm shaft collar', qty: 2, note: 'Clamp the stack top and bottom' },
      { item: 'M3×16 pan-head self-tapping screw', qty: 4 * n, note: 'Rung ends into the backbone lugs' },
      { item: '1.75 mm filament pins', qty: 2 * Math.max(0, n - 1), note: 'Backbone joints, 16 mm' },
      { item: 'Cord grip + ceiling canopy', qty: 1 },
    ];
    return { parts, pixels, schedule, hardware, warnings, assembly };
  },
};
