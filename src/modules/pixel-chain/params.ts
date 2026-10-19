import { FIT_PARAMS } from '../../fit';
import type { ParamSpec } from '../../types';
import { DESIGN_PARAM, PRINTER_PARAM } from '../shared/params';

export const PC_PIXELS = ['node-12-bullet', 'node-12-bullet-12v'];

export type LinkShape = 'globe' | 'faceted' | 'bell';
export type HingeKind = 'filament' | 'printed';

/** M7 Pixel Chain system params. The design (garlands) travels as JSON in `design`. */
export const PC_PARAMS: ParamSpec[] = [
  DESIGN_PARAM,
  PRINTER_PARAM,
  { key: 'pixel', label: 'Node', type: 'pixel', default: 'node-12-bullet', pixels: PC_PIXELS, group: 'Pixels' },
  {
    key: 'slack',
    label: 'Lead slack',
    type: 'number',
    default: 12,
    min: 0,
    max: 30,
    step: 1,
    unit: 'mm',
    group: 'Pixels',
    help: 'Lead kept back for routing over each hinge. The longest link pitch is the strand lead length minus this.',
  },
  {
    key: 'pitch',
    label: 'Link pitch',
    type: 'number',
    default: 70,
    min: 40,
    max: 100,
    step: 1,
    unit: 'mm',
    group: 'Links',
    help: 'Pin to pin, which is also node to node. A garland can set its own. Capped at lead length minus slack, raised if the beads would touch.',
  },
  {
    key: 'shape',
    label: 'Diffuser',
    type: 'select',
    default: 'globe',
    options: [
      { value: 'globe', label: 'Globe' },
      { value: 'faceted', label: 'Faceted bead (8 sides)' },
      { value: 'bell', label: 'Bell' },
    ],
    group: 'Links',
    help: 'Every shape keeps its walls within 45° of vertical, so links print upright without supports.',
  },
  { key: 'beadD', label: 'Bead Ø', type: 'number', default: 36, min: 28, max: 56, step: 1, unit: 'mm', group: 'Links', help: 'Widest outside diameter of the diffuser.' },
  { key: 'wall', label: 'Diffuser wall', type: 'number', default: 1.6, min: 0.8, max: 2.4, step: 0.1, unit: 'mm', group: 'Links', help: 'Two to three perimeters of translucent PETG.' },
  {
    key: 'hinge',
    label: 'Hinge pin',
    type: 'select',
    default: 'filament',
    options: [
      { value: 'filament', label: '1.75 mm filament pin' },
      { value: 'printed', label: 'Printed D-pin (no hardware)' },
    ],
    group: 'Hinge',
    help: 'Filament: cut a length of 1.75 mm filament and mushroom both ends with a hot nozzle. Printed: Ø2.9 D-section pins that press into the clevis.',
  },
  ...FIT_PARAMS,
];
