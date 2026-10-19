import { create } from 'zustand';
import type { BuildResult } from '../build/runBuild';
import { DEFAULT_FIT_GAP, DEFAULT_SEAT } from '../fit';
import type { Params, ParamValue } from '../types';

export type Effect = 'chase' | 'rainbow' | 'ripple' | 'warm' | 'off';
export type View = 'assembled' | 'plates';
export type Tab = 'schedule' | 'parts' | 'data' | 'export';
/** Catalogue: one fixture at a time. Workbench: build a system from components. */
export type Mode = 'catalog' | 'workbench';

const PRINTER_KEY = 'pfg.printer';
const FIT_KEY = 'pfg.fit';
const PARAMS_KEY = 'pfg.params';
const MODE_KEY = 'pfg.mode';

/* Browser storage is a convenience only: private windows and blocked storage just start fresh. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

interface State {
  mode: Mode;
  fixtureId: string;
  params: Record<string, Params>;
  printerId: string | null;
  /** Global fit gap between mating printed parts, mm. */
  fitGap: number;
  /** Global pixel seat clearance, mm. */
  seatClearance: number;
  result: BuildResult | null;
  building: boolean;
  error: string | null;
  explode: number;
  view: View;
  plateIndex: number;
  effect: Effect;
  selectedPart: string | null;
  tab: Tab;
  setMode(m: Mode): void;
  setFixture(id: string): void;
  setParam(key: string, value: ParamValue): void;
  /** Drop a stored param so the default (or the global setting) applies again. */
  unsetParam(key: string): void;
  resetParams(): void;
  setFit(fitGap: number, seatClearance: number): void;
  setPrinter(id: string): void;
  setResult(r: BuildResult | null, error?: string | null): void;
  setBuilding(b: boolean): void;
  set<K extends 'explode' | 'view' | 'plateIndex' | 'effect' | 'selectedPart' | 'tab'>(k: K, v: State[K]): void;
}

export const useStore = create<State>((set, get) => ({
  mode: load<Mode>(MODE_KEY, 'catalog') === 'workbench' ? 'workbench' : 'catalog',
  fixtureId: 'fresnel',
  params: load<Record<string, Params>>(PARAMS_KEY, {}),
  printerId: load<string | null>(PRINTER_KEY, null),
  fitGap: load<{ fit?: number }>(FIT_KEY, {}).fit ?? DEFAULT_FIT_GAP,
  seatClearance: load<{ seat?: number }>(FIT_KEY, {}).seat ?? DEFAULT_SEAT,
  result: null,
  building: false,
  error: null,
  explode: 0,
  view: 'assembled',
  plateIndex: 0,
  effect: 'chase',
  selectedPart: null,
  tab: 'schedule',
  setMode: (mode) => {
    if (mode === get().mode) return;
    save(MODE_KEY, mode);
    // Drop the other mode's build so panels never show a mismatched schedule.
    set({ mode, result: null, error: null, selectedPart: null, plateIndex: 0, view: 'assembled', tab: get().tab === 'data' ? 'schedule' : get().tab });
  },
  setFixture: (id) => set({ fixtureId: id, selectedPart: null, plateIndex: 0, explode: 0 }),
  setParam: (key, value) => {
    const { fixtureId, params } = get();
    const next = { ...params, [fixtureId]: { ...params[fixtureId], [key]: value } };
    save(PARAMS_KEY, next);
    set({ params: next });
  },
  unsetParam: (key) => {
    const { fixtureId, params } = get();
    const rest = { ...params[fixtureId] };
    delete rest[key];
    const next = { ...params, [fixtureId]: rest };
    save(PARAMS_KEY, next);
    set({ params: next });
  },
  setFit: (fitGap, seatClearance) => {
    const f = Math.max(0, Math.min(1, fitGap));
    const sc = Math.max(0, Math.min(0.6, seatClearance));
    save(FIT_KEY, { fit: f, seat: sc });
    set({ fitGap: f, seatClearance: sc });
  },
  resetParams: () => {
    const { fixtureId, params } = get();
    const next = { ...params, [fixtureId]: {} };
    save(PARAMS_KEY, next);
    set({ params: next });
  },
  setPrinter: (id) => {
    save(PRINTER_KEY, id);
    set({ printerId: id, plateIndex: 0 });
  },
  setResult: (result, error = null) => set({ result, error }),
  setBuilding: (building) => set({ building }),
  set: (k, v) => set({ [k]: v } as Partial<State>),
}));
