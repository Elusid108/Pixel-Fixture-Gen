import type { FixtureDef, ParamSpec, Params } from './types';

/**
 * Fit: how printed parts meet. Two global settings, both chosen in the header and overridable
 * per fixture:
 *
 * - **Fit gap**: the total gap between mating printed parts (spigot in socket, dovetail in
 *   slot, key in pocket, sleeve over can, pin in hole). Default 0.4 mm, which suits most FDM
 *   printers with a 0.4 nozzle. A joint modelled with gap g has its female feature g/2 bigger
 *   on each side (diametral gap g for round fits).
 * - **Seat clearance**: the radial clearance around a pixel in its socket. Tighter, because
 *   pixels need to grip.
 *
 * Fixtures opt in by spreading FIT_PARAMS into their params and reading fitOf / seatOf. The host
 * fills both from the header (or the fixture's override) on every build, and the values are
 * recorded in the exported 3MF.
 */

export const DEFAULT_FIT_GAP = 0.4;
export const DEFAULT_SEAT = 0.15;

export const FIT_PARAMS: ParamSpec[] = [
  {
    key: 'fit',
    label: 'Fit gap',
    type: 'number',
    default: DEFAULT_FIT_GAP,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'mm',
    hidden: true,
    group: 'Fit',
    help: 'Total gap between mating printed parts.',
  },
  {
    key: 'seat',
    label: 'Pixel seat clearance',
    type: 'number',
    default: DEFAULT_SEAT,
    min: 0,
    max: 0.6,
    step: 0.05,
    unit: 'mm',
    hidden: true,
    group: 'Fit',
    help: 'Radial clearance around each pixel in its socket.',
  },
];

const n = (p: Params, k: string, d: number) => {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : d;
};

/** Total gap between mating printed parts, mm. */
export const fitOf = (p: Params): number => n(p, 'fit', DEFAULT_FIT_GAP);
/** Radial clearance around a pixel in its socket, mm. */
export const seatOf = (p: Params): number => n(p, 'seat', DEFAULT_SEAT);
/** Per-side clearance for a fit: half the gap. */
export const sideOf = (p: Params): number => fitOf(p) / 2;

export interface HostSettings {
  printerId: string;
  fit: number;
  seat: number;
}

/**
 * Fill the host-owned hidden params a fixture declares: the printer always comes from the
 * header; fit and seat come from the header unless `given` carries a per-fixture override.
 */
export function hostFill(def: FixtureDef, given: Params, host: HostSettings): Params {
  const has = (k: string) => def.params.some((p) => p.key === k && p.hidden);
  const out: Params = { ...given };
  if (has('printer')) out.printer = host.printerId;
  if (has('fit') && given.fit === undefined) out.fit = host.fit;
  if (has('seat') && given.seat === undefined) out.seat = host.seat;
  return out;
}

export const declaresFit = (def: FixtureDef) => def.params.some((p) => p.key === 'fit' && p.hidden);
