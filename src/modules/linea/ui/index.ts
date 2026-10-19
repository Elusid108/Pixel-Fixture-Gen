import type { SystemUI } from '../../../workbench/ui';
import { LineaData } from './Data';
import { LineaInspector } from './Inspector';
import { LineaPalette } from './Palette';
import { LineaScene, useLineaPixelSize } from './Scene';

export const lineaUI: SystemUI = {
  tools: [
    { id: 'select', label: 'Select', key: 'v', hint: 'Click a bar or joint · drag a vertex (re-locks to the pitch) · Del removes' },
    { id: 'run', label: 'Bar run', key: 'b', hint: 'Click points · click the last again or Enter ends · first point closes · Esc cancels', plane: true },
  ],
  Scene: LineaScene,
  Palette: LineaPalette,
  Inspector: LineaInspector,
  Data: LineaData,
  usePixelSize: useLineaPixelSize,
  overlays: { chain: true, labels: true },
};
