import { basis } from '../../geom/vec';
import { pcbLedOffsets, type PixelType } from '../../pixels/library';
import type { Mat4, Params, Vec3 } from '../../types';
import { fmt } from '../shared/layout';
import { CAPS, DEFAULT_DROP, KINDS, type CapKind, type ColumnDesign, type Mount, type Segment, type SegKind } from './model';
import { csDims, type CsDims } from './params';

/**
 * Column Stack planning: everything the build, the bench and the inspector share. Pure maths,
 * no React, three.js or manifold.
 *
 * Frames. Each segment is modelled upright in its own frame: shell from z=0 to z=h, spigot on
 * top up to h+J, socket (the bare shell bore) at the bottom. A stack has a *column* frame
 * (z=0 at the base's spigot root, +z along the column away from the base or canopy). Floor
 * stacks map it straight up; hanging drops map it with a 180° turn about X, so the column runs
 * down from the canopy and every part, joint and pixel follows without special cases.
 */

export interface Spot {
  pos: Vec3;
  normal: Vec3;
}

export type SegLayout =
  | { kind: 'helix'; Rt: number; zA: number; zB: number; dots: { a: number; z: number }[] }
  | { kind: 'band'; Rc: number; rb: number; rIn: number; Rf: number; zRead: number }
  | {
      kind: 'lattice';
      apo: number;
      faces: number[];
      zs0: number;
      zs1: number;
      perRun: number;
      win: { m: number; w: number; hd: number; rows: { z: number; phase: number }[] };
      spokeZ: number;
    }
  | { kind: 'louver'; rc: number; rise: number; tv: number; zTop: number; fins: number[]; cells: { a: number; zc: number; zm: number }[] }
  | { kind: 'ring'; rows: { z: number; phase: number }[]; n: number };

export interface SegPlan {
  id: string;
  kind: SegKind;
  /** 0 = next to the base / canopy. */
  index: number;
  unit: string;
  /** Column z of the segment's bottom. */
  z0: number;
  h: number;
  n: number;
  twist: number;
  /** Identical keys print as one part ×N. */
  key: string;
  pixel: PixelType;
  px: number;
  /** Physical items for the schedule: PCBs, nodes or mm of strip. */
  units: number;
  detail: string;
  layout: SegLayout;
  /** Pixel read points in the segment's frame, data order. */
  spots: Spot[];
}

export type CapLayout = { kind: 'dome'; t: number; zb: number; top: number } | { kind: 'fresnel'; Hc: number; lt: number } | { kind: 'finial'; top: number };

export interface CapPlan {
  kind: CapKind;
  unit: string;
  z0: number;
  h: number;
  pixel: PixelType | null;
  px: number;
  layout: CapLayout;
  spots: Spot[];
}

export interface StackPlan {
  id: string;
  /** "C1", by order. Units are named after it. */
  label: string;
  index: number;
  mount: Mount;
  pos: Vec3;
  drop: number;
  /** Column frame → world. */
  frame: Mat4;
  segs: SegPlan[];
  cap: CapPlan;
  /** Column z of the cap's top. */
  colTop: number;
  /** World Z extent of the whole stack, base or canopy included. */
  zMin: number;
  zMax: number;
  height: number;
  px: number;
  watts: number;
}

/** One lit schedule unit in data order, with world pixel spots. */
export interface CsUnit {
  unit: string;
  stackId: string;
  /** null for the cap. */
  segId: string | null;
  name: string;
  pixel: PixelType;
  px: number;
  units: number;
  detail: string;
  spots: Spot[];
}

export interface CsPlan {
  dims: CsDims;
  stacks: StackPlan[];
  units: CsUnit[];
  px: number;
  watts: number;
  volts: number[];
  warnings: string[];
}

const D2R = Math.PI / 180;
const pad2 = (i: number) => String(i).padStart(2, '0');

