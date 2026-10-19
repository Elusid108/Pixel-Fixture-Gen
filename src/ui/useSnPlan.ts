import { useMemo } from 'react';
import { planDesign, snParams, type SnPlan } from '../modules/strut-node';
import { DEFAULT_PRINTER_ID } from '../printers';
import type { Params } from '../types';
import { useStore } from './store';
import { useWorkbench } from './workbenchStore';

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

/** Params for a worker build of the current design. */
export function useSnBuildParams(): Params {
  const design = useWorkbench((s) => s.design);
  const params = useSnParams();
  return useMemo(() => ({ ...params, design: JSON.stringify(design) }), [design, params]);
}
