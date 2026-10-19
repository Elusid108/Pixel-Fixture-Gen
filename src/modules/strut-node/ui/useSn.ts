import { useBench, type BenchState } from '../../../workbench/store';
import type { Selection } from '../../../workbench/system';
import type { Params, Vec3 } from '../../../types';
import { nextId, type SnDesign } from '../model';
import { strutNodeCore } from '../system';

/**
 * Strut & Node's typed view of the generic Workbench store: the design typed as SnDesign,
 * plus the system's own edit actions. Selectors stay referentially stable (actions are module
 * constants, the design and params come straight from the store), so zustand doesn't loop.
 */

export type Tool = 'select' | 'add' | 'connect' | 'order';
export type { Selection };

const ID = strutNodeCore.id;
const EMPTY: Params = {};
const bench = useBench.getState;
const current = () => bench().designs[ID] as SnDesign;
const commit = (d: SnDesign, extra?: Partial<BenchState>) => bench().commit(d, extra);
const r1 = (v: number) => Math.round(v * 10) / 10;

export const snActions = {
  addNode(pos: Vec3, linkFrom?: string | null): string {
    const d = current();
    const id = nextId('H', d.nodes.map((n) => n.id));
    const nodes = [...d.nodes, { id, pos: pos.map(r1) as Vec3 }];
    let struts = d.struts;
    if (linkFrom && d.nodes.some((n) => n.id === linkFrom)) {
      struts = [...struts, { id: nextId('S', struts.map((s) => s.id)), a: linkFrom, b: id }];
    }
    commit({ ...d, nodes, struts, controller: d.controller || id }, { selection: { kind: 'node', id } });
    return id;
  },
  moveNode(id: string, pos: Vec3) {
    const d = current();
    commit({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, pos: pos.map(r1) as Vec3 } : n)) });
  },
  connect(a: string, b: string): string | null {
    const d = current();
    if (a === b || d.struts.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) return null;
    const id = nextId('S', d.struts.map((s) => s.id));
    commit({ ...d, struts: [...d.struts, { id, a, b }] });
    return id;
  },
  remove(sel: NonNullable<Selection>) {
    commit(strutNodeCore.remove!(current(), sel), { selection: null, pending: null });
  },
  toggleStrut(id: string, key: 'dark' | 'flip') {
    const d = current();
    commit({ ...d, struts: d.struts.map((s) => (s.id === id ? { ...s, [key]: !s[key] } : s)) });
  },
  setController(id: string) {
    commit({ ...current(), controller: id });
  },
  clickOrder(id: string) {
    const d = current();
    // Clicking the last picked strut again un-picks it; anything else appends.
    const order = d.order[d.order.length - 1] === id ? d.order.slice(0, -1) : [...d.order.filter((o) => o !== id), id];
    commit({ ...d, order }, { selection: { kind: 'strut', id } });
  },
  resetOrder() {
    commit({ ...current(), order: [] });
  },
  rename(name: string) {
    commit({ ...current(), name });
  },
};

export type SnView = Omit<BenchState, 'params'> & typeof snActions & { design: SnDesign; params: Params };

function view(s: BenchState): SnView {
  return { ...s, ...snActions, design: s.designs[ID] as SnDesign, params: s.params[ID] ?? EMPTY };
}

export function useWorkbench<T>(selector: (v: SnView) => T): T {
  return useBench((s) => selector(view(s)));
}
useWorkbench.getState = (): SnView => view(bench());
