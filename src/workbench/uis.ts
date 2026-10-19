import { columnStackUI } from '../modules/column-stack/ui';
import { facetWallUI } from '../modules/facet-wall/ui';
import { hiveWallUI } from '../modules/hive-wall/ui';
import { lineaUI } from '../modules/linea/ui';
import { miniRigUI } from '../modules/mini-rig/ui';
import { pixelChainUI } from '../modules/pixel-chain/ui';
import { strutNodeUI } from '../modules/strut-node/ui';
import type { SystemUI } from './ui';

/** Workbench systems, React halves, keyed by SystemCore id. Every core in ./cores needs one. */
export const SYSTEM_UIS: Record<string, SystemUI> = {
  'strut-node': strutNodeUI,
  'hive-wall': hiveWallUI,
  linea: lineaUI,
  'mini-rig': miniRigUI,
  'facet-wall': facetWallUI,
  'column-stack': columnStackUI,
  'pixel-chain': pixelChainUI,
};

export function getUI(id: string): SystemUI {
  return SYSTEM_UIS[id] ?? SYSTEM_UIS['strut-node'];
}
