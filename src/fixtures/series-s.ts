import { fresnel } from './fresnel';
import { swatchbook } from './swatchbook';
import type { FixtureDef } from '../types';
import type { PlannedFixture } from './planned';

/** S-series: single-bed fixtures. Built fixtures in catalogue order; move a row from planned to built as it lands. */
export const S_FIXTURES: FixtureDef[] = [swatchbook, fresnel];

export const S_PLANNED: PlannedFixture[] = [
  { code: 'S3', name: 'Leko Jr.', family: 'single', tagline: '1:3 ERS. Sliding shutters, printable gobo plates.', schedule: '7-px jewel + 8-px ring · 15 px' },
  { code: 'S4', name: 'Scrim Box', family: 'single', tagline: 'Front-light it and the scrim goes opaque. Backlight it and the scene appears.', schedule: '20 px strip, 3 zones' },
  { code: 'S5', name: 'Litho Relight', family: 'single', tagline: 'A LithoLab lithophane over a baffled grid. Relight the photo.', schedule: '6×6 @ 33 mm · 36 px' },
  { code: 'S6', name: 'Louver Sconce', family: 'single', tagline: 'Pixel Louver Lights, grown up. Up and down wash.', schedule: '16 px, 60/m strip' },
  { code: 'S7', name: 'Moiré Lantern', family: 'single', tagline: 'Two slotted shells. The pattern moves as people pass.', schedule: '60 px, 1 m strip' },
  { code: 'S8', name: 'Contour', family: 'single', tagline: 'A heightmap as stacked topo bands. Rising water.', schedule: '~32 nodes' },
];