export function xfPoint(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
export function xfDir(m: Mat4, d: Vec3): Vec3 {
  return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
}

const radial = (a: number, r: number, z: number): Spot => ({ pos: [r * Math.cos(a), r * Math.sin(a), z], normal: [Math.cos(a), Math.sin(a), 0] });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Highest z a feature may reach before the top ledge cone, in a segment of height h. */
export const featureTop = (d: CsDims, h: number) => h - 2 - (d.Ri - d.rsi) - 1;

/** Segment option values with kind defaults and clamps applied (before layout-driven raises). */
export function segOptions(seg: Segment, d: CsDims): { h: number; n: number; twist: number } {
  const k = KINDS[seg.kind];
  const h = clamp(seg.h ?? k.h, k.minH, d.maxSegH);
  const n = k.n ? clamp(Math.round(seg.n ?? k.n.def), k.n.min, k.n.max) : 0;
  const twist = k.twist ? clamp(seg.twist ?? 360, -720, 720) : 0;
  return { h, n, twist };
}

/* ---------------- Segment layouts ---------------- */

function helixLayout(d: CsDims, h: number, nReq: number, twist: number, warn: (s: string) => void) {
  const depth = d.dot.shape.kind === 'round' ? d.dot.shape.depth : 2.8;
  // Thick wall: 1 mm window skin + the PCB seat + 1.4 mm behind it.
  const Rt = Math.min(d.Ri, Math.max(d.rsi + 0.6, d.R - (1 + depth + 1.4)));
  const zA = d.J + 1 + (d.Ri - Rt);
  const zB = h - 2 - (Rt - d.rsi);
  const z0 = zA + 6.5;
  const z1 = zB - 6.5;
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = (i + 0.5) / n;
      return { a: twist * t * D2R, z: z0 + (z1 - z0) * t };
    });
  const gap = (ds: { a: number; z: number }[]) => {
    let g = Infinity;
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) g = Math.min(g, Math.hypot(2 * d.R * Math.sin((ds[i].a - ds[j].a) / 2), ds[i].z - ds[j].z));
    return g;
  };
  let n = nReq;
  while (n > 1 && gap(make(n)) < 12.5) n--;
  if (n < nReq) warn(`Helix dots: ${nReq} dots crowd each other on a ${fmt(h)} mm segment with ${fmt(twist)}° twist; using ${n}.`);
  const dots = make(n);
  return { layout: { kind: 'helix' as const, Rt, zA, zB, dots }, spots: dots.map((p) => radial(p.a, d.R, p.z)), n };
}

function bandLayout(d: CsDims, hReq: number) {
  const ring = d.ring;
  const sh = ring.shape.kind === 'ring' ? ring.shape : { od: 44.5, id: 31.8 };
  const ledR = ring.ledRadii?.[0]?.r ?? (sh.od + sh.id) / 4;
  // The carrier drops into the shell bore with the fit gap across.
  const Rc = d.Ri - d.side;
  const rb = Math.min(14, sh.id / 2 - 0.8);
  // Where the funnel's upper face meets the stem, clear of the wire chase.
  const rIn = Math.max(rb - 2.3, d.chaseR + 0.5);
  const Rf = Math.min(ledR + 7, Rc - 3);
  // The funnel's top, in the band's frame; the band must be tall enough to hold it.
  const funnelTop = d.J + d.carrierT + (Rf - rb);
  const h = clamp(Math.max(hReq, funnelTop + 6.5), KINDS.band.minH, d.maxSegH);
  const zRead = d.J + d.carrierT + (ledR - rb);
  const spots = pcbLedOffsets(ring).map(([x, y]) => radial(Math.atan2(y, x), d.R, zRead));
  return { layout: { kind: 'band' as const, Rc, rb, rIn, Rf, zRead }, spots, h };
}

function latticeLayout(d: CsDims, h: number, n: number) {
  const apo = 14;
  const pitch = d.strip.shape.kind === 'strip' ? d.strip.shape.pitch : 1000 / 60;
  const faces = Array.from({ length: n }, (_, f) => (f * 2 * Math.PI) / n);
  const zs0 = 8;
  const zs1 = h - 8;
  const perRun = Math.max(1, Math.floor((zs1 - zs0) / pitch));
  const start = zs0 + (zs1 - zs0 - perRun * pitch) / 2;
  const spots: Spot[] = [];
  faces.forEach((a, f) => {
    for (let i = 0; i < perRun; i++) {
      const k = f % 2 ? perRun - 1 - i : i;
      spots.push(radial(a, apo, start + pitch * (k + 0.5)));
    }
  });
  // Diamond windows: sides steeper than 45° so they bridge cleanly. Above the spoke roots.
  const m = Math.max(8, Math.round((2 * Math.PI * d.R) / 22));
  const w = (2 * Math.PI * d.R) / m - 4.5;
  const hd = 1.6 * w;
  const step = hd / 2 + 2.6;
  const zw0 = d.J + 8.5;
  const zw1 = featureTop(d, h) - 1;
  const rows: { z: number; phase: number }[] = [];
  for (let k = 0; zw0 + hd / 2 + k * step + hd / 2 <= zw1; k++) rows.push({ z: zw0 + hd / 2 + k * step, phase: k % 2 ? Math.PI / m : 0 });
  return { layout: { kind: 'lattice' as const, apo, faces, zs0, zs1, perRun, win: { m, w, hd, rows }, spokeZ: d.J + 2 }, spots, pitch };
}

