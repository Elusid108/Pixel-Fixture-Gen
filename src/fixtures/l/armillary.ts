import type { Manifold } from 'manifold-3d';
import { Geo, type P2 } from '../../geom/geo';
import { apply, applyDir, mul, Rx, Rz, T } from '../../geom/mat';
import { invert, maxArcDeg, splitParts, splitToBed } from '../../geom/split';
import { basis, dot, frameZ, norm, perp, scale } from '../../geom/vec';
import { cluster1D } from '../../graph/dedupe';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { bool, layFlat, num, str } from '../util';
import { fmt, geodesic, icosaUnit, SPLIT_PARAMS, splitCfg } from './common';

/**
 * L4 Armillary: three great circles, the way an armillary sphere is drawn. The equator, a
 * meridian (the colure through the poles) and the ecliptic tilted 23.4° about the equinox line.
 *
 * Each ring is a band with a strip channel on its outer face and a snap-in diffuser over it.
 * Where two rings cross they half-lap: the "over" ring keeps its outer half there, the "under"
 * ring its inner half, so each captures the other. The over ring's strip runs straight
 * through; the under ring's strip breaks and jumps the crossing on a wire.
 *
 * A polar tube runs pole to pole through the meridian and carries a small geodesic sun at the
 * centre; the whole sphere hangs from the north pole.
 */

const EPS = 23.4;

export interface RingDef {
  id: 'MER' | 'EQU' | 'ECL';
  name: string;
  /** Ring-local frame (ring in its XY plane, axis Z, centred) to the assembled frame. */
  L: Mat4;
}

/** Ring frames around the origin. Equator in XY, meridian in YZ (poles on Z), ecliptic tilted about X. */
export function ringDefs(): RingDef[] {
  return [
    { id: 'MER', name: 'Meridian', L: basis([0, 1, 0], [0, 0, 1], [1, 0, 0]) },
    { id: 'EQU', name: 'Equator', L: T(0, 0, 0) },
    { id: 'ECL', name: 'Ecliptic', L: Rx(EPS) },
  ];
}

/** Who keeps the outer half at each crossing. */
const OVER: Record<string, 'MER' | 'EQU' | 'ECL'> = { 'EQU|MER': 'MER', 'ECL|EQU': 'ECL', 'ECL|MER': 'MER' };
const over = (a: string, b: string) => OVER[[a, b].sort().join('|')];

/** Angles (deg, in ring A's own frame) where ring A meets ring B, with the half-width of the band overlap. */
export function crossings(A: RingDef, B: RingDef, R: number, W: number): { angle: number; half: number }[] {
  const nB = applyDir(B.L, [0, 0, 1]);
  const out: { angle: number; half: number }[] = [];
  // A's circle point at angle φ is L_A·(cosφ, sinφ, 0): solve n_B·p = 0.
  const ex = applyDir(A.L, [1, 0, 0]);
  const ey = applyDir(A.L, [0, 1, 0]);
  const a = dot(nB, ex);
  const b = dot(nB, ey);
  const base = (Math.atan2(-a, b) * 180) / Math.PI;
  // Sine and cosine of the angle between the two ring planes. Both bands are W wide, so along A
  // the overlap runs (W/2)(1 + cos) / sin either side of the crossing: long at shallow angles.
  const s = Math.hypot(a, b);
  const c = Math.abs(dot(nB, applyDir(A.L, [0, 0, 1])));
  const half = ((((W / 2 + 1.5) * (1 + c)) / Math.max(0.05, s)) / R) * (180 / Math.PI);
  for (const k of [0, 180]) out.push({ angle: (((base + k) % 360) + 360) % 360, half });
  return out;
}

