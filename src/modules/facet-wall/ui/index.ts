import type { SystemUI } from '../../../workbench/ui';
import { FwData } from './Data';
import { FwInspector } from './Inspector';
import { FwPalette } from './Palette';
import { FwScene, useFwPixelSize } from './Scene';

export const facetWallUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Click a facet · drag corners to reshape · drag the arrow tip to turn the gradient · Del knocks out' },
    { id: 'depth', label: 'Depth', key: 'd', hint: 'Click a facet to step its depth · Shift-click follows the driver again' },
    { id: 'knock', label: 'Knock out', key: 'k', hint: 'Click a facet to leave a gap · click again to put it back' },
  ],
  Scene: FwScene,
  Palette: FwPalette,
  Inspector: FwInspector,
  Data: FwData,
  usePixelSize: useFwPixelSize,
  overlays: { chain: true, labels: true },
};
