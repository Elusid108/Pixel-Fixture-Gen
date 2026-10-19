import { num, str } from '../../fixtures/util';
import { getPixel, type PixelType } from '../../pixels/library';
import type { Params } from '../../types';
import { bedOf, type Bed } from '../shared/params';
import type { HingeKind, LinkShape } from './params';

/**
 * Link geometry, shared by the planner (hinge range, pitch limits) and the build (solids).
 * A link is modelled in its own frame: centre at the origin, chain axis along X (clevis at −X,
 * knuckle at +X), hinge pins along Y through (±pitch/2, 0, 0), Z up. That frame is also the
 * print orientation: the diffuser stands on its flat bottom and every wall stays within 45° of
 * vertical. The node pushes in from the top, lens down into the cavity.
 */

export type P2 = [number, number];

export interface PcDims {
  pixel: PixelType;
  /** Strand: longest node-to-node lead and nodes per strand. */
  lead: number;
  strand: number;
  slack: number;
  /** Requested system pitch, before limits. */
  pitchParam: number;
  /** Longest pitch the lead allows: lead − slack. */
  leadMax: number;
  /** Shortest pitch at which neighbouring links clear each other. */
  pitchMin: number;
  shape: LinkShape;
  /** Widest outside radius. */
  R: number;
  wall: number;
  tol: number;
  gap: number;
  hinge: HingeKind;
  /** Outer body profile (r, z), bottom axis point first, apex axis point last. */
  profile: P2[];
  /** Flat bottom (print bed) and the 45° cone's apex. */
  zb: number;
  apex: number;
  /** Revolve segments: 8 for the faceted bead, 0 = manifold's default. */
  segs: number;
  nodeR: number;
  nodeLen: number;
  rBore: number;
  rNeck: number;
  zNeckBase: number;
  zTop: number;
  /** Lens (emitting face) height inside the cavity, facing down. */
  zFace: number;
  /** Hinge boss radius around a pin, knuckle and cheek thickness (Y), cheek span. */
  boss: number;
  tK: number;
  tC: number;
  /** Cheeks occupy |y| in [yc0, yc1]. */
  yc0: number;
  yc1: number;
  /** Pin hole radii in the knuckle (running) and cheeks (holding). */
  holeK: number;
  holeC: number;
  pin: { r: number; flat: number; length: number; headR: number; headT: number };
  /** Anchor bail (hanging loop) above the neck. */
  bail: { t: number; wi: number; wo: number; zIn: number; zOut: number };
  bed: Bed;
}

const SQ2 = Math.SQRT2;

function shapeProfile(shape: LinkShape, R: number, minWaist: number): P2[] {
  if (shape === 'faceted') {
    const pts: P2[] = [
      [0, -0.62 * R],
      [0.62 * R, -0.62 * R],
      [R, -0.18 * R],
      [R, 0.22 * R],
      [0.6 * R, 0.62 * R],
    ];
    return [...pts, [0, 0.62 * R + 0.6 * R]];
  }
  if (shape === 'bell') {
    const w = Math.max(0.6 * R, minWaist);
    const pts: P2[] = [
      [0, -0.75 * R],
      [R, -0.75 * R],
      [R, -0.66 * R],
      [0.9 * R, -0.42 * R],
      [Math.max(w, 0.76 * R), -0.1 * R],
      [Math.max(w, 0.66 * R), 0.22 * R],
      [w, 0.48 * R],
    ];
    return [...pts, [0, 0.48 * R + w]];
  }
  // Globe: a sphere cut flat where its wall passes 45° (bottom), with a 45° shoulder on top.
  const k = Math.SQRT1_2;
  const pts: P2[] = [[0, -k * R]];
  for (let i = 0; i <= 8; i++) {
    const t = -Math.PI / 4 + (i / 8) * (Math.PI / 2);
    pts.push([R * Math.cos(t), R * Math.sin(t)]);
  }
  return [...pts, [0, 2 * k * R]];
}