export const armillary: FixtureDef = {
  id: 'armillary',
  code: 'L4',
  name: 'Armillary',
  family: 'assembly',
  tagline: 'Equator, meridian and the ecliptic at 23.4°, half-lapped, with a geodesic sun.',
  description:
    'Three interlocking great circles. Each ring splits into keyed arcs with a strip channel and a snap-in diffuser, and the rings half-lap where they cross so they lock each other. A polar tube carries a small geodesic sun at the centre and hangs the sphere from the north pole.',
  params: [
    { key: 'diameter', label: 'Diameter', type: 'number', default: 500, min: 400, max: 700, step: 10, unit: 'mm', group: 'Shape' },
    { key: 'band', label: 'Band width', type: 'number', default: 22, min: 20, max: 30, step: 1, unit: 'mm', group: 'Shape' },
    { key: 'depth', label: 'Band depth', type: 'number', default: 16, min: 14, max: 24, step: 1, unit: 'mm', group: 'Shape' },
    { key: 'pixel', label: 'Strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: ['strip-60-ws2812b', 'strip-60-ws2815', 'strip-30-ws2812b'], group: 'Pixels' },
    { key: 'sun', label: 'Geodesic sun', type: 'boolean', default: true, group: 'Sun' },
    { key: 'sunD', label: 'Sun diameter', type: 'number', default: 110, min: 80, max: 150, step: 5, unit: 'mm', group: 'Sun' },
    { key: 'tol', label: 'Lap clearance', type: 'number', default: 0.15, min: 0, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit' },
    ...SPLIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const split = splitCfg(params);
    const D = num(params, 'diameter');
    const W = num(params, 'band');
    const Tb = num(params, 'depth');
    const tol = num(params, 'tol');
    const pixel = getPixel(str(params, 'pixel'));
    const pitch = pixel.shape.kind === 'strip' ? pixel.shape.pitch : 1000 / 60;
    const R = D / 2;
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];
    const segs = Math.max(180, Math.round(D * 0.7));
    const rodR = 4.15; // Ø8 aluminium tube
    const C0 = T(0, 0, R + 20);

    /* ---------- Band profile: channel on the outer face, 45° roof so it prints flat ---------- */
    const c0 = 2.5;
    const c1 = c0 + 10.6;
    const cd = 4.5;
    if (c1 + cd + 1.5 > W) warnings.push(`A ${W} mm band is tight for the 10 mm strip channel. Use 22 mm or more.`);
    const band: P2[] = [
      [R - Tb, 0],
      [R, 0],
      [R, c0],
      [R - cd, c0],
      [R - cd, c1],
      [R, Math.min(W - 1, c1 + cd)],
      [R, W],
      [R - Tb, W],
    ];
    const rings = ringDefs();
    const P = new Map(rings.map((r) => [r.id, mul(C0, r.L, T(0, 0, -W / 2))]));

    // Half-lap cutters in each ring's print frame.
    const bandEnvelope = g.revolve(
      [
        [R - Tb - 1, -tol],
        [R + 3, -tol],
        [R + 3, W + tol],
        [R - Tb - 1, W + tol],
      ],
      segs,
    );
    const zones = new Map<string, { angle: number; half: number; under: boolean }[]>();
    const ringSolid = new Map<string, Manifold>();
    for (const A of rings) {
      const PA = P.get(A.id)!;
      const PAi = invert(PA);
      const cutters: Manifold[] = [];
      const z: { angle: number; half: number; under: boolean }[] = [];
      for (const B of rings) {
        if (B === A) continue;
        const isOver = over(A.id, B.id) === A.id;
        const envB = g.place(bandEnvelope, mul(PAi, P.get(B.id)!));
        const keep = isOver ? g.cylZ(R - Tb / 2 + tol, -2, W + 2, 0, 0, segs) : g.cylZ(R + 6, -2, W + 2, 0, 0, segs).subtract(g.cylZ(R - Tb / 2 - tol, -3, W + 3, 0, 0, segs));
        cutters.push(envB.intersect(keep));
        for (const c of crossings(A, B, R - Tb / 2, W)) z.push({ ...c, under: !isOver });
      }
      // Polar tube through the meridian at its poles (local ±90°).
      if (A.id === 'MER') for (const s of [1, -1]) cutters.push(g.cylY(rodR, s > 0 ? R - Tb - 1 : -R - 1, s > 0 ? R + 1 : -R + Tb + 1, 0, W / 2));
      zones.set(A.id, z);
      ringSolid.set(A.id, g.cut(g.M.revolve(g.poly(band), segs), cutters));
    }

    /* ---------- Ring arcs: radial split with seams clear of the laps and poles ---------- */
    let pins = 0;
    for (const A of rings) {
      const z = zones.get(A.id)!;
      const keyDeg = (14 / R) * (180 / Math.PI);
      const avoid = [...z.map((c) => ({ angle: c.angle, half: c.half + keyDeg })), ...(A.id === 'MER' ? [90, 270].map((a) => ({ angle: a, half: keyDeg })) : [])];
      const base = { id: `ring-${A.id.toLowerCase()}`, name: `${A.name} ring`, role: 'body' as const, note: 'Flat on the plate, channel facing out. Laps: the over ring keeps its outer half.' };
      const inst = [P.get(A.id)!];
      if (split.on) {
        const sp = splitToBed(g, ringSolid.get(A.id)!, split.printer, { ...split.opts, mode: 'radial', avoid, sectors: (n) => n >= 4 });
        if (!sp.fits) warnings.push(`The ${A.name.toLowerCase()} does not split to fit this printer.`);
        pins += sp.pins;
        parts.push(...splitParts(sp, base, inst));
      } else {
        parts.push({ ...base, solid: ringSolid.get(A.id)!, instances: inst });
      }
    }

    /* ---------- Snap diffusers: arcs between under-crossings, sized to the bed ---------- */
    const zA0 = c0 + 0.15;
    const zB1 = Math.min(W - 1, c1 + cd) - 1.7;
    const diff: P2[] = [
      [R + 0.1, 0.5],
      [R + 1.7, 0.5],
      [R + 1.7, W - 0.5],
      [R + 0.1, W - 0.5],
      [R + 0.1, zB1],
      [R - 1.5, zB1],
      [R - 1.5, zB1 - 1.2],
      [R + 0.1, zB1 - 1.2],
      [R + 0.1, zA0 + 1.2],
      [R - 2.5, zA0 + 1.2],
      [R - 2.5, zA0],
      [R + 0.1, zA0],
    ];
    const maxDeg = split.on ? maxArcDeg(R - 2.5, R + 1.7, W, split.printer) : 180;
    const runsFor = (A: RingDef): [number, number][] => {
      // Gaps: under-crossings and the poles. Runs are what's left, in degrees.
      const gaps = zones
        .get(A.id)!
        .filter((c) => c.under)
        .map((c) => [c.angle - c.half, c.angle + c.half] as [number, number]);
      if (A.id === 'MER') for (const a of [90, 270]) gaps.push([a - ((rodR + 3) / R) * 57.3, a + ((rodR + 3) / R) * 57.3]);
      if (!gaps.length) return [[0, 360]];
      gaps.sort((x, y) => x[0] - y[0]);
      const runs: [number, number][] = [];
      for (let i = 0; i < gaps.length; i++) {
        const a = gaps[i][1];
        const b = i + 1 < gaps.length ? gaps[i + 1][0] : gaps[0][0] + 360;
        if (b - a > 1) runs.push([a, b]);
      }
      return runs;
    };
    const arcs: { ring: RingDef; a0: number; span: number }[] = [];
    for (const A of rings) {
      for (const [a, b] of runsFor(A)) {
        const n = Math.max(1, Math.ceil((b - a) / Math.max(1, maxDeg - 0.5)));
        const span = (b - a) / n;
        for (let k = 0; k < n; k++) arcs.push({ ring: A, a0: a + k * span + 0.25, span: span - 0.5 });
      }
    }
    for (const grp of cluster1D(arcs, (x) => x.span, 0.2)) {
      const span = grp[0].span;
      const solid = g.M.revolve(g.poly(diff), Math.max(8, Math.round((segs * span) / 360)), span);
      parts.push({
        id: `diffuser-${fmt(span * 10)}`,
        name: `Snap diffuser · ${fmt(span, 1)}°`,
        role: 'diffuser',
        solid,
        instances: grp.map((x) => mul(P.get(x.ring.id)!, Rz(x.a0))),
        explode: [0, 0, 0],
        note: 'Natural PETG, standing on its edge. Presses into the channel over the strip.',
      });
    }

    /* ---------- Sun: 2V geodesic shell halves around a 10-pixel core ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const sunOn = bool(params, 'sun');
    const Rs = num(params, 'sunD') / 2;
    const Mc = C0;
    if (sunOn) {
      const geo = geodesic(2);
      const outer = g.M.hull(geo.verts.map((v) => scale(v, Rs)));
      const ri = Rs - 1.8;
      // Cavity capped by a cone so the dome's roof stays within 45° when printed cut-face down.
      const cavity = g.M.hull(geo.verts.map((v) => scale(v, ri))).intersect(g.coneZ(1.2 * ri, 0, -0.01, 1.2 * ri, 0, 0));
      const half = g.cut(outer.trimByPlane([0, 0, 1], 0), [cavity, g.cylZ(rodR, -1, Rs + 1)]);
      // The two halves are the same print: the lower one is the upper turned on the 2-fold axis at 18°.
      const flip = mul(Rz(18), Rx(180), Rz(-18));
      parts.push({ id: 'sun-half', name: 'Sun half', role: 'diffuser', solid: half, instances: [Mc, mul(Mc, flip)], explode: [0, 0, 0.5], note: 'Cut face down, natural PETG. The thick crown is the support-free roof.' });

      const ico = icosaUnit().slice(1, 11);
      const rc = Math.min(Rs - 12, 22);
      const pcbR = 4.75;
      const seats = ico.map((d) => g.place(g.cylZ(pcbR + 1.6, -6, 0, 0, 0, 24), frameZ(d, perp(d), scale(d, rc))));
      const core = g.cut(g.M.hull(seats), [
        g.cylZ(rodR, -Rs, Rs),
        ...ico.map((d) => g.place(socketCutter(g, getPixel('pcb-9-ws2812b'), { tol: 0.15, wire: 6, over: 1 }), frameZ(d, perp(d), scale(d, rc)))),
      ]);
      const lay = layFlat(g, core, T(0, 0, 0), Mc);
      parts.push({ id: 'sun-core', name: 'Sun core', role: 'body', solid: lay.solid, instances: [lay.instance], note: '10 pixel PCBs facing out at the icosahedron points. Slides on the polar tube.' });
      warnings.push(`The sun has 10 pixels on its core and ${geo.faces.length / 2} facets per half.`);
    }

    /* ---------- Pixels along each ring, in data order ---------- */
    const order: RingDef['id'][] = ['MER', 'EQU', 'ECL'];
    const ringPx = new Map<string, number>();
    for (const id of order) {
      const A = rings.find((r) => r.id === id)!;
      const runs = runsFor(A);
      const start = id === 'MER' ? 90 : 0;
      const rot = (a: number) => (((a - start) % 360) + 360) % 360;
      runs.sort((x, y) => rot(x[0]) - rot(y[0]));
      let count = 0;
      for (const [a, b] of runs) {
        const lenMm = ((b - a) * Math.PI * R) / 180 - 6;
        const k = Math.max(0, Math.floor(lenMm / pitch));
        const mid = (a + b) / 2;
        for (let i = 0; i < k; i++) {
          const ang = ((mid + ((i - (k - 1) / 2) * pitch * 180) / (Math.PI * R)) * Math.PI) / 180;
          const pLocal: Vec3 = [(R + 1.7) * Math.cos(ang), (R + 1.7) * Math.sin(ang), (c0 + c1) / 2];
          const M = P.get(id)!;
          pixels.push({ pos: apply(M, pLocal), normal: norm(applyDir(M, [Math.cos(ang), Math.sin(ang), 0])), unit: `L4-${id}` });
        }
        count += k;
      }
      ringPx.set(id, count);
      const name = A.name;
      schedule.push({
        unit: `L4-${id}`,
        position: name,
        purpose: id === 'MER' ? 'Pole to pole and back' : id === 'EQU' ? 'Around the equator' : 'The sun’s path',
        pixelId: pixel.id,
        units: Math.round(count * pitch),
        px: count,
        notes: `${runs.length} run${runs.length === 1 ? '' : 's'}${runs.length > 1 ? `, jumped on 3-core wire at ${runs.length} gap${runs.length === 1 ? '' : 's'}` : ''}.`,
      });
    }
    if (sunOn) {
      for (const d of icosaUnit().slice(1, 11)) pixels.push({ pos: apply(Mc, scale(d, Rs)), normal: d, unit: 'L4-SUN' });
      schedule.push({ unit: 'L4-SUN', position: 'Centre', purpose: 'Sun', pixelId: 'pcb-9-ws2812b', units: 10, px: 10, notes: 'Wires down the polar tube.' });
    }

    /* ---------- Paperwork ---------- */
    const totalPx = [...ringPx.values()].reduce((s, v) => s + v, 0) + (sunOn ? 10 : 0);
    const amps = (totalPx * pixel.wattsPerPx) / pixel.volts;
    if (pixel.volts === 5 && amps > 6) warnings.push(`${fmt(amps, 1)} A at 5 V full white. Use WS2815 12 V strip on the rings; the sun PCBs then need a small 5 V buck in the core.`);
    if (pixel.volts === 12) warnings.push('The sun core uses 5 V PCBs: put a mini 12→5 V buck inside it, or feed it from the controller.');
    warnings.push('Assembly: build the meridian first and hang it on the polar tube. Equator arcs drop onto its laps from inside, then the ecliptic. Under-crossings break the strip; jump them on 3-core wire.');
    const hardware: HardwareLine[] = [
      { item: 'Ø8 × 1 mm aluminium tube', qty: Math.ceil(D + 80) / 1000, note: 'Metres. Polar axis; the sun wires run inside' },
      { item: 'Ø8 mm shaft collar', qty: 4, note: 'Either side of the meridian at both poles' },
      { item: 'Lamp loop + canopy', qty: 1, note: 'Hangs the sphere from the north pole' },
      { item: '3-core 22 AWG wire', qty: Math.ceil((D * 3.2) / 100) / 10, note: 'Metres: jumpers at gaps and the feed' },
    ];
    if (pins) hardware.push({ item: '1.75 mm filament pins', qty: pins, note: 'Ring arc joints' });
    return { parts, pixels, schedule, hardware, warnings };
  },
};