function louverCells(d: CsDims, h: number, n: number) {
  const rc = 15;
  const th = d.louverAngle * D2R;
  const rise = (d.R - rc) * Math.tan(th);
  const tv = 1.6 / Math.cos(th);
  const p = d.louverPitch;
  const zTop = h - 8;
  // The top louver runs up under the top ring, so the ring prints on it rather than over air.
  const zK = zTop - (d.Ri - rc) * Math.tan(th) - tv + 0.4;
  const fins: number[] = [];
  for (let z = zK; z + rise + tv > 0; z -= p) fins.push(z);
  const gaps: { zc: number; zm: number }[] = [];
  for (let j = 1; j < fins.length; j++) {
    const zl = fins[j];
    const zc = zl + tv + (p - tv) / 2;
    const zm = zl + rise + tv + (p - tv) / 2;
    if (zc - 5.5 >= 0.5 && zl + rise + tv >= d.J + 3) gaps.push({ zc, zm });
  }
  gaps.sort((a, b) => a.zc - b.zc);
  const cells: { a: number; zc: number; zm: number }[] = [];
  gaps.forEach((g, gi) => {
    for (let i = 0; i < n; i++) {
      const k = gi % 2 ? n - 1 - i : i;
      cells.push({ a: ((k + 0.5) * 2 * Math.PI) / n, zc: g.zc, zm: g.zm });
    }
  });
  return { rc, rise, tv, zTop, fins, cells, gaps: gaps.length };
}

function louverLayout(d: CsDims, hReq: number, n: number, warn: (s: string) => void) {
  // Raise the segment until it holds at least two gaps of cells.
  let h = hReq;
  let L = louverCells(d, h, n);
  while (L.gaps < 2 && h < d.maxSegH) {
    h = Math.min(d.maxSegH, h + 2);
    L = louverCells(d, h, n);
  }
  if (h > hReq) warn(`Louver: raised to ${fmt(h)} mm to fit two cell gaps at ${fmt(d.louverAngle)}° and ${fmt(d.louverPitch)} mm pitch.`);
  if (!L.gaps) warn('Louver: no pixel cell fits at this angle and diameter. Use a shallower angle or a smaller column.');
  const spots = L.cells.map((c) => radial(c.a, d.R, c.zm));
  return { layout: { kind: 'louver' as const, rc: L.rc, rise: L.rise, tv: L.tv, zTop: L.zTop, fins: L.fins, cells: L.cells }, spots, h };
}

/** Most bullet nodes that fit side by side in one ring before their bodies touch inside. */
export function maxNodesPerRing(d: CsDims): number {
  const nodeD = d.node.shape.kind === 'round' ? d.node.shape.d : 12;
  const rTip = d.R - 25;
  if (rTip <= nodeD / 2) return 4;
  return Math.max(3, Math.floor(Math.PI / Math.asin(Math.min(1, (nodeD / 2 + 0.4) / rTip))));
}

function ringLayout(d: CsDims, h: number, nReq: number, warn: (s: string) => void) {
  const nMax = maxNodesPerRing(d);
  const n = Math.min(nReq, nMax);
  if (n < nReq) warn(`Pixel ring: ${nReq} nodes per ring collide inside a Ø${fmt(2 * d.R)} column; using ${n}.`);
  const z0 = d.J + 1.5 + 7;
  const z1 = featureTop(d, h) - 7;
  const span = z1 - z0;
  const count = span <= 0 ? 1 : 1 + Math.floor(span / 28);
  const rows = Array.from({ length: count }, (_, r) => ({ z: count === 1 ? (z0 + z1) / 2 : z0 + (span * r) / (count - 1), phase: r % 2 ? Math.PI / n : 0 }));
  const spots: Spot[] = [];
  rows.forEach((row, r) => {
    for (let i = 0; i < n; i++) {
      const k = r % 2 ? n - 1 - i : i;
      spots.push(radial(row.phase + (k * 2 * Math.PI) / n, d.R + 3, row.z));
    }
  });
  return { layout: { kind: 'ring' as const, rows, n }, spots, n };
}

