import type { Manifold } from 'manifold-3d';
import { FIT_PARAMS, seatOf, sideOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { apply, mul, Rz, T } from '../../geom/mat';
import { splitParts, splitToBed } from '../../geom/split';
import { basis } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, HardwareLine, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { bool, num, str } from '../util';
import { fmt, SPLIT_PARAMS, splitCfg } from './common';

/**
 * L3 Gasolier: a classic candle chandelier, built the way the brass ones are, on a 1/8 IPS
 * lamp pipe. Everything threads onto the pipe: finial (on a captive nut), hub, column.
 *
 * - The column is a lathe profile (baluster, urn or bobeche stack). Every profile is clamped to
 *   45° growth so it prints upright without supports, and it splits on rim spigots when it is
 *   taller than the printer.
 * - S-arms print flat with a bridged wire channel and a dovetail tenon that drops into a slot
 *   in the hub. The hub carries the 16-pixel uplight under a diffuser ring.
 * - Each arm ends in a candle cup (bobeche + sleeve). A three-pixel wick spine stands in the
 *   sleeve and up into a vase-mode flame. Pendalogue drops hang from the bobeche rims.
 * - RGBW by default: candle flicker needs a real warm white, and RGB-mixed amber reads as fake.
 *
 * Fit: the dovetail slots are the tenon grown by half the fit gap square to every flank; cup
 * sockets, flame spigots, the uplight diffuser and split keys take the fit gap too. Pixels take
 * the seat clearance; the lamp pipe and nuts are hardware.
 */

export type ColumnStyle = 'baluster' | 'urn' | 'bobeche';

const PROFILES: Record<ColumnStyle, [number, number][]> = {
  baluster: [
    [0, 0.75],
    [0.05, 0.75],
    [0.08, 0.55],
    [0.14, 0.6],
    [0.32, 1.0],
    [0.5, 0.82],
    [0.68, 0.46],
    [0.8, 0.42],
    [0.88, 0.58],
    [0.92, 0.58],
    [0.96, 0.42],
    [1.0, 0.45],
  ],
  urn: [
    [0, 0.62],
    [0.05, 0.62],
    [0.09, 0.42],
    [0.16, 0.46],
    [0.36, 1.0],
    [0.55, 0.96],
    [0.68, 0.56],
    [0.75, 0.42],
    [0.8, 0.52],
    [0.85, 0.52],
    [0.9, 0.38],
    [1.0, 0.4],
  ],
  bobeche: [
    [0, 0.55],
    [0.08, 0.55],
    [0.12, 0.9],
    [0.15, 0.9],
    [0.17, 0.45],
    [0.36, 0.45],
    [0.4, 0.85],
    [0.43, 0.85],
    [0.45, 0.45],
    [0.64, 0.45],
    [0.68, 0.8],
    [0.71, 0.8],
    [0.73, 0.42],
    [0.95, 0.42],
    [1.0, 0.5],
  ],
};

const PIPE_R = 5.4; // 1/8 IPS lamp pipe, 10.3 mm OD
const NUT_AF = 12.9; // 1/8 IPS hex nut, 1/2" across flats

/** Column radius profile sampled every mm, clamped so it never grows faster than 45° going up. */
export function columnProfile(style: ColumnStyle, height: number): P2[] {
  const pts = PROFILES[style];
  const rmax = Math.max(26, 0.1 * height);
  const rmin = PIPE_R + 3.2;
  const f = (t: number): number => {
    // Monotone piecewise-linear with a light smoothing pass: lathe profiles want crisp coves.
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1][0] < t) i++;
    const [t0, a] = pts[i];
    const [t1, b] = pts[i + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const s = u * u * (3 - 2 * u);
    return a + (b - a) * s;
  };
  const raw: P2[] = [];
  let prev = -1;
  for (let z = 0; z <= height + 1e-9; z += 1) {
    let r = Math.max(rmin, rmax * f(z / height));
    if (prev >= 0) r = Math.min(r, prev + 1);
    raw.push([r, Math.min(z, height)]);
    prev = r;
  }
  if (raw[raw.length - 1][1] < height) raw.push([Math.min(prev + 1, rmax), height]);
  // Drop points that sit on a straight run: keeps the revolve light.
  const out: P2[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const [a, b, c] = [out[out.length - 1], raw[i], raw[i + 1]];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 0.08 * Math.hypot(c[0] - a[0], c[1] - a[1])) out.push(b);
  }
  out.push(raw[raw.length - 1]);
  return out;
}

