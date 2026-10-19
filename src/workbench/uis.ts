import { strutNodeUI } from '../modules/strut-node/ui';
import type { SystemUI } from './ui';

/** Workbench systems, React halves, keyed by SystemCore id. Every core in ./cores needs one. */
export const SYSTEM_UIS: Record<string, SystemUI> = {
  'strut-node': strutNodeUI,
};

export function getUI(id: string): SystemUI {
  return SYSTEM_UIS[id] ?? SYSTEM_UIS['strut-node'];
}
