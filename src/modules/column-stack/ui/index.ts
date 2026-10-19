import type { SystemUI } from '../../../workbench/ui';
import { CsData } from './Data';
import { CsInspector } from './Inspector';
import { CsPalette } from './Palette';
import { CsScene, useCsPixelSize } from './Scene';

export const columnStackUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Click a segment or cap · drag a base or canopy to move its stack · Del removes' },
    { id: 'stack', label: 'Stack', key: 't', hint: 'Click the bench to stand a column (base, ring band, dome)' },
    { id: 'drop', label: 'Drop', key: 'h', hint: 'Click to hang a drop · canopy at Plane Z, raised if too low', plane: true },
  ],
  Scene: CsScene,
  Palette: CsPalette,
  Inspector: CsInspector,
  Data: CsData,
  usePixelSize: useCsPixelSize,
  overlays: { chain: true, labels: true },
};
