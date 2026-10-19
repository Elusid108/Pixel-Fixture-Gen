import { useMemo } from 'react';
import { bounds2 } from '../../../sketch/geom';
import type { SketchPlane, Vec2 } from '../../../sketch/types';
import type { Params, Vec3 } from '../../../types';
import { r1 } from '../../shared/layout';
import { makeFacade } from '../../shared/facade';
import { useSystemParams } from '../../shared/ui';
import { layoutWall, type HwLayout } from '../layout';
import type { HwDesign, HwStart } from '../model';
import { HW_PARAMS } from '../params';
import { toggleSlot } from '../system';

/**
 * Hive wall's typed view of the bench store, plus its edit actions. Every action commits one
 * new design (one undo step).
 */

export const HW_ID = 'hive-wall';
const hw = makeFacade<HwDesign>(HW_ID);

/** Drag handle ids for outline vertices: hwv:<area>:<loop, -1 = outer>:<index>. */
export const vertexId = (area: string, loop: number, idx: number) => `hwv:${area}:${loop}:${idx}`;
export function parseVertexId(id: string): { area: string; loop: number; idx: number } | null {
  const m = /^hwv:([^:]+):(-?\d+):(\d+)$/.exec(id);
  return m ? { area: m[1], loop: Number(m[2]), idx: Number(m[3]) } : null;
}

export function withVertex(d: HwDesign, area: string, loop: number, idx: number, p: Vec2): HwDesign {
  return {
    ...d,
    areas: d.areas.map((a) => {
      if (a.id !== area) return a;
      const set = (l: Vec2[]) => l.map((q, k) => (k === idx ? p : q));
      return loop < 0 ? { ...a, outer: set(a.outer) } : { ...a, holes: a.holes.map((h, k) => (k === loop ? set(h) : h)) };
    }),
  };
}

export const hwActions = {
  rename(name: string) {
    hw.commit({ ...hw.current(), name });
  },
  /** Tile tool click: undo the slot's override, or switch it off (placed) / on as a whole tile (empty). */
  toggle(key: string, natural: boolean) {
    hw.commit(toggleSlot(hw.current(), key, natural), { selection: { kind: 'tile', id: key } });
  },
  /** Force a whole, untrimmed tile into a slot, or drop that override. */
  setWhole(key: string, whole: boolean) {
    const d = hw.current();
    const on = d.on.filter((k) => k !== key);
    hw.commit({ ...d, on: whole ? [...on, key] : on, off: d.off.filter((k) => k !== key) });
  },
  setOff(key: string, off: boolean) {
    const d = hw.current();
    const offs = d.off.filter((k) => k !== key);
    hw.commit({ ...d, off: off ? [...offs, key] : offs, on: d.on.filter((k) => k !== key) });
  },
  clearOverrides() {
    hw.commit({ ...hw.current(), on: [], off: [] });
  },
  moveVertex(area: string, loop: number, idx: number, p: Vec2) {
    hw.commit(withVertex(hw.current(), area, loop, idx, [r1(p[0]), r1(p[1])]));
  },
  setLattice(lat: Partial<HwDesign['lattice']>) {
    const d = hw.current();
    hw.commit({ ...d, lattice: { ...d.lattice, ...lat } });
  },
  /** Centre a tile on the outline's bounds, so edge tiles trim symmetrically. */
  centreLattice() {
    const d = hw.current();
    const pts = d.areas.flatMap((a) => a.outer);
    if (!pts.length) return;
    const b = bounds2(pts);
    hw.commit({ ...d, lattice: { ...d.lattice, offset: [r1((b.min[0] + b.max[0]) / 2), r1((b.min[1] + b.max[1]) / 2)] } });
  },
  /** Flat-top rows (0°) ↔ pointy-top (30°). */
  turnLattice() {
    const d = hw.current();
    hw.commit({ ...d, lattice: { ...d.lattice, rot: d.lattice.rot === 0 ? 30 : 0 } });
  },
  setStart(start: HwStart) {
    hw.commit({ ...hw.current(), start });
  },
  removeArea(id: string) {
    const d = hw.current();
    hw.commit({ ...d, areas: d.areas.filter((a) => a.id !== id) }, { selection: null });
  },
  removeHoles(id: string) {
    const d = hw.current();
    hw.commit({ ...d, areas: d.areas.map((a) => (a.id === id ? { ...a, holes: [] } : a)) });
  },
};

export const useHw = hw.bind(hwActions);

export function useHwParams(): Params {
  return useSystemParams(HW_ID, HW_PARAMS);
}

/** Plane lifted along its normal (the front of the tiles), where overlays and handles live. */
export function liftPlane(pl: SketchPlane, n: Vec3, z: number): SketchPlane {
  return { origin: [pl.origin[0] + n[0] * z, pl.origin[1] + n[1] * z, pl.origin[2] + n[2] * z], u: pl.u, v: pl.v };
}

/** Last layout, shared by the scene, palette, inspector and data tab (they each resolve params). */
let cache: { design: HwDesign; key: string; layout: HwLayout } | null = null;

export function layoutFor(design: HwDesign, params: Params): HwLayout {
  const key = JSON.stringify(params);
  if (cache && cache.design === design && cache.key === key) return cache.layout;
  const layout = layoutWall(design, params);
  cache = { design, key, layout };
  return layout;
}

/** The same layout the build worker computes, for the scene, palette and inspector (stored design). */
export function useHwLayout(): HwLayout {
  const design = useHw((s) => s.design);
  const params = useHwParams();
  return useMemo(() => layoutFor(design, params), [design, params]);
}
