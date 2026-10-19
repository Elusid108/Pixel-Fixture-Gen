import type { SystemUI } from '../../../workbench/ui';
import { RigData } from './Data';
import { RigInspector } from './Inspector';
import { RigPalette } from './Palette';
import { RigScene, useRigPixelSize } from './Scene';

export const miniRigUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Drag blocks on the grid · inspector sets height · Del removes' },
    { id: 'truss', label: 'Truss', key: 't', hint: 'Click the plane or blocks to run truss · Esc ends the run', plane: true },
    { id: 'instrument', label: 'Instrument', key: 'i', hint: 'Click a span near a chord to clip on the palette instrument' },
  ],
  Scene: RigScene,
  Palette: RigPalette,
  Inspector: RigInspector,
  Data: RigData,
  usePixelSize: useRigPixelSize,
  overlays: { chain: true, labels: true },
};
