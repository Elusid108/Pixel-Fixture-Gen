import { create } from 'zustand';
import { getPreset, nextId, parseDesign, type SnDesign } from '../modules/strut-node';
import type { Params, ParamValue, Vec3 } from '../types';
import { load, save } from './store';

export type Tool = 'select' | 'add' | 'connect' | 'order';
export type Selection = { kind: 'node' | 'strut'; id: string } | null;

const KEY = 'pfg.workbench';
const HISTORY = 80;

interface Saved {
  design: SnDesign;
  params: Params;
  snap: number;
}

interface WbState {
  design: SnDesign;
  /** System params (tube, hub, pixel…). The printer comes from the header. */
  params: Params;
  selection: Selection;
  tool: Tool;
  /** Connect tool: the hub a new strut starts from. */
  pending: string | null;
  /** Grid snap in mm; 0 is free. */
  snap: number;
  /** Height of the plane new hubs land on. */
  workZ: number;
  /** Live position of a hub being dragged; committed on release. */
  drag: { id: string; pos: Vec3 } | null;
  past: SnDesign[];
  future: SnDesign[];
  showParts: boolean;
  showChain: boolean;
  showLabels: boolean;
  /** Bumped when a whole new design arrives, so the camera re-frames. */
  frameSeq: number;

  loadPreset(id: string): void;
  clear(): void;
  edit(fn: (d: SnDesign) => SnDesign): void;
  undo(): void;
  redo(): void;
  select(s: Selection): void;
  setTool(t: Tool): void;
  setPending(id: string | null): void;
  setDrag(d: WbState['drag']): void;
  setParam(k: string, v: ParamValue): void;
  resetParams(): void;
  set<K extends 'snap' | 'workZ' | 'showParts' | 'showChain' | 'showLabels'>(k: K, v: WbState[K]): void;

  addNode(pos: Vec3, linkFrom?: string | null): string;
  moveNode(id: string, pos: Vec3): void;
  connect(a: string, b: string): string | null;
  remove(sel: NonNullable<Selection>): void;
  toggleStrut(id: string, key: 'dark' | 'flip'): void;
  setController(id: string): void;
  clickOrder(id: string): void;
  resetOrder(): void;
  rename(name: string): void;
}

const saved = load<Saved | null>(KEY, null);
const initial: SnDesign = saved?.design ? parseDesign(JSON.stringify(saved.design)) : getPreset('icosa').make();

function persist(s: Pick<WbState, 'design' | 'params' | 'snap'>) {
  save(KEY, { design: s.design, params: s.params, snap: s.snap } satisfies Saved);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export const useWorkbench = create<WbState>((set, get) => {
  const commit = (design: SnDesign, extra: Partial<WbState> = {}) => {
    const { past, design: prev } = get();
    set({ design, past: [...past, prev].slice(-HISTORY), future: [], ...extra });
    persist(get());
  };

  return {
    design: initial,
    params: saved?.params ?? {},
    selection: null,
    tool: 'select',
    pending: null,
    snap: saved?.snap ?? 10,
    workZ: 60,
    drag: null,
    past: [],
    future: [],
    showParts: true,
    showChain: true,
    showLabels: true,
    frameSeq: 0,

    loadPreset: (id) => commit(getPreset(id).make(), { selection: null, pending: null, frameSeq: get().frameSeq + 1 }),
    clear: () => commit({ name: 'Untitled', nodes: [], struts: [], controller: '', order: [] }, { selection: null, pending: null, tool: 'add' }),
    edit: (fn) => commit(fn(get().design)),
    undo: () => {
      const { past, future, design } = get();
      if (!past.length) return;
      set({ design: past[past.length - 1], past: past.slice(0, -1), future: [design, ...future], selection: null, pending: null });
      persist(get());
    },
    redo: () => {
      const { past, future, design } = get();
      if (!future.length) return;
      set({ design: future[0], future: future.slice(1), past: [...past, design], selection: null, pending: null });
      persist(get());
    },
    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool, pending: null }),
    setPending: (pending) => set({ pending }),
    setDrag: (drag) => set({ drag }),
    setParam: (k, v) => {
      set({ params: { ...get().params, [k]: v } });
      persist(get());
    },
    resetParams: () => {
      set({ params: {} });
      persist(get());
    },
    set: (k, v) => {
      set({ [k]: v } as Partial<WbState>);
      if (k === 'snap') persist(get());
    },

    addNode: (pos, linkFrom) => {
      const d = get().design;
      const id = nextId('H', d.nodes.map((n) => n.id));
      const nodes = [...d.nodes, { id, pos: pos.map(r1) as Vec3 }];
      let struts = d.struts;
      if (linkFrom && d.nodes.some((n) => n.id === linkFrom)) {
        struts = [...struts, { id: nextId('S', struts.map((s) => s.id)), a: linkFrom, b: id }];
      }
      commit({ ...d, nodes, struts, controller: d.controller || id }, { selection: { kind: 'node', id } });
      return id;
    },
    moveNode: (id, pos) => {
      const d = get().design;
      commit({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, pos: pos.map(r1) as Vec3 } : n)) });
    },
    connect: (a, b) => {
      const d = get().design;
      if (a === b || d.struts.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) return null;
      const id = nextId('S', d.struts.map((s) => s.id));
      commit({ ...d, struts: [...d.struts, { id, a, b }] });
      return id;
    },
    remove: (sel) => {
      const d = get().design;
      if (sel.kind === 'node') {
        const nodes = d.nodes.filter((n) => n.id !== sel.id);
        const struts = d.struts.filter((s) => s.a !== sel.id && s.b !== sel.id);
        const gone = new Set(d.struts.filter((s) => s.a === sel.id || s.b === sel.id).map((s) => s.id));
        commit(
          { ...d, nodes, struts, order: d.order.filter((o) => !gone.has(o)), controller: d.controller === sel.id ? (nodes[0]?.id ?? '') : d.controller },
          { selection: null, pending: null },
        );
      } else {
        commit({ ...d, struts: d.struts.filter((s) => s.id !== sel.id), order: d.order.filter((o) => o !== sel.id) }, { selection: null });
      }
    },
    toggleStrut: (id, key) => {
      const d = get().design;
      commit({ ...d, struts: d.struts.map((s) => (s.id === id ? { ...s, [key]: !s[key] } : s)) });
    },
    setController: (id) => {
      const d = get().design;
      commit({ ...d, controller: id });
    },
    clickOrder: (id) => {
      const d = get().design;
      // Clicking the last picked strut again un-picks it; anything else appends.
      const order = d.order[d.order.length - 1] === id ? d.order.slice(0, -1) : [...d.order.filter((o) => o !== id), id];
      commit({ ...d, order }, { selection: { kind: 'strut', id } });
    },
    resetOrder: () => {
      const d = get().design;
      commit({ ...d, order: [] });
    },
    rename: (name) => {
      const d = get().design;
      commit({ ...d, name });
    },
  };
});