/** Outer radius of the profile at height z (0 outside its range). */
export function radiusAt(profile: P2[], z: number): number {
  let best = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, z0] = profile[i];
    const [r1, z1] = profile[i + 1];
    if (z < Math.min(z0, z1) - 1e-9 || z > Math.max(z0, z1) + 1e-9) continue;
    const r = Math.abs(z1 - z0) < 1e-9 ? Math.max(r0, r1) : r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
    best = Math.max(best, r);
  }
  return best;
}

export function pcDims(p: Params): PcDims {
  const pixel = getPixel(str(p, 'pixel'));
  const lead = pixel.leadLength ?? 100;
  const strand = pixel.strandLength ?? 50;
  const slack = num(p, 'slack');
  const shape = (str(p, 'shape') as LinkShape) || 'globe';
  const R = num(p, 'beadD') / 2;
  const wall = num(p, 'wall');
  const tol = num(p, 'tol');
  const gap = num(p, 'gap');
  const hinge: HingeKind = str(p, 'hinge') === 'printed' ? 'printed' : 'filament';
  const nodeR = pixel.shape.kind === 'round' ? pixel.shape.d / 2 : 6;
  const nodeLen = pixel.shape.depth;
  const rBore = nodeR + tol;
  const rNeck = rBore + 1.8;
  const profile = shapeProfile(shape, R, rBore + wall + 1.2);
  const zb = profile[0][1];
  const apex = profile[profile.length - 1][1];
  // Every profile ends in a 45° cone, so the inner roof sits wall·√2 lower.
  const roofAtBore = apex - rBore - wall * SQ2;
  const zNeckBase = apex - rNeck;
  const zTop = Math.max(roofAtBore + 8, zb + wall + 5 + nodeLen - 2, zNeckBase + 3);
  const zFace = zTop + 2 - nodeLen;

  const boss = 4.8;
  const tK = 4;
  const tC = 3;
  const yc0 = tK / 2 + gap;
  const yc1 = yc0 + tC;
  const pinR = hinge === 'printed' ? 1.45 : 0.875;
  const holeK = pinR + (hinge === 'printed' ? 0.2 : 0.15);
  const holeC = pinR + (hinge === 'printed' ? 0.05 : 0.1);

  const wi = rNeck + 0.8;
  const wo = wi + 4;
  const zIn = zTop + nodeLen + 3;
  const leadMax = lead - slack;

  const d: PcDims = {
    pixel,
    lead,
    strand,
    slack,
    pitchParam: num(p, 'pitch'),
    leadMax,
    pitchMin: 0,
    shape,
    R,
    wall,
    tol,
    gap,
    hinge,
    profile,
    zb,
    apex,
    segs: shape === 'faceted' ? 8 : 0,
    nodeR,
    nodeLen,
    rBore,
    rNeck,
    zNeckBase,
    zTop,
    zFace,
    boss,
    tK,
    tC,
    yc0,
    yc1,
    holeK,
    holeC,
    pin: { r: pinR, flat: 0.25, length: 2 * yc1 + 0.4, headR: pinR + 1.3, headT: 1 },
    bail: { t: 4, wi, wo, zIn, zOut: zIn + 1 },
    bed: bedOf(p),
  };
  d.pitchMin = minPitch(d);
  return d;
}

/* ---------------- Silhouettes and the hinge range ---------------- */

/** XZ outline of the body and neck (no hinge plates), CCW. */
export function beadOutline(d: PcDims): P2[] {
  const right: P2[] = [];
  for (const [r, z] of d.profile.slice(1, -1)) if (z < d.zNeckBase) right.push([r, z]);
  right.push([d.rNeck, d.zNeckBase], [d.rNeck, d.zTop]);
  const left = right.map(([x, z]) => [-x, z] as P2).reverse();
  return [...right, ...left];
}

/**
 * Knuckle plate outline in XZ for a pin at (P, 0): from inside the bead out to a boss around
 * the pin. Its underside runs from the boss at 45° down to the bed, so it prints without
 * support and stays behind the pin, clear of the neighbour as the joint bends.
 */
