import { fresnel } from './fresnel';
import { contour } from './s/contour';
import { leko } from './s/leko';
import { litho } from './s/litho';
import { louver } from './s/louver';
import { moire } from './s/moire';
import { scrim } from './s/scrim';
import { swatchbook } from './swatchbook';
import type { FixtureDef } from '../types';
import type { PlannedFixture } from './planned';

/** S-series: single-bed fixtures. Built fixtures in catalogue order; move a row from planned to built as it lands. */
export const S_FIXTURES: FixtureDef[] = [swatchbook, fresnel, leko, scrim, litho, louver, moire, contour];

/** Every S concept is built. */
export const S_PLANNED: PlannedFixture[] = [];
