import type { FixtureDef } from '../types';
import type { PlannedFixture } from './planned';
import { armillary } from './l/armillary';
import { bloom } from './l/bloom';
import { cascade } from './l/cascade';
import { dome } from './l/dome';
import { drum } from './l/drum';
import { gasolier } from './l/gasolier';
import { helix } from './l/helix';
import { orb } from './l/orb';
import { polyhedra } from './l/polyhedra';

/** L-series: large multi-part assemblies (centrepieces and chandeliers). Built fixtures in catalogue order; move a row from planned to built as it lands. */
export const L_FIXTURES: FixtureDef[] = [orb, cascade, gasolier, armillary, bloom, helix, dome, drum, polyhedra];

export const L_PLANNED: PlannedFixture[] = [];
