import { hive } from './hive';
import type { FixtureDef } from '../types';
import type { PlannedFixture } from './planned';

/** M-series units in the catalogue (single modules). Whole layouts live on the Workbench. Built fixtures in catalogue order; move a row from planned to built as it lands. */
export const M_FIXTURES: FixtureDef[] = [hive];

/** Whole M-series systems (M2 Linea, M3 Mini Rig, M5 Facet Wall, M6 Column Stack, M7 Pixel Chain) live on the Workbench. */
export const M_PLANNED: PlannedFixture[] = [];
