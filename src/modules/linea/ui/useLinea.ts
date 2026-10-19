import { useMemo } from 'react';
import { create } from 'zustand';
import { planeXY, type SketchPlane } from '../../../sketch/types';
import { DEFAULT_PRINTER_ID } from '../../../printers';
import type { Params, Vec3 } from '../../../types';
import { useStore } from '../../../ui/store';
import { useBench } from '../../../workbench/store';
import type { Selection } from '../../../workbench/system';
import { makeFacade } from '../../shared/facade';
import { resolveSpecs } from '../../shared/params';
import { useSystemParams } from '../../shared/ui';
import { addPaths, moveVertex, relockRun } from '../lock';
import { clean, type LineaDesign } from '../model';
import { linDims, LINEA_PARAMS, type LinDims } from '../params';
import { scale, sub } from '../../../geom/vec';
import { planLinea, type LineaPlan } from '../plan';
import { lineaCore } from '../system';

/**
 * Linea's typed view of the bench store plus its edit actions. Every action commits a whole
 * new design, so undo works per edit.
 */

export const SYSTEM_ID = lineaCore.id;
const lin = makeFacade<LineaDesign>(SYSTEM_ID);

/** Resolved params as the worker sees them (for actions, outside React). */
function currentParams(): Params {
  const host = useStore.getState();
  const printer = host.printerId ?? DEFAULT_PRINTER_ID;
  return resolveSpecs(LINEA_PARAMS, { fit: host.fitGap, seat: host.seatClearance, ...(useBench.getState().params[SYSTEM_ID] ?? {}), printer });
}

const mapRun = (id: string, fn: (r: LineaDesign['runs'][number]) => LineaDesign['runs'][number]) => {
  const d = lin.current();
  return { ...d, runs: d.runs.map((r) => (r.id === id ? fn(r) : r)) };
};

export const linActions = {
  /** Commit a drawn run (the Run tool), pitch-locked like any sketch path. */
  addRun(pts: Vec3[], closed: boolean, plane: SketchPlane = planeXY(pts[0]?.[2] ?? 0)) {
    const before = lin.current();
    const d = addPaths(before, [{ pts, closed, plane }], currentParams());
    const added = d.runs.find((r) => !before.runs.some((b) => b.id === r.id));
    lin.commit(d, { selection: added ? { kind: 'run', id: added.id } : null, pending: null });
  },
  moveVertex(run: string, i: number, pos: Vec3) {
    lin.commit(moveVertex(lin.current(), run, i, pos, currentParams()));
  },
  relock(run: string) {
    lin.commit(relockRun(lin.current(), run, currentParams()));
  },
  /** After a pixel change: lock every run to the new pitch, in drawing order. */
  relockAll() {
    const params = currentParams();
    let d = lin.current();
    for (const r of d.runs) d = relockRun(d, r.id, params);
    lin.commit(d);
  },
  reverseRun(id: string) {
    lin.commit(mapRun(id, (r) => ({ ...r, pts: [...r.pts].reverse() })));
  },
  flipFace(id: string) {
    lin.commit(mapRun(id, (r) => ({ ...r, face: clean([-r.face[0], -r.face[1], -r.face[2]]) })));
  },
  setFeed(id: string) {
    lin.commit({ ...lin.current(), feed: id });
  },
  remove(sel: NonNullable<Selection>) {
    lin.commit(lineaCore.remove!(lin.current(), sel), { selection: null, pending: null });
  },
  rename(name: string) {
    lin.commit({ ...lin.current(), name });
  },
};

export const useLinea = lin.bind(linActions);

/** Resolved system params with the header's printer. */
export const useLineaParams = (): Params => useSystemParams(SYSTEM_ID, LINEA_PARAMS);

/** The same plan the build worker computes, for the inspector and data tab. */
export function useLineaPlan(): LineaPlan {
  const design = useLinea((s) => s.design);
  const params = useLineaParams();
  return useMemo(() => planLinea(design, params), [design, params]);
}

/** Vertex handles sit just above the bar tops, along the run's face. */
export const handleLift = (D: LinDims) => D.H + 2;

/** Live plan for the scene: follows a vertex being dragged (unlocked until release). */
export function useLivePlan(): LineaPlan {
  const design = useLinea((s) => s.design);
  const drag = useLinea((s) => s.drag);
  const params = useLineaParams();
  return useMemo(() => {
    let d = design;
    const m = drag?.id.match(/^v:(.+):(\d+)$/);
    if (drag && m) {
      const i = Number(m[2]);
      const lift = handleLift(linDims(params));
      d = { ...design, runs: design.runs.map((r) => (r.id === m[1] ? { ...r, pts: r.pts.map((p, j) => (j === i ? sub(drag.pos, scale(r.face, lift)) : p)) } : r)) };
    }
    return planLinea(d, params);
  }, [design, drag, params]);
}

/** The Run tool's points in progress (scene-local; Esc clears it through the bench `pending`). */
export const useDraft = create<{ pts: Vec3[]; set(pts: Vec3[]): void }>((set) => ({ pts: [], set: (pts) => set({ pts }) }));
