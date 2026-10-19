import { create } from 'zustand';
import type { Vec3 } from '../types';
import { load, save } from '../ui/store';
import { idMaker } from './ops';
import { emptySketch, planeXY, planeXZ, planeYZ, type Sketch, type SketchPath, type SketchPlane, type SketchRegion } from './types';

/**
 * The drawing engine's state. The sketch is shared by every system (draw once, generate into
 * Linea, then into Pixel Chain) and has its own undo history; generating into a system goes
 * through that system's undo instead.
 */

const KEY = 'pfg.sketch';
const HISTORY = 80;

export type PlaneKind = 'XY' | 'XZ' | 'YZ' | 'custom';

export interface Draft {
  tool: string;
  pts: Vec3[];
  /** The plane each point was placed on; a polyline that changes plane becomes a 3D path. */
  planes: SketchPlane[];
}

export interface SketchState {
  sketch: Sketch;
  past: Sketch[];
  future: Sketch[];
  selected: string[];
  draft: Draft | null;
  planeKind: PlaneKind;
  /** Offset along the plane normal: Z for XY, Y for XZ, X for YZ. */
  offset: number;
  custom: SketchPlane | null;
  /** Shift-free 15° angle snapping while drawing. */
  angleSnap: boolean;
  /** Snap to existing endpoints and midpoints. */
  vertexSnap: boolean;
  show: boolean;
  sides: number;

  commit(sketch: Sketch, extra?: Partial<SketchState>): void;
  add(paths: SketchPath[], regions: SketchRegion[]): void;
  undo(): void;
  redo(): void;
  select(id: string, additive?: boolean): void;
  selectAll(): void;
  clearSelection(): void;
  removeSelected(): void;
  clearAll(): void;
  setDraft(d: Draft | null): void;
  setPlane(kind: PlaneKind, offset?: number, custom?: SketchPlane | null): void;
  set<K extends 'angleSnap' | 'vertexSnap' | 'show' | 'sides' | 'offset'>(k: K, v: SketchState[K]): void;
}

export function planeOf(kind: PlaneKind, offset: number, custom: SketchPlane | null): SketchPlane {
  if (kind === 'custom' && custom) return custom;
  if (kind === 'XZ') return planeXZ(offset);
  if (kind === 'YZ') return planeYZ(offset);
  return planeXY(offset);
}

export const activePlane = (s: Pick<SketchState, 'planeKind' | 'offset' | 'custom'>) => planeOf(s.planeKind, s.offset, s.custom);

export function ids(s: Sketch) {
  return {
    path: idMaker('P', s.paths.map((p) => p.id)),
    region: idMaker('R', s.regions.map((r) => r.id)),
  };
}

const saved = load<{ sketch?: Sketch; planeKind?: PlaneKind; offset?: number } | null>(KEY, null);

export const useSketch = create<SketchState>((set, get) => {
  const persist = () => {
    const s = get();
    save(KEY, { sketch: s.sketch, planeKind: s.planeKind === 'custom' ? 'XY' : s.planeKind, offset: s.offset });
  };
  const commit = (sketch: Sketch, extra: Partial<SketchState> = {}) => {
    const { past, sketch: prev } = get();
    set({ sketch, past: [...past, prev].slice(-HISTORY), future: [], ...extra });
    persist();
  };
  return {
    sketch: saved?.sketch && Array.isArray(saved.sketch.paths) && Array.isArray(saved.sketch.regions) ? saved.sketch : emptySketch(),
    past: [],
    future: [],
    selected: [],
    draft: null,
    planeKind: saved?.planeKind ?? 'XY',
    offset: saved?.offset ?? 0,
    custom: null,
    angleSnap: true,
    vertexSnap: true,
    show: true,
    sides: 6,

    commit,
    add: (paths, regions) => {
      const s = get().sketch;
      commit({ paths: [...s.paths, ...paths], regions: [...s.regions, ...regions] }, { selected: [...paths.map((p) => p.id), ...regions.map((r) => r.id)] });
    },
    undo: () => {
      const { past, future, sketch } = get();
      if (!past.length) return;
      set({ sketch: past[past.length - 1], past: past.slice(0, -1), future: [sketch, ...future], selected: [], draft: null });
      persist();
    },
    redo: () => {
      const { past, future, sketch } = get();
      if (!future.length) return;
      set({ sketch: future[0], future: future.slice(1), past: [...past, sketch], selected: [], draft: null });
      persist();
    },
    select: (id, additive) => {
      const sel = get().selected;
      set({ selected: additive ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id] });
    },
    selectAll: () => {
      const s = get().sketch;
      set({ selected: [...s.paths.map((p) => p.id), ...s.regions.map((r) => r.id)] });
    },
    clearSelection: () => set({ selected: [] }),
    removeSelected: () => {
      const { sketch, selected } = get();
      if (!selected.length) return;
      const gone = new Set(selected);
      commit({ paths: sketch.paths.filter((p) => !gone.has(p.id)), regions: sketch.regions.filter((r) => !gone.has(r.id)) }, { selected: [] });
    },
    clearAll: () => commit(emptySketch(), { selected: [], draft: null }),
    setDraft: (draft) => set({ draft }),
    setPlane: (planeKind, offset, custom) => {
      set({ planeKind, offset: offset ?? get().offset, custom: custom === undefined ? get().custom : custom });
      persist();
    },
    set: (k, v) => {
      set({ [k]: v } as Partial<SketchState>);
      if (k === 'offset') persist();
    },
  };
});

if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __sketch: typeof useSketch }).__sketch = useSketch;
