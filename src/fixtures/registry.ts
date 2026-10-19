import type { FixtureDef } from '../types';
import { coupon } from './coupon';
import { fresnel } from './fresnel';
import { hive } from './hive';
import { swatchbook } from './swatchbook';

export const FIXTURES: FixtureDef[] = [swatchbook, fresnel, hive, coupon];

export function getFixture(id: string): FixtureDef {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fixture "${id}"`);
  return f;
}

/** The rest of the catalogue from the brainstorm, shown as planned so the roadmap is visible. */
export interface PlannedFixture {
  code: string;
  name: string;
  family: FixtureDef['family'];
  tagline: string;
  schedule: string;
}

export const PLANNED: PlannedFixture[] = [
  { code: 'S3', name: 'Leko Jr.', family: 'single', tagline: '1:3 ERS. Sliding shutters, printable gobo plates.', schedule: '7-px jewel + 8-px ring · 15 px' },
  { code: 'S4', name: 'Scrim Box', family: 'single', tagline: 'Front-light it and the scrim goes opaque. Backlight it and the scene appears.', schedule: '20 px strip, 3 zones' },
  { code: 'S5', name: 'Litho Relight', family: 'single', tagline: 'A LithoLab lithophane over a baffled grid. Relight the photo.', schedule: '6×6 @ 33 mm · 36 px' },
  { code: 'S6', name: 'Louver Sconce', family: 'single', tagline: 'Pixel Louver Lights, grown up. Up and down wash.', schedule: '16 px, 60/m strip' },
  { code: 'S7', name: 'Moiré Lantern', family: 'single', tagline: 'Two slotted shells. The pattern moves as people pass.', schedule: '60 px, 1 m strip' },
  { code: 'S8', name: 'Contour', family: 'single', tagline: 'A heightmap as stacked topo bands. Rising water.', schedule: '~32 nodes' },
  { code: 'L1', name: 'The Orb', family: 'assembly', tagline: 'Geodesic sphere, one face per pixel, faces deduped into print counts.', schedule: '3V: 180 nodes · 2 univ.' },
  { code: 'L2', name: 'Cascade', family: 'assembly', tagline: 'Rain chandelier. Keyed crown ring, vase-mode drop tubes.', schedule: '240 px · 12 V' },
  { code: 'L3', name: 'Gasolier', family: 'assembly', tagline: 'Lathe-turned column, S-arms, RGBW candle flames, prism drops.', schedule: '47 px RGBW' },
  { code: 'L4', name: 'Armillary', family: 'assembly', tagline: 'Equator, meridian, and the ecliptic at 23.4°.', schedule: '301 px · 12 V' },
  { code: 'L5', name: 'Bloom', family: 'assembly', tagline: 'Below-sightline table centrepiece with a battery base.', schedule: '31 px · ~10 h @ 20%' },
  { code: 'L6', name: 'Helix', family: 'assembly', tagline: 'DNA pendant with pixel-bar base pairs.', schedule: '100 px' },
  { code: 'M2', name: 'Linea', family: 'modular', tagline: 'Bars, corners, tees. Cell dividers lock to strip pitch.', schedule: '12 px / 200 mm' },
  { code: 'M3', name: 'Mini Rig 1:6', family: 'modular', tagline: 'F34 truss and clip-on instruments. Build your rig on your desk.', schedule: 'per instrument' },
  { code: 'M4', name: 'Strut & Node', family: 'modular', tagline: 'Draw a wireframe; every hub is generated at its exact angles.', schedule: 'per strut' },
  { code: 'M5', name: 'Facet Wall', family: 'modular', tagline: 'Triangle facets at three depths, painted on the bench.', schedule: '1 node / facet' },
  { code: 'M6', name: 'Column Stack', family: 'modular', tagline: 'Base, segment library, caps. Stack it or hang it.', schedule: 'per segment' },
  { code: 'M7', name: 'Pixel Chain', family: 'modular', tagline: 'Hinged links in catenary garlands.', schedule: '1 node / link' },
];
