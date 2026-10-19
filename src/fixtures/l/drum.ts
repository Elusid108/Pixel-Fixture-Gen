import type { Manifold } from 'manifold-3d';
import { FIT_PARAMS, fitOf, seatOf, sideOf } from '../../fit';
import { Geo } from '../../geom/geo';
import { splitParts, splitToBed } from '../../geom/split';
import { scale } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import type { AssemblyStep, FixtureDef, HardwareLine, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { num, str } from '../util';
import { fmt, massG, SPLIT_PARAMS, splitCfg } from './common';
import {
  bandParts,
  bandStrip,
  buildBand,
  buildPanel,
  faceInstances,
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
  TONGUE_D,
  TONGUE_T,
  tongueSolid,
  type BandSpec,
  type FaceLine,
  type ShellPlan,
} from './shell';

/**
 * L8 Drum: a faceted cylinder of identical panels, stacked in tiers between glowing bands.
 *
 * N sides × M tiers of flat light-box panels (the Orb's, with level spokes so the seams between
 * tiers are flat). Between the tiers, and at both ends, run polygonal bands. Every panel carries
 * its face plate on past its top and bottom edges as tongues that drop into grooves in the bands
 * (groove = tongue + fit gap); neighbouring panels in a tier butt at a fit-gap seam.
 *
 * Each band is the second pixel type: a strip stands in a slot open at the top, LEDs out behind a
 * 1.2 mm diffuser lip, so every seam is a line of light. M5 tie rods through every band clamp the
 * stack; eye nuts on the top band take a three-leg bridle.
 *
 * Profiles: straight, taper (narrower at the top) or barrel (bulging in the middle). Tiers that
 * match (all of them when straight; mirror pairs on a barrel) print as one panel ×N.
 */

const ROD_R = 2.75; // M5 clearance: hardware size
const BAND_MIN = 14;

export type Profile = 'straight' | 'taper' | 'barrel';

export interface DrumOpts {
  sides: number;
  tiers: number;
  diameter: number;
  tierH: number;
  bandH: number;
  profile: Profile;
  amount: number;
}

export interface DrumPlan extends ShellPlan {
  /** Band bottoms, bottom band first. */
  bandZ: number[];
  height: number;
  theta0: number;
  /** Face line of tier k at its bottom and top edges (same for every side). */
  tierLines: { bottom: FaceLine; top: FaceLine }[];
  /** Polygon circumradius at height z. */
  radius: (z: number) => number;
}

export function planDrum(o: DrumOpts): DrumPlan {
  const N = o.sides;
  const R = o.diameter / 2;
  const height = o.tiers * o.tierH + (o.tiers + 1) * o.bandH;
  const radius = (z: number) => {
    const t = Math.max(0, Math.min(1, z / height));
    if (o.profile === 'taper') return R * (1 - o.amount * t);
    if (o.profile === 'barrel') return R * (1 - o.amount * (2 * t - 1) ** 2);
    return R;
  };
  const theta0 = Math.PI / 2 - Math.PI / N; // a flat side faces +y
  const ang = (i: number) => theta0 + (2 * Math.PI * i) / N;
  const bandZ = Array.from({ length: o.tiers + 1 }, (_, k) => k * (o.tierH + o.bandH));
  const points: Vec3[] = [];
  const faces: number[][] = [];
  const tierLines: { bottom: FaceLine; top: FaceLine }[] = [];
  const cosH = Math.cos(Math.PI / N);
  for (let k = 0; k < o.tiers; k++) {
    const zb = bandZ[k] + o.bandH;
    const zt = bandZ[k + 1];
    const base = points.length;
    for (let i = 0; i < N; i++) points.push([radius(zb) * Math.cos(ang(i)), radius(zb) * Math.sin(ang(i)), zb]);
    for (let i = 0; i < N; i++) points.push([radius(zt) * Math.cos(ang(i)), radius(zt) * Math.sin(ang(i)), zt]);
    for (let i = 0; i < N; i++) faces.push([base + i, base + ((i + 1) % N), base + N + ((i + 1) % N), base + N + i]);
    const s = ((radius(zt) - radius(zb)) * cosH) / (zt - zb);
    tierLines.push({ bottom: { a0: radius(zb) * cosH, z0: zb, s }, top: { a0: radius(zt) * cosH, z0: zt, s } });
  }
  const plan = planShell({
    points,
    faces,
    spoke: (p) => scale([p[0], p[1], 0], -1 / Math.hypot(p[0], p[1])),
    tongue: (a, b) => Math.abs(a[2] - b[2]) < 1e-6,
    size: R,
  });
  return { ...plan, bandZ, height, theta0, tierLines, radius };
}

/** Which side an edge lies on, by its midpoint. */
function sideAt(p: Vec3, N: number, theta0: number): number {
  const phi = Math.atan2(p[1], p[0]);
  const k = Math.floor(((((phi - theta0) % (2 * Math.PI)) + 4 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / N));
  return ((k % N) + N) % N;
}

const STRIPS = ['strip-30-ws2812b', 'strip-60-ws2812b', 'strip-60-ws2815', 'strip-30-ws2815'];

export const drum: FixtureDef = {
  id: 'drum',
  code: 'L8',
  name: 'Drum',
  family: 'assembly',
  tagline: 'Faceted lantern of identical panels in tiers, with a glowing strip in every ring seam.',
  description:
    'A hanging drum lantern: N flat panels round, M tiers high, each a printed light box with a 12 mm node. The tiers stand in polygonal bands, and every band carries a strip behind a thin diffuser lip, so the seams glow as lines between the tiles. Straight, tapered or barrel. Tie rods clamp the stack and a three-leg bridle hangs it. Open top and bottom.',
  params: [
    { key: 'sides', label: 'Sides', type: 'number', default: 10, min: 6, max: 16, step: 1, group: 'Shape' },
    { key: 'tiers', label: 'Tiers', type: 'number', default: 3, min: 1, max: 5, step: 1, group: 'Shape' },
    { key: 'diameter', label: 'Diameter', type: 'number', default: 420, min: 260, max: 800, step: 10, unit: 'mm', group: 'Shape', help: 'Across the corners at the widest point.' },
    { key: 'tierH', label: 'Tier height', type: 'number', default: 120, min: 70, max: 220, step: 5, unit: 'mm', group: 'Shape' },
    {
      key: 'profile',
      label: 'Profile',
      type: 'select',
      default: 'straight',
      options: [
        { value: 'straight', label: 'Straight' },
        { value: 'taper', label: 'Taper (narrow top)' },
        { value: 'barrel', label: 'Barrel' },
      ],
      group: 'Shape',
    },
    { key: 'amount', label: 'Taper / bulge', type: 'number', default: 15, min: 0, max: 30, step: 1, unit: '%', group: 'Shape' },
    { key: 'pixel', label: 'Panel node', type: 'pixel', default: 'node-12-bullet', pixels: ['node-12-bullet', 'node-12-bullet-12v', 'jewel-7-ws2812b'], group: 'Pixels' },
    { key: 'strip', label: 'Seam strip', type: 'select', default: 'strip-30-ws2812b', options: pixelOptions(STRIPS, 'None'), group: 'Pixels', help: 'Second pixel type: a strip in every band. None leaves plain bands.' },
    ...FIT_PARAMS,
    ...SPLIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const N = Math.round(num(params, 'sides'));
    const M = Math.round(num(params, 'tiers'));
    const D = num(params, 'diameter');
    const pixel = getPixel(str(params, 'pixel'));
    const strip = optPixel(params, 'strip');
    const split = splitCfg(params);
    const fit = fitOf(params);
    const side = sideOf(params);
    const seat = seatOf(params);
    const slot = stripSlot(strip, seat);
    const bandH = Math.max(BAND_MIN, slot ? slot.d + 2 : 0, 2 * (TONGUE_D + side) + 3);
    const profile = str(params, 'profile') as Profile;
    const plan = planDrum({ sides: N, tiers: M, diameter: D, tierH: num(params, 'tierH'), bandH, profile, amount: num(params, 'amount') / 100 });
    const { theta0, tierLines, bandZ } = plan;
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];
    const ring = { n: N, theta0, side };
    const tierOf = (z: number) => tierLines.findIndex((t) => z >= t.bottom.z0 - 1e-6 && z <= t.top.z0 + 1e-6);

    /* ---------- Panels ---------- */
    let splitPieces = 0;
    let splitPins = 0;
    for (const cls of plan.faceClasses) {
      const f = plan.faces[cls.rep];
      const pb = buildPanel(g, plan, f, {
        side,
        seat,
        pixel,
        rc: 10,
        caps: null,
        tongue: (face, e) => {
          const a = face.pts[e];
          const b = face.pts[(e + 1) % face.pts.length];
          const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]];
          const t = tierLines[tierOf(face.c[2])];
          const top = Math.abs(mid[2] - t.top.z0) < 1e-6;
          return tongueSolid(g, ring, sideAt(mid, N, theta0), top ? t.top : t.bottom, top ? 1 : -1, plan.radius(mid[2]));
        },
      });
      const instances = faceInstances(plan, cls);
      const tiers = [...new Set(cls.members.map((m) => tierOf(plan.faces[m].c[2]) + 1))].sort();
      const base = {
        id: `panel-${cls.id}`,
        name: `Panel ${cls.id} (tier ${tiers.join(', ')})`,
        role: 'diffuser' as const,
        note: `Face down, natural or white PETG. One ${pixel.name} ${pixel.form === 'node' ? 'pushes into the collar' : 'drops into the collar pocket'} from inside. Tongues top and bottom drop into the band grooves.`,
      };
      if (split.on) {
        const sp = splitToBed(g, pb.solid, split.printer, { ...split.opts, fit: side * 2, keepOut: [{ p: [0, 0, 0], r: pb.collarR + 4 }] });
        parts.push(...splitParts(sp, base, instances));
        if (sp.pieces > 1) {
          splitPieces += sp.pieces * instances.length;
          splitPins += sp.pins * instances.length;
        }
      } else parts.push({ ...base, solid: pb.solid, instances });
    }

    /* ---------- Bands ---------- */
    const aMin = Math.min(...tierLines.flatMap((t) => [t.bottom.a0, t.top.a0]));
    const rodA = aMin - SKIRT_D - 3.5 - ROD_R;
    const rodEvery = N % 2 === 0 ? 2 : 1;
    const rods = Math.ceil(N / rodEvery);
    const bands: { spec: BandSpec; key: string; z: number; k: number }[] = bandZ.map((z0, k) => {
      const above = k < M ? tierLines[k].bottom : null;
      const below = k > 0 ? tierLines[k - 1].top : null;
      const groove = Math.max(above ? grooveReach(above, -1, side) : -Infinity, below ? grooveReach(below, 1, side) : -Infinity);
      const spec: BandSpec = {
        n: N,
        theta0,
        z0: z0,
        h: bandH,
        aOut: groove + (slot ? 1.2 + slot.w + LIP : 2.4),
        aIn: rodA - ROD_R - 3,
        above: above ? () => above : undefined,
        below: below ? () => below : undefined,
        slot: slot ? { ...slot, from: 'top' } : null,
        holes: { a: rodA, r: ROD_R, every: rodEvery },
        side,
      };
      const rel = (L: FaceLine | null) => (L ? `${(L.a0).toFixed(3)}/${(L.z0 - z0).toFixed(3)}/${L.s.toFixed(5)}` : '-');
      return { spec, key: `${rel(above)}|${rel(below)}`, z: z0, k };
    });
    const groups = new Map<string, typeof bands>();
    for (const b of bands) groups.set(b.key, [...(groups.get(b.key) ?? []), b]);
    let bandPieces = 0;
    let bandPins = 0;
    let gi = 0;
    for (const grp of groups.values()) {
      const { spec } = grp[0];
      const kinds = grp.map((b) => (b.k === 0 ? 'bottom' : b.k === M ? 'top' : 'seam'));
      const label = kinds.every((x) => x === 'seam') ? 'Seam band' : kinds.length === 1 ? `${kinds[0][0].toUpperCase()}${kinds[0].slice(1)} band` : 'Band';
      const bp = bandParts(
        g,
        buildBand(g, spec),
        spec,
        split,
        {
          id: `band-${String.fromCharCode(65 + gi++)}`,
          name: `${label} (${grp.map((b) => b.k + 1).join(', ')} from the bottom)`,
          role: slot ? 'diffuser' : 'body',
          note: `Prints upright.${slot ? ` Natural PETG: the ${strip!.name} stands in the top slot, LEDs out, behind the ${LIP} mm lip.` : ''} Panel tongues drop into its grooves (${fmtGap(fit)} gap). M5 tie rods through the corner holes.`,
        },
        grp.map((b) => b.z),
      );
      parts.push(...bp.parts);
      bandPieces += bp.pieces * grp.length;
      bandPins += bp.pins * grp.length;
    }

    /* ---------- Pixels: panels top tier first, then the bands top down ---------- */
    const pixels: PixelPlacement[] = facePixels(plan, pixel, 'L8-P');
    const schedule: ScheduleLine[] = [faceLine(plan, pixel, 'L8-P', 'Panels, top tier first, serpentine')];
    let stripPx = 0;
    let stripMm = 0;
    const ss = strip?.shape;
    if (strip && ss?.kind === 'strip' && slot) {
      const ordered = [...bands].reverse();
      ordered.forEach((b, i) => {
        const zLed = b.z + bandH - slot.d + ss.width / 2;
        const s = bandStrip(b.spec, ss.pitch, zLed, 'L8-S', i % 2 === 1);
        pixels.push(...s.pixels);
        stripPx += s.pixels.length;
        stripMm += s.mm;
      });
      schedule.push({
        unit: 'L8-S',
        position: `Bands ${M + 1}–1`,
        purpose: 'Seam lines, top band first, alternating direction',
        pixelId: strip.id,
        units: Math.round(stripMm),
        px: stripPx,
        notes: `${M + 1} loops of ${Math.round(stripPx / (M + 1))} px, jumpered down a tie rod. Own data output, or chained after the panels. Inject at every loop.`,
      });
    }

    /* ---------- Paperwork ---------- */
    const rodLen = Math.ceil((plan.height + 40) / 10) * 10;
    const hardware: HardwareLine[] = [
      { item: `M5 threaded rod, ${rodLen} mm`, qty: rods, note: 'Through every band at the corners' },
      { item: 'M5 nut + washer', qty: 2 * rods - 3, note: 'Clamp the stack (snug, not tight)' },
      { item: 'M5 eye nut', qty: 3, note: 'On three rods at the top, for the bridle' },
      { item: 'Three-leg wire bridle with ring, rated ≥ 4× the drum weight', qty: 1 },
      { item: `${pixel.volts === 5 ? '2-core 1.5 mm² (16 AWG)' : '2-core 0.75 mm² (18 AWG)'} + data pair`, qty: 1, note: 'Down the bridle and in at the open top' },
    ];
    if (strip) hardware.push({ item: '3-pin JST SM pigtail pair', qty: M, note: 'Jumpers between band loops' });
    if (splitPins + bandPins) hardware.push({ item: '1.75 mm filament pins', qty: splitPins + bandPins, note: 'For split panels and band arcs' });
    const F = plan.faces.length;
    const faceW = F * pixel.pxPerUnit * pixel.wattsPerPx;
    const stripW = strip ? stripPx * strip.wattsPerPx : 0;
    const a5 = ((pixel.volts === 5 ? faceW : 0) + (strip?.volts === 5 ? stripW : 0)) / 5;
    if (a5 > 10) warnings.push(`${a5.toFixed(1)} A at 5 V full white: put the supply in the drum's top or use the 12 V strip and nodes.`);
    if (strip && strip.volts !== pixel.volts) warnings.push(`The seam strip is ${strip.volts} V and the panels ${pixel.volts} V: two supplies, or match them.`);
    const lead = leadWarning(plan, pixel);
    if (lead) warnings.push(lead);
    if (splitPieces) warnings.push(`${splitPieces} panel pieces: the panels are bigger than your bed and were split with keyed joints.`);
    if (bandPieces > M + 1) warnings.push(`The ${M + 1} bands print as ${bandPieces} keyed arcs.`);
    warnings.push(`Weight: about ${((massG(parts) + F * 6) / 1000).toFixed(1)} kg printed in PETG with pixels. ${rods} M5 tie rods carry it; the bridle hangs from three eye nuts.`);
    warnings.push(
      `${plan.faceClasses.length} panel shape${plan.faceClasses.length === 1 ? '' : 's'} (${plan.faceClasses.map((c) => `${c.id} ×${c.members.length}`).join(', ')}) and ${groups.size} band shape${groups.size === 1 ? '' : 's'} for ${M + 1} bands.`,
    );
    warnings.push(`Fit gap ${fmtGap(fit)}: ${TONGUE_T} mm panel tongues in ${fmt(TONGUE_T + fit, 2)} mm band grooves; panels stand ${fmtGap(side)} back from every vertical seam.`);

    const panelIds = ids(parts, ...plan.faceClasses.map((c) => `panel-${c.id}`));
    const bandIds = parts.filter((p) => p.id.startsWith('band-')).map((p) => p.id);
    const assembly: AssemblyStep[] = [
      {
        title: 'Join the bands',
        parts: bandIds,
        hardware: bandPins ? `${bandPins}× 1.75 mm filament pin` : undefined,
        note: `${bandPieces > M + 1 ? 'Slide each band\'s arcs together on their dovetails and pin them. ' : ''}${strip ? `Stand a ${strip.name} loop in each band's top slot, LEDs out, ends at a tie-rod corner.` : ''}`,
      },
      { title: 'Seat the panel nodes', parts: panelIds, hardware: `${F}× ${pixel.name}`, note: 'Push a node into every panel collar from inside. Number the panels in data order (top tier first).' },
      {
        title: 'Stack the drum',
        parts: [...bandIds, ...panelIds],
        hardware: `${rods}× M5 rod, nuts and washers`,
        note: `Bottom band on the bench with the rods through it. Drop a tier of panels in, tongues into the groove (${fmtGap(fit)} gap), then the next band down over their top tongues, and so on up.`,
      },
      { title: 'Clamp and hang', hardware: '3× M5 eye nut, bridle', note: 'Nuts snug on the top band (the panels only need holding, not crushing), eye nuts on three rods, bridle to the ring.' },
      { title: 'Wire and test', note: `Panels on one output${strip ? ', band loops jumpered top to bottom on a second' : ''}. Run a test pattern before hanging.` },
    ];
    return { parts, pixels, schedule, hardware, warnings, assembly, enclosureCm3: Math.PI * (D / 20) ** 2 * (plan.height / 10) * 0.9 };
  },
};