/** Lay out one segment: resolved options, geometry numbers and pixel spots in data order. */
export function planSegment(seg: Segment, d: CsDims, warn: (s: string) => void = () => {}): Omit<SegPlan, 'index' | 'unit' | 'z0'> {
  const o = segOptions(seg, d);
  const base = { id: seg.id, kind: seg.kind, twist: o.twist };
  switch (seg.kind) {
    case 'helix': {
      const L = helixLayout(d, o.h, o.n, o.twist, warn);
      return { ...base, h: o.h, n: L.n, key: `helix|${o.h}|${L.n}|${o.twist}`, pixel: d.dot, px: L.spots.length, units: L.spots.length, detail: `${L.spots.length} dots · ${fmt(o.twist)}° twist`, layout: L.layout, spots: L.spots };
    }
    case 'band': {
      const L = bandLayout(d, o.h);
      return { ...base, h: L.h, n: 0, key: `band|${L.h}`, pixel: d.ring, px: L.spots.length, units: 1, detail: `${d.ring.pxPerUnit}-px ring under a reflector`, layout: L.layout, spots: L.spots };
    }
    case 'lattice': {
      const L = latticeLayout(d, o.h, o.n);
      const px = L.spots.length;
      return { ...base, h: o.h, n: o.n, key: `lattice|${o.h}|${o.n}`, pixel: d.strip, px, units: Math.round(px * L.pitch), detail: `${o.n} runs × ${L.layout.perRun} px`, layout: L.layout, spots: L.spots };
    }
    case 'louver': {
      const L = louverLayout(d, o.h, o.n, warn);
      const gaps = o.n ? L.spots.length / o.n : 0;
      return { ...base, h: L.h, n: o.n, key: `louver|${L.h}|${o.n}`, pixel: d.dot, px: L.spots.length, units: L.spots.length, detail: `${gaps} gaps × ${o.n} cells`, layout: L.layout, spots: L.spots };
    }
    case 'ring': {
      const L = ringLayout(d, o.h, o.n, warn);
      return { ...base, h: o.h, n: L.n, key: `ring|${o.h}|${L.n}`, pixel: d.node, px: L.spots.length, units: L.spots.length, detail: `${L.layout.rows.length} × ${L.n} nodes`, layout: L.layout, spots: L.spots };
    }
  }
}

/** Cap geometry numbers and pixel spots, in the cap's own frame (socket at z=0). */
export function planCap(kind: CapKind, d: CsDims): Omit<CapPlan, 'unit' | 'z0'> {
  const jewel = pcbLedOffsets(d.jewel);
  if (kind === 'dome') {
    const t = 1.8;
    const zb = d.ridgeZ + (d.R - t - (d.Ri - 1.5));
    const top = zb + d.R * Math.SQRT2;
    // LEDs read on the 45° cone near the tip.
    const spots = jewel.map(([x, y]) => ({ pos: [x, y, top - Math.hypot(x, y)] as Vec3, normal: [0, 0, 1] as Vec3 }));
    return { kind, h: top, pixel: d.jewel, px: spots.length, layout: { kind, t, zb, top }, spots };
  }
  if (kind === 'fresnel') {
    const lt = 3.2;
    const Hc = d.ridgeZ + 1.5 + 22 + lt;
    const spots = jewel.map(([x, y]) => ({ pos: [x, y, Hc] as Vec3, normal: [0, 0, 1] as Vec3 }));
    return { kind, h: Hc, pixel: d.jewel, px: spots.length, layout: { kind, Hc, lt }, spots };
  }
  const R = d.R;
  const top = d.J + 3 + 0.55 * R + 6 + 0.15 * R + 4 + 0.9 * R;
  return { kind, h: top, pixel: null, px: 0, layout: { kind: 'finial', top }, spots: [] };
}

/** Column → world for a stack. */
export function stackFrame(mount: Mount, pos: Vec3, drop: number, d: CsDims): { frame: Mat4; Z0: number } {
  if (mount === 'floor') {
    const Z0 = pos[2] + d.baseTop;
    return { frame: basis([1, 0, 0], [0, 1, 0], [0, 0, 1], [pos[0], pos[1], Z0]), Z0 };
  }
  const Z0 = pos[2] - d.canopyH - drop - d.hangerT;
  return { frame: basis([1, 0, 0], [0, -1, 0], [0, 0, -1], [pos[0], pos[1], Z0]), Z0 };
}

export const stackLabel = (i: number) => `C${i + 1}`;

