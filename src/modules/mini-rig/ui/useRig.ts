import { create } from 'zustand';
import { dist } from '../../../geom/vec';
import type { Vec3 } from '../../../types';
import type { Selection } from '../../../workbench/system';
import { makeFacade } from '../../shared/facade';
import { r1 } from '../../shared/layout';
import { KINDS, nextId, type InstrumentKind, type MountSide, type RigDesign, type RigInstrument, type RigNode } from '../model';
import { TRUSS_W } from '../params';
import { MERGE_TOL, removeFrom, snapSegment } from '../system';

/**
 * Mini Rig's typed view of the bench store, plus its edit actions. Each action commits one
 * new design (one undo step). The instrument kind the Instrument tool places lives in its
 * own tiny store: it's a palette choice, not part of the design.
 */

export const SYSTEM_ID = 'mini-rig';
const rig = makeFacade<RigDesign>(SYSTEM_ID);
const WORLD_AXES: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const useRigTool = create<{ kind: InstrumentKind; setKind: (k: InstrumentKind) => void }>((set) => ({
  kind: 'par',
  setKind: (kind) => set({ kind }),
}));

const instId = (d: RigDesign, kind: InstrumentKind) => nextId(KINDS[kind].prefix, d.instruments.map((i) => i.id));

export const rigActions = {
  /** Truss tool: a node where the plane was clicked (or the node already there), spanned from `from`. */
  addNodeAt(p: Vec3, from?: string | null): string {
    const d = rig.current();
    const prev = from ? d.nodes.find((n) => n.id === from) : undefined;
    let pos: Vec3 = [p[0], p[1], Math.max(p[2], TRUSS_W / 2)];
    if (prev) pos = snapSegment(prev.pos, pos, WORLD_AXES);
    const hit = d.nodes.find((n) => dist(n.pos, pos) <= MERGE_TOL);
    let nodes = d.nodes;
    let id = hit?.id;
    if (!id) {
      id = nextId('N', d.nodes.map((n) => n.id));
      nodes = [...nodes, { id, pos: pos.map(r1) as Vec3, base: false, pick: false }];
    }
    let spans = d.spans;
    if (prev && prev.id !== id && !spans.some((s) => (s.a === prev.id && s.b === id) || (s.a === id && s.b === prev.id))) {
      spans = [...spans, { id: nextId('S', spans.map((s) => s.id)), a: prev.id, b: id }];
    }
    rig.commit({ ...d, nodes, spans, controller: d.controller || id }, { selection: { kind: 'node', id } });
    return id;
  },
  moveNode(id: string, pos: Vec3) {
    const d = rig.current();
    rig.commit({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, pos: pos.map(r1) as Vec3 } : n)) });
  },
  setNode(id: string, patch: Partial<Pick<RigNode, 'base' | 'pick'>>) {
    const d = rig.current();
    rig.commit({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  },
  connect(a: string, b: string): string | null {
    const d = rig.current();
    if (a === b || d.spans.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) return null;
    const id = nextId('S', d.spans.map((s) => s.id));
    rig.commit({ ...d, spans: [...d.spans, { id, a, b }] }, { selection: { kind: 'span', id } });
    return id;
  },
  addInstrument(span: string, t: number, side: MountSide, kind: InstrumentKind): string {
    const d = rig.current();
    const id = instId(d, kind);
    const inst: RigInstrument = { id, kind, span, t: Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000, side, pan: 0, tilt: side.startsWith('below') ? 30 : 0 };
    rig.commit({ ...d, instruments: [...d.instruments, inst] }, { selection: { kind: 'instrument', id } });
    return id;
  },
  updateInstrument(id: string, patch: Partial<Pick<RigInstrument, 't' | 'side' | 'pan' | 'tilt'>>) {
    const d = rig.current();
    rig.commit({ ...d, instruments: d.instruments.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  },
  /** Change an instrument's kind; it takes a fresh id when the unit letter changes (P → M). */
  setKind(id: string, kind: InstrumentKind) {
    const d = rig.current();
    const cur = d.instruments.find((i) => i.id === id);
    if (!cur || cur.kind === kind) return;
    const nid = KINDS[cur.kind].prefix === KINDS[kind].prefix ? id : instId(d, kind);
    rig.commit({ ...d, instruments: d.instruments.map((i) => (i.id === id ? { ...i, id: nid, kind } : i)) }, { selection: { kind: 'instrument', id: nid } });
  },
  remove(sel: NonNullable<Selection>) {
    rig.commit(removeFrom(rig.current(), sel), { selection: null, pending: null });
  },
  setController(id: string) {
    rig.commit({ ...rig.current(), controller: id });
  },
  rename(name: string) {
    rig.commit({ ...rig.current(), name });
  },
};

export const useRig = rig.bind(rigActions);
