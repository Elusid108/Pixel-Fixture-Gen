import { create } from 'zustand';
import type { BuildResult } from '../build/runBuild';
import type { Params, ParamValue } from '../types';

export type Effect = 'chase' | 'rainbow' | 'ripple' | 'warm' | 'off';
export type View = 'assembled' | 'plates';
export type Tab = 'schedule' | 'parts' | 'export';

const PRINTER_KEY = 'pfg.printer';
const PARAMS_KEY = 'pfg.params';

/* Browser storage is a convenience only: private windows and blocked storage just start fresh. */
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

interface State {
  fixtureId: string;
  params: Record<string, Params>;
  printerId: string | null;
  result: BuildResult | null;
  building: boolean;
  error: string | null;
  explode: number;
  view: View;
  plateIndex: number;
  effect: Effect;
  selectedPart: string | null;
  tab: Tab;
  setFixture(id: string): void;
  setParam(key: string, value: ParamValue): void;
  resetParams(): void;
  setPrinter(id: string): void;
  setResult(r: BuildResult | null, error?: string | null): void;
  setBuilding(b: boolean): void;
  set<K extends 'explode' | 'view' | 'plateIndex' | 'effect' | 'selectedPart' | 'tab'>(k: K, v: State[K]): void;
}

export const useStore = create<State>((set, get) => ({
  fixtureId: 'fresnel',
  params: load<Record<string, Params>>(PARAMS_KEY, {}),
  printerId: load<string | null>(PRINTER_KEY, null),
  result: null,
  building: false,
  error: null,
  explode: 0,
  view: 'assembled',
  plateIndex: 0,
  effect: 'chase',
  selectedPart: null,
  tab: 'schedule',
  setFixture: (id) => set({ fixtureId: id, selectedPart: null, plateIndex: 0, explode: 0 }),
  setParam: (key, value) => {
    const { fixtureId, params } = get();
    const next = { ...params, [fixtureId]: { ...params[fixtureId], [key]: value } };
    save(PARAMS_KEY, next);
    set({ params: next });
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
