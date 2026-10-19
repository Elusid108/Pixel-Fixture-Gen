import { hive } from './hive';
import type { FixtureDef } from '../types';
import type { PlannedFixture } from './planned';

/** M-series units in the catalogue (single modules). Whole layouts live on the Workbench. Built fixtures in catalogue order; move a row from planned to built as it lands. */
export const M_FIXTURES: FixtureDef[] = [hive];

export const M_PLANNED: PlannedFixture[] = [
  { code: 'M2', name: 'Linea', family: 'modular', tagline: 'Bars, corners, tees. Cell dividers lock to strip pitch.', schedule: '12 px / 200 mm' },
  { code: 'M3', name: 'Mini Rig 1:6', family: 'modular', tagline: 'F34 truss and clip-on instruments. Build your rig on your desk.', schedule: 'per instrument' },
  { code: 'M5', name: 'Facet Wall', family: 'modular', tagline: 'Triangle facets at three depths, painted on the bench.', schedule: '1 node / facet' },
  { code: 'M6', name: 'Column Stack', family: 'modular', tagline: 'Base, segment library, caps. Stack it or hang it.', schedule: 'per segment' },
  { code: 'M7', name: 'Pixel Chain', family: 'modular', tagline: 'Hinged links in catenary garlands.', schedule: '1 node / link' },
];
