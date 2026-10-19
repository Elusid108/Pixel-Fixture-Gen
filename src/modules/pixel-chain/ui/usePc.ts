import { useMemo } from 'react';
import { dist } from '../../../geom/vec';
import type { Params, Vec3 } from '../../../types';
import { useBench } from '../../../workbench/store';
import type { Selection } from '../../../workbench/system';
import { makeFacade } from '../../shared/facade';
import { nextId, r1 } from '../../shared/layout';
import { useSystemParams } from '../../shared/ui';
import { DEFAULT_SAG, removeFromDesign, SAG_MAX, SAG_MIN, spanCount, type PcDesign, type PcGarland } from '../model';
import { PC_PARAMS } from '../params';
import { planChain, type PcPlan } from '../plan';
import { HANG_Z } from '../system';

export const PC_ID = 'pixel-chain';
const pc = makeFacade<PcDesign>(PC_ID);

/** While placing: `pending` is "P:x,y,z" after the first click, then the new garland's id. */
const FIRST = 'P:';
export function pendingFirst(pending: string | null): Vec3 | null {
  if (!pending?.startsWith(FIRST)) return null;
  const v = pending.slice(FIRST.length).split(',').map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? (v as Vec3) : null;
}

/** Click this close to a garland's first anchor (with 3+ anchors) to close it into a ring, mm. */
export const CLOSE_TOL = 20;

const rv = (p: Vec3) => p.map(r1) as Vec3;
const clampSag = (v: number) => Math.min(SAG_MAX, Math.max(SAG_MIN, v));

function editGarland(gid: string, fn: (g: PcGarland) => PcGarland, extra?: Parameters<typeof pc.commit>[1]) {
  const d = pc.current();
  pc.commit({ ...d, garlands: d.garlands.map((g) => (g.id === gid ? fn(g) : g)) }, extra);
}

function withSags(g: PcGarland): PcGarland {
  const n = spanCount(g);
  return { ...g, sags: Array.from({ length: n }, (_, i) => g.sags[i] ?? g.sags[g.sags.length - 1] ?? DEFAULT_SAG) };
}

export const pcActions = {
  /** The garland tool: first click marks a point, the second makes a garland, later clicks extend it. */
  placeAnchor(pos: Vec3) {
    const st = useBench.getState();
    const d = pc.current();
    const p = rv(pos);
    const first = pendingFirst(st.pending);
    if (first) {
      if (dist(first, p) < 1) return;
      const id = nextId('G', d.garlands.map((g) => g.id));
      pc.commit({ ...d, garlands: [...d.garlands, { id, anchors: [first, p], sags: [DEFAULT_SAG] }] }, { pending: id, selection: { kind: 'garland', id } });
      return;
    }
    const g = st.pending ? d.garlands.find((x) => x.id === st.pending) : undefined;
    if (g && !g.closed) {
      if (g.anchors.length >= 3 && dist(p, g.anchors[0]) <= CLOSE_TOL) {
        editGarland(g.id, (x) => withSags({ ...x, closed: true }), { pending: null });
        return;
      }
      if (dist(p, g.anchors[g.anchors.length - 1]) < 1) return;
      editGarland(g.id, (x) => withSags({ ...x, anchors: [...x.anchors, p] }), { pending: g.id });
      return;
    }
    st.setPending(`${FIRST}${p.join(',')}`);
  },
  moveAnchor(gid: string, i: number, pos: Vec3) {
    editGarland(gid, (g) => ({ ...g, anchors: g.anchors.map((a, k) => (k === i ? rv(pos) : a)) }));
  },
  setSag(gid: string, k: number, v: number) {
    editGarland(gid, (g) => ({ ...g, sags: g.sags.map((s, i) => (i === k ? clampSag(v) : s)) }));
  },
  setAllSags(gid: string, v: number) {
    editGarland(gid, (g) => ({ ...g, sags: g.sags.map(() => clampSag(v)) }));
  },
  setPitch(gid: string, v: number | null) {
    editGarland(gid, (g) => {
      const next = { ...g };
      if (v === null || !(v > 0)) delete next.pitch;
      else next.pitch = r1(v);
      return next;
    });
  },
  toggle(gid: string, key: 'closed' | 'reverse') {
    editGarland(gid, (g) => {
      const next = { ...g };
      if (next[key]) delete next[key];
      else if (key === 'reverse' || g.anchors.length >= 3) next[key] = true;
      return key === 'closed' ? withSags(next) : next;
    });
  },
  /** Add an anchor past the last one, continuing the last span's direction. */
  extend(gid: string) {
    editGarland(gid, (g) => {
      const a = g.anchors[g.anchors.length - 1];
      const b = g.anchors[g.anchors.length - 2];
      const step: Vec3 = b ? [a[0] - b[0], a[1] - b[1], 0] : [400, 0, 0];
      const L = Math.hypot(step[0], step[1]) || 1;
      const s = Math.max(300, Math.min(600, L)) / L;
      return withSags({ ...g, anchors: [...g.anchors, rv([a[0] + step[0] * s, a[1] + step[1] * s, a[2]])] });
    });
  },
  /** Move a garland earlier (−1) or later (+1) in data order. */
  reorder(gid: string, dir: -1 | 1) {
    const d = pc.current();
    const i = d.garlands.findIndex((g) => g.id === gid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.garlands.length) return;
    const garlands = [...d.garlands];
    [garlands[i], garlands[j]] = [garlands[j], garlands[i]];
    pc.commit({ ...d, garlands });
  },
  /** A fresh two-swag garland, in front of whatever is on the bench. */
  addSwag() {
    const d = pc.current();
    const id = nextId('G', d.garlands.map((g) => g.id));
    const ys = d.garlands.flatMap((g) => g.anchors.map((a) => a[1]));
    const y = ys.length ? Math.min(...ys) - 300 : 0;
    pc.commit(
      {
        ...d,
        garlands: [
          ...d.garlands,
          {
            id,
            anchors: [
              [-500, y, HANG_Z],
              [0, y, HANG_Z],
              [500, y, HANG_Z],
            ],
            sags: [DEFAULT_SAG, DEFAULT_SAG],
          },
        ],
      },
      { selection: { kind: 'garland', id }, frameSeq: useBench.getState().frameSeq + 1 },
    );
  },
  remove(sel: NonNullable<Selection>) {
    pc.commit(removeFromDesign(pc.current(), sel), { selection: null, pending: null });
  },
  rename(name: string) {
    pc.commit({ ...pc.current(), name });
  },
};

export const usePc = pc.bind(pcActions);

/** Resolved system params, as the worker sees them. */
export const usePcParams = () => useSystemParams(PC_ID, PC_PARAMS);

/**
 * planChain, remembered for the last couple of (design, params) pairs: the scene, palette,
 * inspector and data tab all ask for the same plan after every edit.
 */
const memo: { design: PcDesign; key: string; plan: PcPlan }[] = [];
export function planFor(design: PcDesign, params: Params): PcPlan {
  const key = JSON.stringify(params);
  const hit = memo.find((m) => m.design === design && m.key === key);
  if (hit) return hit.plan;
  const plan = planChain(design, params);
  memo.unshift({ design, key, plan });
  memo.length = Math.min(memo.length, 3);
  return plan;
}

/** The same plan the build runs, for the inspector, palette and data tab. */
export function usePcPlan(): PcPlan {
  const design = usePc((s) => s.design);
  const params = usePcParams();
  return useMemo(() => planFor(design, params), [design, params]);
}
