import { MODULES } from '../modules';
import type { FixtureDef } from '../types';
import { coupon } from './coupon';
import type { PlannedFixture } from './planned';
import { L_FIXTURES, L_PLANNED } from './series-l';
import { M_FIXTURES, M_PLANNED } from './series-m';
import { S_FIXTURES, S_PLANNED } from './series-s';

/**
 * The catalogue, concatenated from the per-series files so each series can grow on its own
 * branch without touching this file.
 */
export const FIXTURES: FixtureDef[] = [...S_FIXTURES, ...L_FIXTURES, ...M_FIXTURES, coupon];

export { MODULES };
export type { PlannedFixture };

export function getFixture(id: string): FixtureDef {
  const f = FIXTURES.find((x) => x.id === id) ?? MODULES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture "${id}"`);
  return f;
}

export const PLANNED: PlannedFixture[] = [...S_PLANNED, ...L_PLANNED, ...M_PLANNED];
