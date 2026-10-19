import { columnStackCore } from '../modules/column-stack/system';
import { facetWallCore } from '../modules/facet-wall/system';
import { hiveWallCore } from '../modules/hive-wall/system';
import { lineaCore } from '../modules/linea/system';
import { miniRigCore } from '../modules/mini-rig/system';
import { pixelChainCore } from '../modules/pixel-chain/system';
import { strutNodeCore } from '../modules/strut-node/system';
import type { PlannedSystem, SystemCore } from './system';

/**
 * Workbench systems (pure halves). M4, the flagship, comes first so a fresh bench opens on it;
 * the rest follow in catalogue order. Add new systems here and their UI in ./uis.tsx; the
 * store, auto-build, drawing engine and check:geom pick them up.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SYSTEM_CORES: SystemCore<any>[] = [strutNodeCore, hiveWallCore, lineaCore, miniRigCore, facetWallCore, columnStackCore, pixelChainCore];

/** Systems on the drawing board (none right now: M1–M7 are all built). */
export const PLANNED_SYSTEMS: PlannedSystem[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCore(id: string): SystemCore<any> {
  return SYSTEM_CORES.find((s) => s.id === id) ?? SYSTEM_CORES[0];
}
