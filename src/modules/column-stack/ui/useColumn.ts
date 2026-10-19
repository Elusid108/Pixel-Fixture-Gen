import { useMemo } from 'react';
import type { Vec3 } from '../../../types';
import { useBench } from '../../../workbench/store';
import type { Selection } from '../../../workbench/system';
import { makeFacade } from '../../shared/facade';
import { nextId, r1 } from '../../shared/layout';
import { useSystemParams } from '../../shared/ui';
import { DEFAULT_DROP, newSegment, type CapKind, type ColumnDesign, type Mount, type Segment, type SegKind, type Stack } from '../model';
import { CS_PARAMS, csParams } from '../params';
import { planColumns, type CsPlan } from '../plan';
import { columnStackCore } from '../system';

/**
 * Column Stack's typed view of the Workbench store plus its edit actions. Every action commits
 * a whole new design (undo is per design snapshot).
 */

export const CS_ID = columnStackCore.id;
const fc = makeFacade<ColumnDesign>(CS_ID);

const mapStack = (d: ColumnDesign, id: string, fn: (s: Stack) => Stack): ColumnDesign => ({ ...d, stacks: d.stacks.map((s) => (s.id === id ? fn(s) : s)) });

/** The stack a palette action applies to: the selected stack, the selected segment's, or the last one. */
export function targetStack(d: ColumnDesign, sel: Selection): Stack | null {
  if (sel?.kind === 'stack') return d.stacks.find((s) => s.id === sel.id) ?? null;
  if (sel?.kind === 'segment') return d.stacks.find((s) => s.segments.some((g) => g.id === sel.id)) ?? null;
  return d.stacks[d.stacks.length - 1] ?? null;
}

/** Ceiling height that keeps a hanging drop clear of the floor, at least `want`. */
function ceilingFor(d: ColumnDesign, st: Stack, want: number): number {
  const plan = planColumns({ ...d, stacks: [{ ...st, mount: 'hang', pos: [st.pos[0], st.pos[1], 0] }] }, csParams(useBench.getState().params[CS_ID]));
  const need = plan.stacks[0] ? plan.stacks[0].height + 100 : 600;
  return Math.max(want, Math.ceil(need / 50) * 50);
}

export const csActions = {
  /** A new stack: base (or canopy), one ring band and a dome. */
  addStack(at: Vec3, mount: Mount): string {
    const d = fc.current();
    const id = nextId('T', d.stacks.map((s) => s.id));
    let st: Stack = { id, pos: [r1(at[0]), r1(at[1]), 0], mount, ...(mount === 'hang' ? { drop: DEFAULT_DROP } : {}), segments: [newSegment(d, 'band')], cap: 'dome' };
    if (mount === 'hang') st = { ...st, pos: [st.pos[0], st.pos[1], ceilingFor(d, st, r1(at[2]))] };
    fc.commit({ ...d, stacks: [...d.stacks, st] }, { selection: { kind: 'stack', id } });
    return id;
  },
  moveStack(id: string, pos: Vec3) {
    fc.commit(mapStack(fc.current(), id, (s) => ({ ...s, pos: pos.map(r1) as Vec3 })));
  },
  setMount(id: string, mount: Mount) {
    const d = fc.current();
    fc.commit(
      mapStack(d, id, (s) => {
        if (s.mount === mount) return s;
        if (mount === 'floor') return { id: s.id, pos: [s.pos[0], s.pos[1], 0], mount, segments: s.segments, cap: s.cap };
        const hung: Stack = { ...s, mount, drop: s.drop ?? DEFAULT_DROP };
        return { ...hung, pos: [s.pos[0], s.pos[1], ceilingFor(d, hung, 0)] };
      }),
    );
  },
  setDrop(id: string, drop: number) {
    fc.commit(mapStack(fc.current(), id, (s) => ({ ...s, drop: Math.max(0, r1(drop)) })));
  },
  setCap(id: string, cap: CapKind) {
    fc.commit(mapStack(fc.current(), id, (s) => ({ ...s, cap })));
  },
  appendSegment(stackId: string, kind: SegKind): string {
    const d = fc.current();
    const seg = newSegment(d, kind);
    fc.commit(mapStack(d, stackId, (s) => ({ ...s, segments: [...s.segments, seg] })), { selection: { kind: 'segment', id: seg.id } });
    return seg.id;
  },
  /** Move a segment one place along its stack: -1 toward the base / canopy, +1 toward the cap. */
  moveSegment(segId: string, dir: -1 | 1) {
    const d = fc.current();
    fc.commit({
      ...d,
      stacks: d.stacks.map((s) => {
        const i = s.segments.findIndex((g) => g.id === segId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.segments.length) return s;
        const segments = [...s.segments];
        [segments[i], segments[j]] = [segments[j], segments[i]];
        return { ...s, segments };
      }),
    });
  },
  /** Patch a segment's options. Changing the kind clears the old kind's options. */
  setSegment(segId: string, patch: Partial<Omit<Segment, 'id'>>) {
    const d = fc.current();
    fc.commit({
      ...d,
      stacks: d.stacks.map((s) => ({
        ...s,
        segments: s.segments.map((g) => {
          if (g.id !== segId) return g;
          if (patch.kind && patch.kind !== g.kind) return { id: g.id, kind: patch.kind };
          return { ...g, ...patch };
        }),
      })),
    });
  },
  remove(sel: NonNullable<Selection>) {
    fc.commit(columnStackCore.remove!(fc.current(), sel), { selection: null, pending: null });
  },
  rename(name: string) {
    fc.commit({ ...fc.current(), name });
  },
};

export const useColumn = fc.bind(csActions);

/** Resolved system params with the header's printer, as the worker sees them. */
export const useCsParams = () => useSystemParams(CS_ID, CS_PARAMS);

/** The same plan the build worker computes, for the bench, palette and inspector. */
export function useCsPlan(): CsPlan {
  const design = useColumn((s) => s.design);
  const params = useCsParams();
  return useMemo(() => planColumns(design, params), [design, params]);
}