/** The whole design: stacks, segments, caps, units in data order, totals and warnings. */
export function planColumns(design: ColumnDesign, params: Params): CsPlan {
  const d = csDims(params);
  const warnings = new Set<string>();
  const warn = (s: string) => warnings.add(s);
  const stacks: StackPlan[] = [];
  const units: CsUnit[] = [];

  design.stacks.forEach((st, si) => {
    const label = stackLabel(si);
    const drop = clamp(st.drop ?? DEFAULT_DROP, 0, 3000);
    const { frame, Z0 } = stackFrame(st.mount, st.pos, drop, d);
    let z = 0;
    const segs: SegPlan[] = st.segments.map((seg, i) => {
      const sp = planSegment(seg, d, warn);
      const out: SegPlan = { ...sp, index: i, unit: `${label}-S${pad2(i + 1)}`, z0: z };
      z += sp.h;
      return out;
    });
    const cap: CapPlan = { ...planCap(st.cap, d), unit: `${label}-CAP`, z0: z };
    const colTop = z + cap.h;
    const zMin = st.mount === 'floor' ? st.pos[2] : Z0 - colTop;
    const zMax = st.mount === 'floor' ? Z0 + colTop : st.pos[2];
    const lit = [...segs.map((s) => ({ s, cap: false })), ...(cap.px ? [{ s: cap, cap: true }] : [])];
    let px = 0;
    let watts = 0;
    const dirWord = st.mount === 'floor' ? 'up from the base' : 'down from the canopy';
    for (const { s, cap: isCap } of lit) {
      const pixel = s.pixel!;
      const lift = (p: Vec3): Vec3 => [p[0], p[1], p[2] + s.z0];
      const spots = s.spots.map((q) => ({ pos: xfPoint(frame, lift(q.pos)), normal: xfDir(frame, q.normal) }));
      const sp = s as SegPlan;
      units.push({
        unit: s.unit,
        stackId: st.id,
        segId: isCap ? null : sp.id,
        name: isCap ? CAPS[cap.kind].name : `${KINDS[sp.kind].name} · ${sp.index + 1} of ${segs.length} ${dirWord}`,
        pixel,
        px: s.px,
        units: isCap ? 1 : sp.units,
        detail: isCap ? `${pixel.pxPerUnit}-px jewel` : sp.detail,
        spots,
      });
      px += s.px;
      watts += s.px * pixel.wattsPerPx;
    }
    stacks.push({ id: st.id, label, index: si, mount: st.mount, pos: st.pos, drop, frame, segs, cap, colTop, zMin, zMax, height: zMax - zMin, px, watts });
    if (st.mount === 'floor' && zMax - zMin > 5 * 2 * d.baseR)
      warn(`${label} stands ${fmt(zMax - zMin, 0)} mm tall on a Ø${fmt(2 * d.baseR)} base. Weight the bay (a steel disc under the PSU) or anchor it.`);
    if (st.mount === 'hang' && zMin < 0) warn(`${label} hangs below the floor. Raise its canopy or shorten the drop.`);
  });

  // Footprint clashes on the bench.
  for (let i = 0; i < stacks.length; i++)
    for (let j = i + 1; j < stacks.length; j++) {
      const a = stacks[i];
      const b = stacks[j];
      const ra = a.mount === 'floor' ? d.baseR : d.canopyR;
      const rb = b.mount === 'floor' ? d.baseR : d.canopyR;
      const overlapZ = a.zMin < b.zMax && b.zMin < a.zMax;
      if (overlapZ && Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < Math.max(ra, rb) + Math.min(ra, rb) - 2) warn(`${a.label} and ${b.label} overlap on the bench.`);
    }

  const volts = [...new Set(units.map((u) => u.pixel.volts))].sort((a, b) => a - b);
  if (volts.length > 1) warn(`Segments mix ${volts.join(' V and ')} V pixels. Feed each voltage from its own supply and share only ground and data.`);

  return {
    dims: d,
    stacks,
    units,
    px: units.reduce((s, u) => s + u.px, 0),
    watts: units.reduce((s, u) => s + u.px * u.pixel.wattsPerPx, 0),
    volts,
    warnings: [...warnings],
  };
}

/** Bench framing: the box around every stack, base and canopy. */
export function designBounds(design: ColumnDesign, params: Params): { min: Vec3; max: Vec3 } | null {
  const plan = planColumns(design, params);
  if (!plan.stacks.length) return null;
  const d = plan.dims;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of plan.stacks) {
    const r = s.mount === 'floor' ? d.baseR : d.canopyR;
    min[0] = Math.min(min[0], s.pos[0] - r);
    min[1] = Math.min(min[1], s.pos[1] - r);
    min[2] = Math.min(min[2], s.zMin);
    max[0] = Math.max(max[0], s.pos[0] + r);
    max[1] = Math.max(max[1], s.pos[1] + r);
    max[2] = Math.max(max[2], s.zMax);
  }
  return { min, max };
}
