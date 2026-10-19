import { FIT_PARAMS, seatOf, sideOf } from '../../fit';
import { Geo } from '../../geom/geo';
import { dot, frameZ, norm, scale } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import type { AssemblyStep, FixtureDef, HardwareLine, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { num, str } from '../util';
import { fmt, geodesic, massG, SPLIT_PARAMS, splitCfg } from './common';
import {
  bandParts,
  bandStrip,
  buildBand,
  buildCappedShell,
  capHardware,
  faceLine,
  facePixels,
  fmtGap,
  grooveReach,
  ids,
  leadWarning,
  LIP,
  optPixel,
  pixelOptions,
  planShell,
  SKIRT_D,
  stripSlot,
  TONGUE_T,
  tongueSolid,
  type BandSpec,
  type FaceLine,
  type ShellPlan,
} from './shell';

/**
 * L7 Dome: a geodesic hemisphere on a flat base ring, for a table centrepiece or a ceiling.
 *
 * Even frequencies only: 2V and 4V have a ring of edges on the equator, so the dome stands flat.
 * The panels and vertex caps are the Orb's (see shell.ts). The bottom row of panels carries its
 * face plate on past the equator as a tongue into a groove in the base ring, and the vertices on
 * the rim get half caps that sit on the ring.
 *
 * The base ring is the second pixel type: a strip runs round it in a slot behind a 1.2 mm
 * diffuser lip, loaded from underneath, so the dome sits on a glowing line. A PG7 cable gland
 * through the ring brings power in at table level; for a ceiling the cable comes straight down
 * through the open ring.
 */

export type DomePlan = ShellPlan & { R: number; n: number; theta0: number; lines: FaceLine[] };

const EPS = 1e-6;

/** Faces above the equator of a vertex-up geodesic sphere, and the equator polygon. */
export function planDome(freq: number, diameter: number): DomePlan {
  const R = diameter / 2;
  const geo = geodesic(freq);
  const keep = geo.faces.filter((f) => f.reduce((s, i) => s + geo.verts[i][2], 0) > EPS);
  const used = [...new Set(keep.flat())].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  const points = used.map((i) => scale(geo.verts[i], R));
  const plan = planShell({
    points,
    faces: keep.map((f) => f.map((i) => remap.get(i)!)),
    spoke: (p) => scale(norm(p), -1),
    tongue: (a, b) => Math.abs(a[2]) < EPS * R && Math.abs(b[2]) < EPS * R,
    size: R,
  });
  const rim = points.filter((p) => Math.abs(p[2]) < EPS * R);
  const n = rim.length;
  const theta0 = Math.min(...rim.map((p) => ((Math.atan2(p[1], p[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)));
  // The face line of the rim panel standing on each side of the equator polygon.
  const lines: FaceLine[] = Array.from({ length: n }, () => ({ a0: R * Math.cos(Math.PI / n), z0: 0, s: 0 }));
  for (const f of plan.faces)
    f.edges.forEach((k, e) => {
      if (k !== 'tongue') return;
      const i = sideOf_(f.pts[e], f.pts[(e + 1) % f.pts.length], n, theta0);
      const nu = sideNormal(i, n, theta0);
      lines[i] = { a0: R * Math.cos(Math.PI / n), z0: 0, s: -f.n[2] / dot(f.n, nu) };
    });
  return { ...plan, R, n, theta0, lines };
}

const sideNormal = (i: number, n: number, theta0: number): Vec3 => {
  const phi = theta0 + ((2 * i + 1) * Math.PI) / n;
  return [Math.cos(phi), Math.sin(phi), 0];
};

/** Which side of the polygon an edge (by its midpoint) lies on. */
function sideOf_(a: Vec3, b: Vec3, n: number, theta0: number): number {
  const phi = Math.atan2((a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
  const k = Math.floor((((phi - theta0) % (2 * Math.PI)) + 4 * Math.PI) % (2 * Math.PI) / ((2 * Math.PI) / n));
  return ((k % n) + n) % n;
}

const STRIPS = ['strip-60-ws2812b', 'strip-30-ws2812b', 'strip-144-ws2812b', 'strip-60-ws2815', 'strip-30-ws2815'];

export const dome: FixtureDef = {
  id: 'dome',
  code: 'L7',
  name: 'Dome',
  family: 'assembly',
  tagline: 'Geodesic hemisphere on a glowing base ring: nodes in the panels, a strip round the rim.',
  description:
    'Half an Orb standing on a flat ring, for a table centrepiece or a ceiling. Every face is a printed light box with a 12 mm node, joined at the vertices by caps from the outside. The base ring is the second pixel type: a strip runs round it behind a thin diffuser lip, and a cable gland brings the power in. 2V or 4V, so the rim is a flat ring of edges.',
  params: [
    {
      key: 'freq',
      label: 'Frequency',
      type: 'select',
      default: '2',
      options: [
        { value: '2', label: '2V · 40 faces' },
        { value: '4', label: '4V · 160 faces' },
      ],
      group: 'Shape',
      help: 'Even frequencies have an equator of edges, so the dome stands flat.',
    },
    { key: 'diameter', label: 'Diameter', type: 'number', default: 500, min: 300, max: 900, step: 10, unit: 'mm', group: 'Shape' },
    { key: 'pixel', label: 'Face node', type: 'pixel', default: 'node-12-bullet', pixels: ['node-12-bullet', 'node-12-bullet-12v'], group: 'Pixels' },
    { key: 'strip', label: 'Rim strip', type: 'select', default: 'strip-60-ws2812b', options: pixelOptions(STRIPS, 'None'), group: 'Pixels', help: 'Second pixel type: a strip round the base ring. None leaves a plain ring.' },
    ...FIT_PARAMS,
    ...SPLIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const freq = Number(str(params, 'freq'));
    const D = num(params, 'diameter');
    const pixel = getPixel(str(params, 'pixel'));
    const strip = optPixel(params, 'strip');
    const split = splitCfg(params);
    const side = sideOf(params);
    const seat = seatOf(params);
    const plan = planDome(freq, D);
    const { R, n, theta0, lines } = plan;
    const warnings: string[] = [];

    /* ---------- Panels and caps; the rim panels' tongues run into the base ring ---------- */
    const band0 = { n, theta0, side };
    const sh = buildCappedShell(g, plan, {
      params,
      split,
      facePixel: pixel,
      accent: null,
      crown: false,
      tongue: (f, e) => {
        const i = sideOf_(f.pts[e], f.pts[(e + 1) % f.pts.length], n, theta0);
        return tongueSolid(g, band0, i, lines[i], -1, R);
      },
      rimKeep: g.box([-4000, -4000, 0], [4000, 4000, 4000]),
    });
    const { parts, j } = sh;

    /* ---------- Base ring ---------- */
    const slot = stripSlot(strip, seat);
    const glandR = 6.25; // PG7 gland, M12 thread: hardware size
    const groove = Math.max(...lines.map((L) => grooveReach(L, -1, side)));
    const aOut = groove + (slot ? 1.2 + slot.w + LIP : 2.4);
    const a0 = lines[0].a0;
    const mountA = a0 - TONGUE_T - side - SKIRT_D - 4;
    const aIn = mountA - 2.25 - 3;
    const h = Math.max(24, (slot ? slot.d + 1.5 : 2) + 2 * glandR + 2 + 5 + side + 1.5);
    const spec: BandSpec = {
      n,
      theta0,
      z0: -h,
      h,
      aOut,
      aIn,
      above: (i) => lines[i],
      slot: slot ? { ...slot, from: 'bottom' } : null,
      holes: { a: mountA, r: 2.25, every: 2, csk: true },
      side,
    };
    let ring = buildBand(g, spec);
    // Gland through side 0, a quarter of the way along so the arc seams miss it.
    const nu0 = [Math.cos(theta0 + Math.PI / n), Math.sin(theta0 + Math.PI / n), 0] as Vec3;
    const tau0 = [-nu0[1], nu0[0], 0] as Vec3;
    const sideLen = 2 * aOut * Math.tan(Math.PI / n);
    const zg = -h + (slot ? slot.d + 1.5 : 2) + glandR + 0.5;
    const start: Vec3 = [nu0[0] * (aIn - 2) - tau0[0] * sideLen * 0.25, nu0[1] * (aIn - 2) - tau0[1] * sideLen * 0.25, zg];
    ring = g.cut(ring, [g.place(g.cylZ(glandR, 0, aOut - aIn + 4), frameZ(nu0, [0, 0, 1], start))]);
    const bp = bandParts(
      g,
      ring,
      spec,
      split,
      {
        id: 'base',
        name: 'Base ring',
        role: slot ? 'diffuser' : 'body',
        note: `Prints upright. ${slot ? `Natural PETG: the ${strip!.name} glows through the ${LIP} mm lip. ` : ''}The rim panels' tongues drop into its top groove (${fmtGap(j.fit)} gap); countersunk M4 holes to screw it down.`,
      },
      [-h],
    );
    parts.push(...bp.parts);

    /* ---------- Pixels: faces top down, then the rim strip ---------- */
    const pixels: PixelPlacement[] = facePixels(plan, pixel, 'L7-F');
    const schedule: ScheduleLine[] = [faceLine(plan, pixel, 'L7-F', 'Face panels, crown band first, serpentine')];
    if (strip && strip.shape.kind === 'strip' && slot) {
      const zLed = -h + slot.d - strip.shape.width / 2;
      const s = bandStrip(spec, strip.shape.pitch, zLed, 'L7-R');
      pixels.push(...s.pixels);
      schedule.push({
        unit: 'L7-R',
        position: 'Base ring',
        purpose: 'Rim line, CCW from the gland seen from above',
        pixelId: strip.id,
        units: Math.round(s.mm),
        px: s.pixels.length,
        notes: `One loop of ${s.pixels.length} px in the ring slot, loaded from underneath. Own data output, or chained after the faces.`,
      });
    }

    /* ---------- Paperwork ---------- */
    const hardware: HardwareLine[] = [
      ...capHardware(plan, null),
      { item: 'PG7 cable gland (M12×1.5) with lock nut', qty: 1, note: 'Through the base ring' },
      { item: 'M4 countersunk wood screw', qty: Math.ceil(n / 2), note: 'Base ring to the table board or ceiling' },
      { item: `${pixel.volts === 5 ? '2-core 1.0 mm² (18 AWG)' : '2-core 0.75 mm² (18 AWG)'} + data pair`, qty: 1, note: 'Power and data in through the gland' },
    ];
    if (sh.splitPins + bp.pins) hardware.push({ item: '1.75 mm filament pins', qty: sh.splitPins + bp.pins, note: 'For split panels and ring arcs' });
    const F = plan.faces.length;
    const faceW = F * pixel.wattsPerPx;
    const stripW = strip ? (schedule[1]?.px ?? 0) * strip.wattsPerPx : 0;
    if (strip && strip.volts !== pixel.volts) warnings.push(`The rim strip is ${strip.volts} V and the nodes ${pixel.volts} V: two supplies, or match them.`);
    const a5 = ((pixel.volts === 5 ? faceW : 0) + (strip?.volts === 5 ? stripW : 0)) / 5;
    if (a5 > 10) warnings.push(`${a5.toFixed(1)} A at 5 V full white: inject at the strip's start and end, and cap the brightness in WLED.`);
    const lead = leadWarning(plan, pixel);
    if (lead) warnings.push(lead);
    if (sh.tight) warnings.push(`Vertex caps are crowded at ${freq}V Ø${D}: go up in diameter or down a frequency.`);
    if (sh.splitPieces) warnings.push(`${sh.splitPieces} panel pieces: the ${freq}V faces are bigger than your bed at Ø${D} and were split with keyed joints.`);
    if (bp.pieces > 1) warnings.push(`The base ring prints as ${bp.pieces} keyed arcs.`);
    warnings.push(`Weight: about ${((massG(parts) + F * 6) / 1000).toFixed(1)} kg printed in PETG with pixels.`);
    const rimCaps = plan.vertexClasses.filter((c) => plan.verts[c.rep].rim);
    warnings.push(
      `${plan.faceClasses.length} panel shapes (${plan.faceClasses.map((c) => `${c.id} ×${c.members.length}`).join(', ')}), ${plan.vertexClasses.length - rimCaps.length} cap shapes and ${rimCaps.length} rim cap shape${rimCaps.length === 1 ? '' : 's'}.`,
    );
    warnings.push(`Fit gap ${fmtGap(j.fit)}: cap spigots Ø${fmt(2 * j.spigR, 1)} into Ø${fmt(2 * j.holeR, 1)} corner holes; ${TONGUE_T} mm tongues in ${fmt(TONGUE_T + j.fit, 2)} mm grooves.`);

    const panels = ids(parts, ...plan.faceClasses.map((c) => `panel-${c.id}`));
    const caps = ids(parts, ...plan.vertexClasses.map((c) => `cap-${c.id}`));
    const assembly: AssemblyStep[] = [
      {
        title: 'Build the base ring',
        parts: ids(parts, 'base'),
        hardware: [bp.pins ? `${bp.pins}× 1.75 mm filament pin` : '', 'PG7 gland'].filter(Boolean).join(', '),
        note: `${bp.pieces > 1 ? 'Slide the arcs together on their dovetails and pin them. ' : ''}Fit the gland${strip ? `, then press the ${strip.name} up into the slot from underneath, LEDs facing out, starting at the gland` : ''}. Screw the ring down to its board or the ceiling.`,
      },
      { title: 'Seat the face nodes', parts: panels, hardware: `${F}× ${pixel.name}`, note: 'Push a node into every panel collar from inside. Number the panels in face data order.' },
      {
        title: 'Stand the rim panels',
        parts: [...panels.filter((p) => plan.faceClasses.some((c) => p.startsWith(`panel-${c.id}`) && plan.faces[c.rep].edges.includes('tongue'))), ...caps.filter((p) => rimCaps.some((c) => p === `cap-${c.id}`))],
        hardware: 'M3×12 countersunk self-tappers',
        note: `Drop each rim panel's tongue into the ring groove (${fmtGap(j.fit)} gap) and close each rim vertex with its half cap.`,
      },
      {
        title: 'Close the dome',
        parts: caps,
        hardware: 'M3×12 countersunk self-tappers',
        note: 'Work up band by band: each cap spigot drops into its corner hole and one screw goes into every panel corner. Wire the node chain as you go; the top cap goes on last.',
      },
      { title: 'Wire and test', note: `Faces and ${strip ? 'rim' : 'nothing else'} on ${strip ? 'two outputs' : 'one output'}; run a test pattern before you screw the last caps home.` },
    ];

    return { parts, pixels, schedule, hardware, warnings, assembly, enclosureCm3: ((2 / 3) * Math.PI * (R / 10) ** 3) };
  },
};
