import { useMemo } from 'react';
import { toPlane } from '../../../sketch/geom';
import type { Vec2 } from '../../../sketch/types';
import type { Selection } from '../../../workbench/system';
import type { Params, Vec3 } from '../../../types';
import { makeFacade } from '../../shared/facade';
import { r1 } from '../../shared/layout';
import { useSystemParams } from '../../shared/ui';
import { bounds2 } from '../../../sketch/geom';
import { layoutFacets, type FwLayout } from '../layout';
import type { FwDesign, FwDriver, Level } from '../model';
import { FW_PARAMS } from '../params';
import { facetWallCore, parseVertexId } from '../system';

/**
 * Facet Wall's typed view of the bench store, its edit actions, and the layout hook the
 * scene, inspector and data tab share (with live drag preview).
 */

export type FwTool = 'select' | 'depth' | 'knock';

const fw = makeFacade<FwDesign>(facetWallCore.id);

/** Drag ids: vertex handles are "fwv:<vertexId>", the gradient arrow tip is "fwg". */
export const VERTEX_DRAG = 'fwv:';
export const GRADIENT_DRAG = 'fwg';

/** Where the gradient arrow starts: the middle of all outlines, plane coords. */
export function wallCentre(d: FwDesign): Vec2 {
  const pts = d.areas.flatMap((a) => a.outer);
  if (!pts.length) return [0, 0];
  const { min, max } = bounds2(pts);
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
}

export const angleTo = (d: FwDesign, p: Vec3): number => {
  const c = wallCentre(d);
  const q = toPlane(p, d.plane);
  return Math.round((Math.atan2(q[1] - c[1], q[0] - c[0]) * 180) / Math.PI);
};

function moveVertexIn(d: FwDesign, id: string, p: Vec2): FwDesign {
  const v = parseVertexId(id);
  if (!v) return d;
  const at: Vec2 = [r1(p[0]), r1(p[1])];
  return {
    ...d,
    areas: d.areas.map((a) => {
      if (a.id !== v.area) return a;
      if (v.loop === 0) return { ...a, outer: a.outer.map((q, i) => (i === v.i ? at : q)) };
      return { ...a, holes: a.holes.map((h, hi) => (hi === v.loop - 1 ? h.map((q, i) => (i === v.i ? at : q)) : h)) };
    }),
  };
}

/** The design with whatever is being dragged applied, for live previews. */
export function liveDesign(d: FwDesign, drag: { id: string; pos: Vec3 } | null): FwDesign {
  if (!drag) return d;
  if (drag.id.startsWith(VERTEX_DRAG)) return moveVertexIn(d, drag.id.slice(VERTEX_DRAG.length), toPlane(drag.pos, d.plane));
  if (drag.id === GRADIENT_DRAG) return { ...d, driver: { ...d.driver, angle: angleTo(d, drag.pos) } };
  return d;
}

export const fwActions = {
  rename(name: string) {
    fw.commit({ ...fw.current(), name });
  },
  moveVertex(id: string, p: Vec2) {
    fw.commit(moveVertexIn(fw.current(), id, p));
  },
  setDriver(patch: Partial<FwDriver>) {
    const d = fw.current();
    fw.commit({ ...d, driver: { ...d.driver, ...patch } });
  },
  /** Depth tool: step the facet to the next depth (an override). */
  cycleDepth(key: string, level: Level) {
    const d = fw.current();
    fw.commit({ ...d, overrides: { ...d.overrides, [key]: ((level + 1) % 3) as Level } }, { selection: { kind: 'facet', id: key } });
  },
  setDepth(key: string, level: Level | null) {
    const d = fw.current();
    const overrides = { ...d.overrides };
    if (level === null) delete overrides[key];
    else overrides[key] = level;
    fw.commit({ ...d, overrides });
  },
  clearOverrides() {
    fw.commit({ ...fw.current(), overrides: {} });
  },
  toggleOmit(key: string) {
    const d = fw.current();
    fw.commit({ ...d, omit: d.omit.includes(key) ? d.omit.filter((k) => k !== key) : [...d.omit, key] });
  },
  restoreAll() {
    fw.commit({ ...fw.current(), omit: [] });
  },
  remove(sel: NonNullable<Selection>) {
    fw.commit(facetWallCore.remove!(fw.current(), sel), { selection: null });
  },
};

export const useFw = fw.bind(fwActions);

export function useFwParams(): Params {
  return useSystemParams(facetWallCore.id, FW_PARAMS);
}

/** Same layout the worker builds from, with any drag in progress applied. */
export function useFwLayout(): FwLayout {
  const design = useFw((s) => s.design);
  const drag = useFw((s) => s.drag);
  const params = useFwParams();
  const live = useMemo(() => liveDesign(design, drag), [design, drag]);
  return useMemo(() => layoutFacets(live, params), [live, params]);
}

/** The live (drag-applied) design, for drawing outlines and handles. */
export function useLiveDesign(): FwDesign {
  const design = useFw((s) => s.design);
  const drag = useFw((s) => s.drag);
  return useMemo(() => liveDesign(design, drag), [design, drag]);
}
