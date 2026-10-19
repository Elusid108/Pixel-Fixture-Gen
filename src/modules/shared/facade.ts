import { useBench, type BenchState } from '../../workbench/store';
import type { Params } from '../../types';

/**
 * A system's typed view of the generic Workbench store, the way `strut-node/ui/useSn.ts` does
 * it by hand: the design typed as `D`, the system's params, and its own edit actions.
 *
 *   const lin = makeFacade<LineaDesign>('linea');
 *   export const linActions = { addRun(...) { lin.commit({ ...lin.current(), ... }) } };
 *   export const useLinea = lin.bind(linActions);
 *   const runs = useLinea((s) => s.design.runs);   // in components
 *   useLinea.getState().addRun(...)                 // in handlers
 *
 * Selectors stay referentially stable (actions are module constants, the design and params
 * come straight from the store), so zustand doesn't loop. Select fields, not whole views.
 */

const EMPTY: Params = {};

export type View<D, A> = Omit<BenchState, 'params'> & A & { design: D; params: Params };

export interface Facade<D> {
  id: string;
  current(): D;
  commit(d: D, extra?: Partial<BenchState>): void;
  /** Typed hook + getState over the store, with `actions` merged in. */
  bind<A extends object>(actions: A): {
    <T>(selector: (v: View<D, A>) => T): T;
    getState(): View<D, A>;
  };
}

export function makeFacade<D>(id: string): Facade<D> {
  const bench = useBench.getState;
  return {
    id,
    current: () => bench().designs[id] as D,
    commit: (d, extra) => bench().commit(d, extra),
    bind<A extends object>(actions: A) {
      const view = (s: BenchState): View<D, A> => ({ ...s, ...actions, design: s.designs[id] as D, params: s.params[id] ?? EMPTY });
      const hook = <T>(selector: (v: View<D, A>) => T): T => useBench((s) => selector(view(s)));
      hook.getState = (): View<D, A> => view(bench());
      return hook;
    },
  };
}
