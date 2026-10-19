import { useMemo } from 'react';
import { planDesign, snParams, type SnPlan } from '../plan';
import type { Params } from '../../../types';
import { useHostParams } from '../../shared/ui';
import { useWorkbench } from './useSn';

/** Resolved system params for the bench, with the header's printer, fit gap and seat clearance. */
export function useSnParams(): Params {
  const params = useWorkbench((s) => s.params);
  const host = useHostParams();
  return useMemo(() => snParams({ ...host, ...params, printer: host.printer }), [params, host]);
}

/** The same analysis and data path the build worker computes, for the bench and inspector. */
export function useSnPlan(): SnPlan {
  const design = useWorkbench((s) => s.design);
  const params = useSnParams();
  return useMemo(() => planDesign(design, params), [design, params]);
}
