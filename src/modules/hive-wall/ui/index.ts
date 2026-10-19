import type { SystemUI } from '../../../workbench/ui';
import { HwData } from './Data';
import { HwInspector } from './Inspector';
import { HwPalette } from './Palette';
import { HwScene, useHwPixelSize } from './Scene';

export const hiveWallUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Click a tile or the outline · drag outline points to reshape · Del switches a tile off' },
    { id: 'tile', label: 'Tile', key: 't', hint: 'Click a slot to switch its tile off · click an empty slot for a whole tile' },
  ],
  Scene: HwScene,
  Palette: HwPalette,
  Inspector: HwInspector,
  Data: HwData,
  usePixelSize: useHwPixelSize,
  overlays: { chain: true, labels: true },
};
