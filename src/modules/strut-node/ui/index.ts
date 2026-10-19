import type { SystemUI } from '../../../workbench/ui';
import { SnData } from './Data';
import { SnInspector } from './Inspector';
import { SnPalette } from './Palette';
import { SnScene, useSnPixelSize } from './Scene';

export const strutNodeUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Drag hubs on the grid · Shift-drag for height · Del removes' },
    { id: 'add', label: 'Hub', key: 'n', hint: 'Click the plane to place a hub · it links to the selected hub', plane: true },
    { id: 'connect', label: 'Strut', key: 'c', hint: 'Click hub, then hub · Esc ends the chain' },
    { id: 'order', label: 'Order', key: 'o', hint: 'Click struts in data order · click the last again to undo · Shift-click flips' },
  ],
  Scene: SnScene,
  Palette: SnPalette,
  Inspector: SnInspector,
  Data: SnData,
  usePixelSize: useSnPixelSize,
  overlays: { chain: true, labels: true },
};
