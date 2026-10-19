import { create } from 'zustand';
import type { Params, ParamValue, Vec3 } from '../types';
import { load, save } from '../ui/store';
import { getCore, SYSTEM_CORES } from './cores';
import type { Selection } from './system';

/**
 * The Workbench store, generic over systems. Each system keeps its own design, params and
 * undo history; switching systems keeps everything. Designs are immutable JSON, so undo is
 * whole-design snapshots.
 */

const KEY = 'pfg.bench';
const LEGACY_KEY = 'pfg.workbench';
const HISTORY = 80;

interface Saved {
  system: string;
  designs: Record<string, unknown>;
  params: Record<string, Params>;
  snap: number;
}

export interface BenchState {
  system: string;
  designs: Record<string, unknown>;
  /** System params (tube, pixel…) per system. The printer comes from the header. */
  params: Record<string, Params>;
  past: Record<string, unknown[]>;
  future: Record<string, unknown[]>;
  selection: Selection;
  /** Active tool id: a system tool, or a sketch tool ("draw:…"). */
  tool: string;
  /** Multi-click tools (strut chains, polylines): the entity in progress. */
  pending: string | null;
  /** Grid snap in mm; 0 is free. */
  snap: number;
  /** Height of the plane new points land on. */
  workZ: number;
  /** Live position of something being dragged; committed on release. */
  drag: { id: string; pos: Vec3 } | null;
  showParts: boolean;
  showChain: boolean;
  showLabels: boolean;
  /** Bumped when a whole new design arrives, so the camera re-frames. */
  frameSeq: number;

  setSystem(id: string): void;
  commit(design: unknown, extra?: Partial<BenchState>): void;
  edit(fn: (d: unknown) => unknown): void;
  undo(): void;
  redo(): void;
  loadPreset(id: string): void;
  clear(): void;
  removeSelection(): void;
  select(s: Selection): void;
  setTool(t: string): void;
  setPending(id: string | null): void;
  setDrag(d: BenchState['drag']): void;
  setParam(k: string, v: ParamValue): void;
  resetParams(): void;
  set<K extends 'snap' | 'workZ' | 'showParts' | 'showChain' | 'showLabels'>(k: K, v: BenchState[K]): void;
}

const EMPTY_PARAMS: Params = {};
const EMPTY_LIST: unknown[] = [];

function initial(): Pick<BenchState, 'system' | 'designs' | 'params' | 'snap'> {
  const saved = load<Saved | null>(KEY, null);
  const legacy = saved ? null : load<{ design?: unknown; params?: Params; snap?: number } | null>(LEGACY_KEY, null);
  const designs: Record<string, unknown> = {};
  for (const core of SYSTEM_CORES) {
    const raw = saved?.designs?.[core.id] ?? (core.id === 'strut-node' ? legacy?.design : undefined);
    designs[core.id] = raw ? core.parse(JSON.stringify(raw)) : (core.presets[0]?.make() ?? core.empty());
  }
  const params = saved?.params ?? (legacy?.params ? { 'strut-node': legacy.params } : {});
  const system = saved && SYSTEM_CORES.some((c) => c.id === saved.system) ? saved.system : SYSTEM_CORES[0].id;
  return { system, designs, params, snap: saved?.snap ?? legacy?.snap ?? 10 };
}

function persist(s: BenchState) {
  save(KEY, { system: s.system, designs: s.designs, params: s.params, snap: s.snap } satisfies Saved);
}

export const designOf = (s: Pick<BenchState, 'designs' | 'system'>): unknown => s.designs[s.system];
export const paramsOf = (s: Pick<BenchState, 'params' | 'system'>): Params => s.params[s.system] ?? EMPTY_PARAMS;
export const pastOf = (s: Pick<BenchState, 'past' | 'system'>): unknown[] => s.past[s.system] ?? EMPTY_LIST;
export const futureOf = (s: Pick<BenchState, 'future' | 'system'>): unknown[] => s.future[s.system] ?? EMPTY_LIST;

export const useBench = create<BenchState>((set, get) => {
  const commit = (design: unknown, extra: Partial<BenchState> = {}) => {
    const s = get();
    const sys = s.system;
    set({
      designs: { ...s.designs, [sys]: design },
      past: { ...s.past, [sys]: [...pastOf(s), designOf(s)].slice(-HISTORY) },
      future: { ...s.future, [sys]: [] },
      ...extra,
    });
    persist(get());
  };
  const reset = { selection: null, pending: null, drag: null } as const;

  return {
    ...initial(),
    past: {},
    future: {},
    selection: null,
    tool: 'select',
    pending: null,
    workZ: 60,
    drag: null,
    showParts: true,
    showChain: true,
    showLabels: true,
    frameSeq: 0,

    setSystem: (id) => {
      if (id === get().system) return;
      set({ system: id, tool: 'select', ...reset, frameSeq: get().frameSeq + 1 });
      persist(get());
    },
    commit,
    edit: (fn) => commit(fn(designOf(get()))),
    undo: () => {
      const s = get();
      const past = pastOf(s);
      if (!past.length) return;
      set({
        designs: { ...s.designs, [s.system]: past[past.length - 1] },
        past: { ...s.past, [s.system]: past.slice(0, -1) },
        future: { ...s.future, [s.system]: [designOf(s), ...futureOf(s)] },
        ...reset,
      });
      persist(get());
    },
    redo: () => {
      const s = get();
      const future = futureOf(s);
      if (!future.length) return;
      set({
        designs: { ...s.designs, [s.system]: future[0] },
        future: { ...s.future, [s.system]: future.slice(1) },
        past: { ...s.past, [s.system]: [...pastOf(s), designOf(s)] },
        ...reset,
      });
      persist(get());
    },
    loadPreset: (id) => {
      const core = getCore(get().system);
      const p = core.presets.find((x) => x.id === id);
      if (p) commit(p.make(), { ...reset, frameSeq: get().frameSeq + 1 });
    },
    clear: () => commit(getCore(get().system).empty(), { ...reset }),
    removeSelection: () => {
      const s = get();
      const core = getCore(s.system);
      if (!s.selection || !core.remove) return;
      commit(core.remove(designOf(s), s.selection), { ...reset });
    },
    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool, pending: null }),
    setPending: (pending) => set({ pending }),
    setDrag: (drag) => set({ drag }),
    setParam: (k, v) => {
      const s = get();
      set({ params: { ...s.params, [s.system]: { ...paramsOf(s), [k]: v } } });
      persist(get());
    },
    resetParams: () => {
      const s = get();
      set({ params: { ...s.params, [s.system]: {} } });
      persist(get());
    },
    set: (k, v) => {
      set({ [k]: v } as Partial<BenchState>);
      if (k === 'snap') persist(get());
    },
  };
});

// Dev-only handle for poking the bench from the browser console.
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __bench: typeof useBench }).__bench = useBench;