/** Cubic Bézier sample. */
function bez(p0: P2, p1: P2, p2: P2, p3: P2, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}

/** Closed outline of a band of half-width h around an open polyline. */
function band(line: P2[], h: number): P2[] {
  const left: P2[] = [];
  const right: P2[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    left.push([line[i][0] + nx * h, line[i][1] + ny * h]);
    right.push([line[i][0] - nx * h, line[i][1] - ny * h]);
  }
  return [...left, ...right.reverse()];
}

export const gasolier: FixtureDef = {
  id: 'gasolier',
  code: 'L3',
  name: 'Gasolier',
  family: 'assembly',
  tagline: 'Lathe-turned column, keyed S-arms, RGBW candle flames, prism drops.',
  description:
    'A candle chandelier on a 1/8 IPS lamp pipe. The column is a turned profile, the S-arms key into the hub with dovetails, and each candle has three RGBW pixels in a vase-mode flame. Clear PETG pendalogues hang from the bobeches. An uplight ring washes the ceiling and a jewel in the finial lights the table.',
  params: [
    {
      key: 'arms',
      label: 'Arms',
      type: 'select',
      default: '8',
      options: [
        { value: '6', label: '6 arms' },
        { value: '8', label: '8 arms' },
        { value: '12', label: '12 arms' },
      ],
      group: 'Shape',
    },
    {
      key: 'column',
      label: 'Column profile',
      type: 'select',
      default: 'baluster',
      options: [
        { value: 'baluster', label: 'Baluster' },
        { value: 'urn', label: 'Urn' },
        { value: 'bobeche', label: 'Bobeche stack' },
      ],
      group: 'Shape',
    },
    { key: 'height', label: 'Column height', type: 'number', default: 320, min: 160, max: 560, step: 10, unit: 'mm', group: 'Shape' },
    { key: 'span', label: 'Arm reach', type: 'number', default: 180, min: 120, max: 260, step: 10, unit: 'mm', group: 'Shape' },
    { key: 'drops', label: 'Drops per arm', type: 'number', default: 1, min: 0, max: 3, step: 1, group: 'Shape' },
    { key: 'pixel', label: 'Flame pixel', type: 'pixel', default: 'pcb-9-sk6812-rgbw', pixels: ['pcb-9-sk6812-rgbw', 'pcb-9-ws2812b'], group: 'Pixels' },
    { key: 'uplight', label: 'Uplight ring (16 px)', type: 'boolean', default: true, group: 'Pixels' },
    { key: 'downlight', label: 'Finial jewel (7 px)', type: 'boolean', default: true, group: 'Pixels' },
    ...SPLIT_PARAMS,
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const split = splitCfg(params);
    const N = Number(str(params, 'arms'));
    const style = str(params, 'column') as ColumnStyle;
    const Hc = num(params, 'height');
    const L = num(params, 'span');
    const nDrops = num(params, 'drops');
    const tol = seatOf(params);
    const side = sideOf(params);
    const pixel = getPixel(str(params, 'pixel'));
    const rgbw = pixel.chPerPx === 4;
    const jewel = getPixel(rgbw ? 'jewel-7-sk6812-rgbw' : 'jewel-7-ws2812b');
    const up = bool(params, 'uplight');
    const down = bool(params, 'downlight');
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];
    const pcbR = (pixel.shape.kind === 'round' ? pixel.shape.d : 9.5) / 2;

    /* ---------- Frame: finial tip at z=0, then finial, hub, column ---------- */
    const Hf = 70;
    const hh = 24;
    const zHub = Hf;
    const zCol = zHub + hh;

    /* ---------- Arm dims and the hub slots ---------- */
    const aw = 14; // arm band width (vertical when assembled)
    const th = 14; // arm thickness (tangential)
    const dT = 9; // tenon depth
    const ta = 6; // tenon neck
    const tb = 10; // tenon tail
    const slotFloor = 4;
    const colBase = columnProfile(style, Hc)[0][0];
    const rUp = colBase + 10;
    const rh = Math.max(rUp + 8 + dT + 4, (N * (tb + 12)) / (2 * Math.PI));

    /* ---------- Hub ---------- */
    const hubBody = g.revolve([
      [PIPE_R, 0],
      [rh - 4, 0],
      [rh, 4],
      [rh, hh],
      [PIPE_R, hh],
    ]);
    const hubCuts: Manifold[] = [];
    // Wiring gallery inside the hub with a 45° roof.
    hubCuts.push(
      g.revolve([
        [PIPE_R + 3, 5],
        [rh - dT - 4, 5],
        [rh - dT - 4, hh - 13],
        [rh - dT - 9, hh - 8],
        [PIPE_R + 3, hh - 8],
      ]),
    );
    // Dovetail slot: the arm's tenon section (neck at rh + 0.5, tail at rh - dT) grown by half the
    // fit gap square to every face, open at the top so the arm drops in.
    const slot = g.extrude(
      g
        .poly([
          [rh + 0.5, -ta / 2],
          [rh + 0.5, ta / 2],
          [rh - dT, tb / 2],
          [rh - dT, -tb / 2],
        ])
        .offset(side, 'Miter'),
      slotFloor,
      hh + 1,
    );
    for (let k = 0; k < N; k++) {
      const a = (k * 360) / N;
      hubCuts.push(g.place(slot, Rz(a)));
      // Wire hole from the slot back into the gallery.
      hubCuts.push(g.place(g.cylX(3, rh - dT - 6, rh - dT + 0.5, 0, slotFloor + aw / 2), Rz(a)));
    }
    if (up) {
      hubCuts.push(g.tubeZ(rUp + 7, rUp - 7, hh - 1.6, hh + 1));
      for (let k = 0; k < 16; k++) hubCuts.push(g.place(socketCutter(g, pixel, { tol, wire: 6, over: 1 }), mul(Rz((k * 360) / 16 + 360 / 32), T(rUp, 0, hh - 1.6))));
    }
    const hub = g.cut(hubBody, hubCuts);
    parts.push({ id: 'hub', name: 'Hub', role: 'body', solid: hub, instances: [T(0, 0, zHub)], note: `${N} dovetail slots. Drill a Ø6 hole in the lamp pipe inside the gallery for the wires.` });
    if (up) {
      const ring = g.tubeZ(rUp + 7 - side, rUp - 7 + side, 0, 1.6); // the recess less the fit gap
      parts.push({ id: 'up-diffuser', name: 'Uplight diffuser ring', role: 'diffuser', solid: ring, instances: [T(0, 0, zHub + hh - 1.6)], explode: [0, 0, 1], note: 'Natural PETG, glued into the hub recess over the 16 pixels.' });
    }

    /* ---------- Column (split on rim spigots when taller than the printer) ---------- */
    const prof = columnProfile(style, Hc);
    const column = g.revolve([[PIPE_R, 0], ...prof, [PIPE_R, Hc]], 72);
    const colBaseSpec = { id: 'column', name: 'Column', role: 'body' as const, explode: [0, 0, 1.2] as Vec3, note: `${style[0].toUpperCase()}${style.slice(1)} profile, threaded on the pipe.` };
    if (split.on) parts.push(...splitParts(splitToBed(g, column, split.printer, split.opts), colBaseSpec, [T(0, 0, zCol)]));
    else parts.push({ ...colBaseSpec, solid: column, instances: [T(0, 0, zCol)] });

    /* ---------- Finial: tip down, captive nut threads it onto the pipe, jewel behind the skin ---------- */
    const finOuter = g.revolve([
      [0, 0],
      [13, 0],
      [15, 6],
      [15, 12],
      [17, 24],
      [22, 40],
      [27, 56],
      [30, 64],
      [30, Hf],
      [0, Hf],
    ]);
    const finCav = g.revolve([
      [0, 1.6],
      [12, 1.6],
      [12, 14],
      [15.4, 24],
      [20.4, 40],
      [25.4, 56],
      [28.4, 64],
      [28.4, Hf + 1],
      [0, Hf + 1],
    ]);
    const web = g.revolve([
      [PIPE_R, Hf - 20],
      [28.6, Hf - 43],
      [28.6, Hf - 39],
      [10, Hf - 6.5],
      [10, Hf],
      [PIPE_R, Hf],
    ]);
    const nutR = NUT_AF / 2 / Math.cos(Math.PI / 6);
    const finial = g.cut(g.union([g.cut(finOuter, [finCav]), web]), [
      g.cylZ(PIPE_R, Hf - 45, Hf + 1),
      g.place(g.cylZ(nutR, Hf - 6.6, Hf + 1, 0, 0, 6), Rz(30)),
      g.cylZ(2.6, Hf - 50, Hf + 1, 0, -18),
    ]);
    parts.push({ id: 'finial', name: 'Finial', role: down ? 'diffuser' : 'body', solid: finial, instances: [T(0, 0, 0)], explode: [0, 0, -1], note: 'Tip down, natural PETG. A 1/8 IPS hex nut drops into the trap; turning the finial threads it onto the pipe. The jewel sits on the 1.6 mm tip skin.' });

    /* ---------- S-arm, printed flat ---------- */
    const line: P2[] = [[0, 0], [10, 0], ...bez([10, 0], [10 + 0.42 * L, 0], [L, -0.55 * L], [L, 0.12 * L], 40).slice(1), [L, 0.12 * L + 16]];
    const end = line[line.length - 1];
    const armBand = g.extrude(g.poly(band(line, aw / 2)), 0, th);
    const tenon = g.M.hull(
      [-aw / 2, aw / 2].flatMap((y) => [
        [0.5, y, th / 2 - ta / 2] as Vec3,
        [0.5, y, th / 2 + ta / 2] as Vec3,
        [-dT, y, th / 2 - tb / 2] as Vec3,
        [-dT, y, th / 2 + tb / 2] as Vec3,
      ]),
    );
    const chanLine: P2[] = [[-dT - 1, 0], ...line, [end[0], end[1] + 1]];
    const channel = g.extrude(g.poly(band(chanLine, 2.5)), th / 2 - 2.5, th / 2 + 2.5);
    const arm = g.cut(g.union([armBand, tenon]), [channel]);
    // Print X → radial, print Y → up, print Z → tangential (centred).
    const armFrame = (k: number) => mul(Rz((k * 360) / N), T(rh, 0, zHub + slotFloor + aw / 2), basis([1, 0, 0], [0, 0, 1], [0, -1, 0]), T(0, 0, -th / 2));
    const armInst = Array.from({ length: N }, (_, k) => armFrame(k));
    const armSpec = { id: 'arm', name: 'S-arm', role: 'body' as const, explode: [0, 0, 0.2] as Vec3, note: 'Flat on the plate. The wire channel is bridged; the dovetail drops into the hub slot from above.' };
    if (split.on) parts.push(...splitParts(splitToBed(g, arm, split.printer, split.opts), armSpec, armInst));
    else parts.push({ ...armSpec, solid: arm, instances: armInst });

    /* ---------- Candle cup: arm socket, bobeche, sleeve ---------- */
    const sleeveH = 64;
    const sockD = 12; // the arm end reaches this far into the cup
    const flameR = 9.2; // flame spigot
    const boreR = flameR + side; // sleeve bore
    const cupTop = 20 + sleeveH;
    const cup = g.cut(
      g.revolve([
        [3, 0],
        [13, 0],
        [13, 8],
        [30, 25],
        [30, 28],
        [14, 20],
        [11, 20],
        [11, cupTop],
        [boreR, cupTop],
        [boreR, 16],
        [3, 16],
      ]),
      [
        // Socket over the arm end: the arm section plus the fit gap, half a gap deeper than the arm reaches.
        g.box([-aw / 2 - side, -th / 2 - side, -1], [aw / 2 + side, th / 2 + side, sockD + side]),
        ...Array.from({ length: nDrops }, (_, j) => g.place(g.cylZ(1.1, 15, 30, 26.5, 0), Rz((j - (nDrops - 1) / 2) * 50))),
      ],
    );
    const cupFrame = (k: number) => apply(armFrame(k), [end[0], end[1], th / 2]);
    const cupInst = Array.from({ length: N }, (_, k) => {
      const p = cupFrame(k);
      return mul(T(p[0], p[1], p[2] - sockD - side), Rz((k * 360) / N)); // resting on the arm end
    });
    parts.push({ id: 'cup', name: 'Candle cup', role: 'body', solid: cup, instances: cupInst, note: 'Upright. Slides over the arm end; the wire comes up the bore into the sleeve.' });

    /* ---------- Wick spine with three PCBs, and the flame ---------- */
    const s = 2 * (pcbR + 1.6);
    const ri = s / (2 * Math.sqrt(3));
    const spineH = cupTop + 24 - 16;
    const spinePts: P2[] = [0, 1, 2].map((i) => [(s / Math.sqrt(3)) * Math.cos((i * 2 * Math.PI) / 3 + Math.PI / 3), (s / Math.sqrt(3)) * Math.sin((i * 2 * Math.PI) / 3 + Math.PI / 3)]);
    const pcbZ = [cupTop + 2, cupTop + 10, cupTop + 18].map((z) => z - 16);
    const faceDirs = [0, 1, 2].map((i) => ((i * 2 * Math.PI) / 3) as number);
    const spine = g.cut(
      g.extrude(g.poly(spinePts), 0, spineH),
      faceDirs.map((a, i) => g.place(socketCutter(g, pixel, { tol, wire: 0, over: 1 }), mul(T(ri * Math.cos(a), ri * Math.sin(a), pcbZ[i]), basis([-Math.sin(a), Math.cos(a), 0], [0, 0, 1], [Math.cos(a), Math.sin(a), 0])))),
    );
    if (ri < pixel.shape.depth + 0.6) warnings.push('The wick spine is thin for these PCBs.');
    const spineInst = cupInst.map((M) => mul(M, T(0, 0, 16)));
    parts.push({ id: 'wick', name: 'Wick spine', role: 'body', solid: spine, instances: spineInst, note: `Upright. Three ${pixel.name}s on three faces at three heights: flicker moves around the flame.` });

    const flame = g.revolve([
      [8.4, 0],
      [flameR, 0],
      [flameR, 5],
      [12.2, 12],
      [12.2, 17],
      [9.5, 28],
      [5, 40],
      [0, 47],
      [0, 46.2],
      [4.3, 39.6],
      [8.7, 27.8],
      [11.4, 17],
      [11.4, 12.2],
      [8.4, 5.2],
    ]);
    const flameInst = cupInst.map((M) => mul(M, T(0, 0, cupTop - 5)));
    parts.push({ id: 'flame', name: 'Flame', role: 'diffuser', solid: flame, instances: flameInst, explode: [0, 0, 0.6], note: 'Spiral vase mode in natural PETG. The spigot pushes into the sleeve.' });

    /* ---------- Pendalogue drops ---------- */
    if (nDrops > 0) {
      const outline = g.CS.hull([g.CS.circle(9, 8).translate([0, -12]), g.CS.circle(3, 8).translate([0, 14])]);
      const drop = g.cut(g.M.hull([g.extrude(outline.offset(-2.2, 'Miter'), 0, 0.01), g.extrude(outline, 2, 4), g.extrude(outline.offset(-2.2, 'Miter'), 5.99, 6)]), [g.cylZ(1.2, -1, 7, 0, 14)]);
      const dropInst: number[][] = [];
      for (let k = 0; k < N; k++)
        for (let j = 0; j < nDrops; j++) {
          const a = (((k * 360) / N + (j - (nDrops - 1) / 2) * 50) * Math.PI) / 180;
          const cp = apply(cupInst[k], [0, 0, 0]);
          const rr = 26.5;
          const h = [cp[0] + rr * Math.cos(a), cp[1] + rr * Math.sin(a), cp[2] + 12.5] as Vec3;
          const t: Vec3 = [-Math.sin(a), Math.cos(a), 0];
          dropInst.push(mul(T(...h), basis(t, [0, 0, 1], [t[1], -t[0], 0]), T(0, -14, -3)));
        }
      parts.push({ id: 'drop', name: 'Pendalogue drop', role: 'diffuser', solid: drop, instances: dropInst, explode: [0, 0, -0.5], note: 'Clear PETG, flat. Hangs from the bobeche on a 6 mm jump ring.' });
    }

    /* ---------- Pixels in data order: uplight, flames, jewel ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    if (up) {
      for (let k = 0; k < 16; k++) {
        const a = (((k * 360) / 16 + 360 / 32) * Math.PI) / 180;
        pixels.push({ pos: [rUp * Math.cos(a), rUp * Math.sin(a), zHub + hh], normal: [0, 0, 1], unit: 'L3-UP' });
      }
      schedule.push({ unit: 'L3-UP', position: 'Hub top', purpose: 'Ceiling wash', pixelId: pixel.id, units: 16, px: 16, notes: 'Under the diffuser ring.' });
    }
    for (let k = 0; k < N; k++) {
      const unit = `L3-A${k + 1}`;
      const M = spineInst[k];
      faceDirs.forEach((a, i) => {
        const c = apply(M, [ri * Math.cos(a), ri * Math.sin(a), pcbZ[i]]);
        const c0 = apply(M, [0, 0, pcbZ[i]]);
        const d = [c[0] - c0[0], c[1] - c0[1], 0];
        const l = Math.hypot(d[0], d[1]) || 1;
        // Light reads on the flame surface, about 11 mm out from the wick.
        pixels.push({ pos: [c0[0] + (d[0] / l) * 11, c0[1] + (d[1] / l) * 11, c[2]], normal: [d[0] / l, d[1] / l, 0], unit });
      });
      schedule.push({ unit, position: `Arm ${k + 1}`, purpose: 'Candle flame: base, body, tip', pixelId: pixel.id, units: 3, px: 3, notes: 'Data out and back down the arm channel.' });
    }
    if (down) {
      const off = [
        [0, 0],
        ...Array.from({ length: 6 }, (_, i) => [7.6 * Math.cos((i * Math.PI) / 3 + Math.PI / 2), 7.6 * Math.sin((i * Math.PI) / 3 + Math.PI / 2)]),
      ];
      for (const [x, y] of off) pixels.push({ pos: [x, y, 0], normal: [0, 0, -1], unit: 'L3-DN' });
      schedule.push({ unit: 'L3-DN', position: 'Finial', purpose: 'Table downlight', pixelId: jewel.id, units: 1, px: 7, notes: 'Behind the finial tip skin.' });
    }

    /* ---------- Paperwork ---------- */
    const pipeLen = Math.ceil((Hf + hh + Hc + 60) / 25.4);
    const hardware: HardwareLine[] = [
      { item: `1/8 IPS threaded lamp pipe, ${pipeLen}″`, qty: 1, note: 'The spine: finial nut to the top loop' },
      { item: '1/8 IPS hex nut', qty: 2, note: 'One captive in the finial, one locking the column top' },
      { item: '1/8 IPS screw-collar loop + canopy', qty: 1 },
      { item: `${pixel.name}`, qty: (up ? 16 : 0) + 3 * N, note: 'Uplight and flames' },
      { item: '30 AWG silicone 3-core wire', qty: Math.ceil((N * (L * 2.4 + 200) + 600) / 100) / 10, note: 'Metres: up each arm and back' },
      { item: 'ESP32 controller (WLED, SK6812 RGBW)', qty: 1, note: 'In the canopy' },
    ];
    if (nDrops) hardware.push({ item: '6 mm jump ring', qty: N * nDrops, note: 'Drops to bobeche' });
    if (!rgbw) warnings.push('RGB-only flames: candle flicker mixed from red and green reads as fake. SK6812 RGBW gives a real warm white.');
    if (up && rgbw) warnings.push('The whole chandelier is one SK6812 RGBW line. Don’t mix RGB and RGBW pixels on one output: the byte count per pixel differs.');
    warnings.push(`About ${fmt(Hf + hh + Hc)} mm tall without the canopy chain, ${fmt(2 * (rh + L + 30))} mm across the cups.`);
    const ids = (pre: string) => parts.filter((p) => p.id === pre || p.id.startsWith(`${pre}-p`)).map((p) => p.id);
    const colIds = ids('column');
    const armIds = ids('arm');
    const assembly = [
      { title: 'Finial', parts: ['finial'], hardware: down ? `1/8 IPS hex nut, ${jewel.name}` : '1/8 IPS hex nut', note: down ? 'Jewel onto the tip skin, LEDs down. Nut into the trap.' : 'Nut into the trap.' },
      ...(up ? [{ title: 'Uplight', parts: ['hub', 'up-diffuser'], hardware: `16 × ${pixel.name}, CA glue`, note: 'PCBs into the hub top, then glue the diffuser ring into the recess.' }] : []),
      ...(colIds[0] !== 'column' ? [{ title: 'Join the column', parts: colIds, hardware: split.opts.pins ? '1.75 mm filament pins, CA glue' : 'CA glue', note: 'Stack the pieces on their rim spigots.' }] : []),
      { title: 'Thread the spine', parts: ['finial', 'hub', ...colIds], hardware: `1/8 IPS lamp pipe ${pipeLen}″, hex nut, screw-collar loop`, note: 'Pipe through hub and column. Turn the finial on underneath, lock the top with the nut and loop.' },
      { title: 'Candles', parts: ['wick', 'cup'], hardware: `${3 * N} × ${pixel.name}`, note: 'Three PCBs on each spine, one per face. Spine into the sleeve, wire down the bore.' },
      ...(armIds[0] !== 'arm' ? [{ title: 'Join the arms', parts: armIds, hardware: 'CA glue', note: 'Each arm’s pieces on their keys.' }] : []),
      { title: 'Arms', parts: [...armIds, 'cup'], hardware: '30 AWG 3-core wire', note: 'Wire up each channel. Cup over the arm end, then the dovetail drops into its hub slot.' },
      { title: 'Flames', parts: ['flame'], note: 'Spigot into the sleeve.' },
      ...(nDrops > 0 ? [{ title: 'Drops', parts: ['drop'], hardware: `${N * nDrops} × 6 mm jump ring`, note: 'Through the bobeche holes.' }] : []),
      { title: 'Hang it', hardware: 'Canopy, ESP32 controller', note: 'Loop to the canopy chain; controller in the canopy.' },
    ];
    return { parts, pixels, schedule, hardware, warnings, assembly };
  },
};
