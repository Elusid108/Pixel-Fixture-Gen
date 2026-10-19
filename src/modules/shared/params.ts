import { resolveParams, str } from '../../fixtures/util';
import { BED_MARGIN, getPrinter, PRINTERS } from '../../printers';
import type { FixtureDef, ParamSpec, Params } from '../../types';

/**
 * Params every Workbench system module declares: the design JSON and the header's printer
 * (hidden, filled in by `buildParams`). Spread these first in a system's param list.
 */
export const DESIGN_PARAM: ParamSpec = { key: 'design', label: 'Design', type: 'json', default: '' };
export const PRINTER_PARAM: ParamSpec = {
  key: 'printer',
  label: 'Printer',
  type: 'select',
  default: 'bambu-256',
  options: PRINTERS.map((p) => ({ value: p.id, label: p.name })),
  hidden: true,
};

/** Defaults, clamping and unknown-key dropping for a param list, as the worker does it. */
export function resolveSpecs(specs: ParamSpec[], given: Params = {}): Params {
  return resolveParams({ params: specs } as FixtureDef, given);
}

/** Usable bed for the build's printer: footprint minus the edge margin, full height. */
export interface Bed {
  x: number;
  y: number;
  z: number;
  name: string;
  /** Shorter usable side: the safe length for anything that may be turned on the bed. */
  short: number;
  /** Usable diagonal (minus a little), for long thin parts laid corner to corner. */
  diag: number;
}

export function bedOf(params: Params): Bed {
  const p = getPrinter(str(params, 'printer'));
  const x = p.x - 2 * BED_MARGIN;
  const y = p.y - 2 * BED_MARGIN;
  return { x, y, z: p.z, name: p.name, short: Math.min(x, y), diag: Math.hypot(x, y) - 10 };
}

/** System params + design JSON + printer: the shape every `SystemCore.buildParams` returns. */
export function buildParamsWith(specs: ParamSpec[], design: unknown, params: Params, printerId: string): Params {
  return { ...resolveSpecs(specs, { ...params, printer: printerId }), design: JSON.stringify(design) };
}
