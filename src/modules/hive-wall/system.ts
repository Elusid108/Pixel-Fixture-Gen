import { add, cross, dot, norm, scale, sub } from '../../geom/vec';
import { bounds2, ccw, circlePts, cw, fromPlane, toPlane } from '../../sketch/geom';
import { type SketchPlane, type SketchRegion, type Vec2 } from '../../sketch/types';
import type { Params, Vec3 } from '../../types';
import type { BenchPreset, Selection, SystemCore } from '../../workbench/system';
import { nextId, r1 } from '../shared/layout';
import { buildParamsWith } from '../shared/params';
import { clusterOutline, hwDims, slotAt } from './layout';
import { emptyDesign, parseDesign, type HwArea, type HwDesign } from './model';
import { HW_PARAMS } from './params';

/* ---------------- Sketch adapter ---------------- */

const normalOf = (pl: SketchPlane): Vec3 => norm(cross(pl.u, pl.v));

/** Same plane (either facing): parallel normals and the origins on one plane, within a millimetre. */
export function coplanar(a: SketchPlane, b: SketchPlane): boolean {
  const n = normalOf(a);
  return Math.abs(dot(n, normalOf(b))) > 0.999 && Math.abs(dot(sub(b.origin, a.origin), n)) < 1;
}

const loopIn = (loop: Vec2[], from: SketchPlane, to: SketchPlane): Vec2[] => loop.map((p) => toPlane(fromPlane(p, from), to).map(r1) as Vec2);

/**
 * Drawn regions → Hive wall areas.
 *
 * - Empty design: the first region's plane becomes the wall, every region on that plane becomes
 *   an area, and the lattice is centred on the first region's bounds so edge tiles trim
 *   symmetrically.
 * - Existing wall: regions on the wall's plane (either facing) are converted into its coords and
 *   appended as further areas; the lattice and hand overrides stay. If none of the regions lies
 *   on the wall's plane, the wall moves to the new plane and the regions replace its areas
 *   (a wall is one plane).
 *
 * Areas are meant not to overlap. Where they do, the build still unions them exactly; the
 * planner's counts treat them as separate.
 */
export function fromRegions(regions: SketchRegion[], design: HwDesign): HwDesign {
  const usable = regions.filter((r) => r.outer.length >= 3);
  if (!usable.length) return design;
  const onWall = design.areas.length ? usable.filter((r) => coplanar(r.plane, design.plane)) : [];
  const fresh = !design.areas.length || !onWall.length;
  const plane = fresh ? usable[0].plane : design.plane;
  const take = fresh ? usable.filter((r) => r === usable[0] || coplanar(r.plane, plane)) : onWall;
  const areas: HwArea[] = fresh ? [] : [...design.areas];
  for (const r of take) {
    areas.push({
      id: nextId('A', areas.map((a) => a.id)),
      outer: ccw(loopIn(r.outer, r.plane, plane)),
      holes: r.holes.filter((h) => h.length >= 3).map((h) => cw(loopIn(h, r.plane, plane))),
    });
  }
  if (!fresh) return { ...design, areas };
  const b = bounds2(areas[0].outer);
  return {
    ...design,
    plane,
    areas,
    lattice: { offset: [r1((b.min[0] + b.max[0]) / 2), r1((b.min[1] + b.max[1]) / 2)], rot: 0 },
    off: [],
    on: [],
  };
}

/* ---------------- Presets ---------------- */

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function windowWall(): HwDesign {
  // Five columns by three rows of M tiles (default pitch). The outer columns are trimmed down
  // the side, the odd columns end in half tiles top and bottom, and a round window bites into
  // the two tiles either side of it.
  const d = hwDims({});
  const w = r1(2 * d.colW + 25);
  const h = r1(3 * d.D);
  const window = cw(circlePts([d.colW / 2, 1.5 * d.D], 50, 6).map((p) => p.map(r1) as Vec2));
  return { ...emptyDesign(), name: 'Window wall', areas: [{ id: 'A01', outer: rect(-w, 0, w, h), holes: [window] }], lattice: { offset: [0, r1(d.D / 2)], rot: 0 } };
}

