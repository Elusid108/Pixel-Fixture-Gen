import { useMemo } from 'react';
import type { Params } from '../../../types';
import { useSystemParams } from '../../shared/ui';
import { RIG_PARAMS } from '../params';
import { planRig, type RigPlan } from '../plan';
import { SYSTEM_ID, useRig } from './useRig';

/** System params as the worker sees them (defaults + the header's printer). */
export function useRigParams(): Params {
  return useSystemParams(SYSTEM_ID, RIG_PARAMS);
}

/** The plan the build uses, for the inspector and data tab. */
export function useRigPlan(): RigPlan {
  const design = useRig((s) => s.design);
  const params = useRigParams();
  return useMemo(() => planRig(design, params), [design, params]);
}

/** The plan with a node mid-drag at its live position, so spans and instruments follow the handle. */
export function useLiveRigPlan(): RigPlan {
  const design = useRig((s) => s.design);
  const drag = useRig((s) => s.drag);
  const params = useRigParams();
  return useMemo(() => {
    const live = drag && design.nodes.some((n) => n.id === drag.id) ? { ...design, nodes: design.nodes.map((n) => (n.id === drag.id ? { ...n, pos: drag.pos } : n)) } : design;
    return planRig(live, params);
  }, [design, drag, params]);
}
