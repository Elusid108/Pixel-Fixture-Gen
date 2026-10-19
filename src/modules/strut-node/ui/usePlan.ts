import { useMemo } from 'react';
import { planDesign, snParams, type SnPlan } from '../plan';
import { DEFAULT_PRINTER_ID } from '../../../printers';
import type { Params } from '../../../types';
import { useStore } from '../../../ui/store';
import { useWorkbench } from './useSn';

/** Resolved system params for the bench, with the header's printer. */
export function useSnParams(): Params {
  const params = useWorkbench((s) => s.params);
  const printerId = useStore((s) => s.printerId);
  return useMemo(() => snParams({ ...params, printer: printerId ?? DEFAULT_PRINTER_ID }), [params, printerId]);
}

/** The same analysis and data path the build worker computes, for the bench and inspector. */
export function useSnPlan(): SnPlan {
  const design = useWorkbench((s) => s.design);
  const params = useSnParams();
  return useMemo(() => planDesign(design, params), [design, params]);
}
