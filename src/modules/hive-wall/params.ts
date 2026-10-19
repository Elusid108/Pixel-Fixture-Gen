import { FIT_PARAMS } from '../../fit';
import type { ParamSpec } from '../../types';
import { DESIGN_PARAM, PRINTER_PARAM } from '../shared/params';

export const HW_PIXELS = ['node-12-bullet', 'node-12-bullet-12v'];

/** M1 Hive wall system params. The tile layers mirror the catalogue Hive tile's. */
export const HW_PARAMS: ParamSpec[] = [
  DESIGN_PARAM,
  PRINTER_PARAM,
  { key: 'pixel', label: 'Node', type: 'pixel', default: 'node-12-bullet', pixels: HW_PIXELS, group: 'Pixels', help: '12 mm bullet nodes push through the carrier, one per cell.' },
  {
    key: 'size',
    label: 'Tile size',
    type: 'select',
    default: 'M',
    options: [
      { value: 'S', label: 'S · 7 cells' },
      { value: 'M', label: 'M · 19 cells' },
      { value: 'L', label: 'L · 37 cells' },
    ],
    group: 'Tiles',
    help: 'If a tile is too big for the printer it steps down a size (L is about 200 mm across flats).',
  },
  { key: 'pitch', label: 'Cell pitch', type: 'number', default: 30, min: 22, max: 60, step: 1, unit: 'mm', group: 'Tiles', help: 'Centre to centre of the honeycomb cells.' },
  {
    key: 'minArea',
    label: 'Smallest edge tile',
    type: 'number',
    default: 15,
    min: 5,
    max: 60,
    step: 1,
    unit: '%',
    group: 'Tiles',
    help: 'Trimmed edge tiles with less of their area than this, or with no whole cell, are left out.',
  },
  { key: 'baffle', label: 'Baffle depth', type: 'number', default: 20, min: 10, max: 45, step: 1, unit: 'mm', group: 'Layers', help: 'Deeper means a softer, more even cell.' },
  { key: 'wiring', label: 'Wiring space', type: 'number', default: 24, min: 18, max: 40, step: 1, unit: 'mm', group: 'Layers', help: 'Room behind the carrier for node bodies and strand slack.' },
  { key: 'diffuser', label: 'Diffuser', type: 'number', default: 1.2, min: 0.6, max: 2.4, step: 0.2, unit: 'mm', group: 'Layers', help: 'Opal/white PETG, printed flat.' },
  { key: 'wall', label: 'Shell wall', type: 'number', default: 4.2, min: 3.6, max: 6, step: 0.2, unit: 'mm', group: 'Layers', help: 'Also the closing wall printed along trimmed edges.' },
  { key: 'magnets', label: 'Magnet pockets', type: 'boolean', default: true, group: 'Joinery', help: 'Two 6×3 mm pockets per edge. Trimmed edges drop them.' },
  { key: 'bowties', label: 'Bowtie keys', type: 'boolean', default: true, group: 'Joinery', help: 'One printed key per seam, in pockets on the back.' },
  { key: 'rail', label: 'Wall cleat rail', type: 'boolean', default: true, group: 'Mounting', help: 'Printed rails with hanger studs that drop into each tile’s keyholes. Off: two screws per tile.' },
  ...FIT_PARAMS,
];
