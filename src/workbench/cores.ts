import { strutNodeCore } from '../modules/strut-node/system';
import type { PlannedSystem, SystemCore } from './system';

/**
 * Workbench systems (pure halves), in catalogue order. Add new systems here and their UI
 * in ./uis.tsx; the store, auto-build, drawing engine and check:geom pick them up.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SYSTEM_CORES: SystemCore<any>[] = [strutNodeCore];

export const PLANNED_SYSTEMS: PlannedSystem[] = [
  { code: 'M1', name: 'Hive wall', tagline: 'Draw an outline; Hive tiles fill it, edge tiles clipped to fit.' },
  { code: 'M2', name: 'Linea', tagline: 'Draw a line; bars and exact-angle corners follow it.' },
  { code: 'M3', name: 'Mini Rig 1:6', tagline: 'Draw truss runs; clip mini instruments on.' },
  { code: 'M5', name: 'Facet Wall', tagline: 'Draw an outline; triangle facets at three depths fill it.' },
  { code: 'M6', name: 'Column Stack', tagline: 'Stack base, segments and caps.' },
  { code: 'M7', name: 'Pixel Chain', tagline: 'Draw a line; hinged links drape along it.' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCore(id: string): SystemCore<any> {
  return SYSTEM_CORES.find((s) => s.id === id) ?? SYSTEM_CORES[0];
}