function honeycomb(): HwDesign {
  // 19 M tiles (two rings) at the default 30 mm pitch, outline traced around them.
  const d = hwDims({});
  const slots: [number, number][] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > 2) continue;
      const a = (30 * Math.PI) / 180;
      slots.push(slotAt([q * d.D * Math.cos(a), q * d.D * Math.sin(a) + r * d.D], d));
    }
  }
  const lift = r1(2 * d.D + d.A + 10);
  const outer = clusterOutline(slots, d).map(([x, y]) => [r1(x), r1(y + lift)] as Vec2);
  return { ...emptyDesign(), name: 'Honeycomb 19', areas: [{ id: 'A01', outer: ccw(outer), holes: [] }], lattice: { offset: [0, lift], rot: 0 } };
}

function diamond(): HwDesign {
  return {
    ...emptyDesign(),
    name: 'Diamond',
    areas: [
      {
        id: 'A01',
        outer: [
          [0, 0],
          [360, 340],
          [0, 680],
          [-360, 340],
        ],
        holes: [],
      },
    ],
    lattice: { offset: [0, 414], rot: 0 },
  };
}

const PRESETS: BenchPreset<HwDesign>[] = [
  { id: 'window', code: 'WIN', name: 'Window wall', blurb: 'A 565 × 446 mm wall of M tiles with a round window: whole tiles, trimmed and half tiles at the edges, and two tiles cut around the hole.', make: windowWall },
  { id: 'honeycomb', code: 'H19', name: 'Honeycomb 19', blurb: 'Nineteen whole M tiles in a big hex. One tile type, 361 cells.', make: honeycomb },
  { id: 'diamond', code: 'DIA', name: 'Diamond', blurb: 'A freeform diamond: every edge tile trimmed on the diagonal, with closing walls.', make: diamond },
];

/* ---------------- Core ---------------- */

/** Toggle a slot by hand: undo an override if there is one, otherwise switch it off (on when `place`). */
export function toggleSlot(d: HwDesign, key: string, placedNaturally: boolean): HwDesign {
  if (d.on.includes(key)) return { ...d, on: d.on.filter((k) => k !== key) };
  if (d.off.includes(key)) return { ...d, off: d.off.filter((k) => k !== key) };
  return placedNaturally ? { ...d, off: [...d.off, key] } : { ...d, on: [...d.on, key] };
}

function frame(d: HwDesign): { center: Vec3; radius: number } {
  const pts = d.areas.flatMap((a) => a.outer);
  if (!pts.length) return { center: [0, 0, 200], radius: 600 };
  const b = bounds2(pts);
  const c = fromPlane([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2], d.plane);
  const n = normalOf(d.plane);
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2;
  return { center: add(c, scale(n, 30)), radius: Math.max(250, r * 1.45) };
}

/** M1 Hive wall, pure half. */
export const hiveWallCore: SystemCore<HwDesign> = {
  id: 'hive-wall',
  code: 'M1',
  name: 'Hive wall',
  tagline: 'Hex pixel tiles filling any outline, trimmed at the edges, hung on cleat rails.',
  moduleId: 'hive-wall',
  empty: emptyDesign,
  parse: parseDesign,
  presets: PRESETS,
  buildParams: (design: HwDesign, params: Params, printerId: string) => buildParamsWith(HW_PARAMS, design, params, printerId),
  frame,
  remove: (d: HwDesign, sel: NonNullable<Selection>) => {
    // Delete on a tile takes it out: drop a hand-placed tile, or switch the slot off.
    if (sel.kind === 'tile') return d.on.includes(sel.id) ? { ...d, on: d.on.filter((k) => k !== sel.id) } : d.off.includes(sel.id) ? d : { ...d, off: [...d.off, sel.id] };
    if (sel.kind === 'area') return { ...d, areas: d.areas.filter((a) => a.id !== sel.id) };
    return d;
  },
  fromRegions: (regions: SketchRegion[], design: HwDesign) => fromRegions(regions, design),
};