export function plateOutline(d: PcDims, P: number): P2[] {
  const rk = d.boss;
  const c = rk / SQ2;
  const xf = Math.max(P + c - (-d.zb - c), 1);
  const pts: P2[] = [
    [0, d.zb],
    [xf, d.zb],
  ];
  for (let i = 0; i <= 6; i++) {
    const t = -Math.PI / 4 + (i / 6) * ((3 * Math.PI) / 4);
    pts.push([P + rk * Math.cos(t), rk * Math.sin(t)]);
  }
  pts.push([0, rk]);
  return pts;
}

const mirrorX = (pts: P2[]): P2[] => pts.map(([x, z]) => [-x, z] as P2).reverse();

function segHit(a: P2, b: P2, c: P2, e: P2): boolean {
  const d1 = (e[0] - c[0]) * (a[1] - c[1]) - (e[1] - c[1]) * (a[0] - c[0]);
  const d2 = (e[0] - c[0]) * (b[1] - c[1]) - (e[1] - c[1]) * (b[0] - c[0]);
  const d3 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d4 = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function inside(p: P2, poly: P2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function polysOverlap(A: P2[], B: P2[]): boolean {
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const b = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) if (segHit(a, b, B[j], B[(j + 1) % B.length])) return true;
  }
  return inside(A[0], B) || inside(B[0], A);
}

/** Place a link's local outline for a joint at the origin bent by beta (deg, + = concave up). */
function pose(pts: P2[], side: -1 | 1, P: number, betaDeg: number): P2[] {
  const h = (side * betaDeg * Math.PI) / 360;
  const dx = Math.cos(h);
  const dz = Math.sin(h);
  const cx = side * P * dx;
  const cz = side * P * dz;
  return pts.map(([x, z]) => [cx + x * dx - z * dz, cz + x * dz + z * dx] as P2);
}

function clashes(d: PcDims, P: number, beta: number, Pplace = P): boolean {
  const bead = beadOutline(d);
  const knuckle = plateOutline(d, P);
  const cheek = mirrorX(knuckle);
  // Link i sits on the −X side of the joint with its knuckle, link i+1 on +X with its clevis.
  const ai = pose(bead, -1, Pplace, beta);
  const ki = pose(knuckle, -1, Pplace, beta);
  const bj = pose(bead, 1, Pplace, beta);
  const cj = pose(cheek, 1, Pplace, beta);
  // Knuckle and cheeks are in different Y slices, so they never meet each other.
  return polysOverlap(ai, bj) || polysOverlap(ki, bj) || polysOverlap(ai, cj);
}

function minPitch(d: PcDims): number {
  for (let p = Math.ceil(2 * d.R); p <= 200; p += 0.5) {
    // 1 mm clearance: the pair must still clear with the pins 1 mm closer to each bead.
    if (!clashes(d, p / 2, 0, p / 2 - 1)) return p;
  }
  return 200;
}

const rangeCache = new Map<string, { up: number; down: number }>();

/** How far a joint can bend before neighbouring links touch, degrees (2° margin), each way. */
export function hingeRange(d: PcDims, pitch: number): { up: number; down: number } {
  const key = `${d.shape}|${d.R}|${d.wall}|${d.tol}|${d.gap}|${d.hinge}|${d.pixel.id}|${pitch.toFixed(2)}`;
  const hit = rangeCache.get(key);
  if (hit) return hit;
  const P = pitch / 2;
  const scan = (sign: 1 | -1) => {
    let ok = 0;
    for (let b = 1; b <= 120; b++) {
      if (clashes(d, P, sign * b)) break;
      ok = b;
    }
    return Math.max(0, ok - 2);
  };
  const out = { up: scan(1), down: scan(-1) };
  if (rangeCache.size > 200) rangeCache.clear();
  rangeCache.set(key, out);
  return out;
}

/** The pitch a garland actually gets, and why it differs from what was asked. */
export function effectivePitch(d: PcDims, requested: number): { pitch: number; capped: boolean; raised: boolean } {
  const req = Number.isFinite(requested) && requested > 0 ? requested : d.pitchParam;
  const hi = Math.max(d.leadMax, 1);
  const lo = Math.min(d.pitchMin, hi);
  const pitch = Math.round(Math.min(hi, Math.max(lo, req)) * 10) / 10;
  return { pitch, capped: req > hi + 1e-9, raised: req < lo - 1e-9 };
}
