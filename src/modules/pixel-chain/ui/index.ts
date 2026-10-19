import type { SystemUI } from '../../../workbench/ui';
import { PcData } from './Data';
import { PcInspector } from './Inspector';
import { PcPalette } from './Palette';
import { PcScene, usePcPixelSize } from './Scene';

export const pixelChainUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Drag anchors on the grid · Shift-drag for height · click a chain to select it · Del removes' },
    { id: 'garland', label: 'Garland', key: 'g', hint: 'Click anchors on the plane · click the first again for a ring · Esc ends', plane: true },
  ],
  Scene: PcScene,
  Palette: PcPalette,
  Inspector: PcInspector,
  Data: PcData,
  usePixelSize: usePcPixelSize,
  overlays: { chain: true, labels: true },
};
