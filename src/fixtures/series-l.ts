import type { FixtureDef } from '../types';
import type { PlannedFixture } from './planned';

/** L-series: large multi-part assemblies (centrepieces and chandeliers). Built fixtures in catalogue order; move a row from planned to built as it lands. */
export const L_FIXTURES: FixtureDef[] = [];

export const L_PLANNED: PlannedFixture[] = [
  { code: 'L1', name: 'The Orb', family: 'assembly', tagline: 'Geodesic sphere, one face per pixel, faces deduped into print counts.', schedule: '3V: 180 nodes · 2 univ.' },
  { code: 'L2', name: 'Cascade', family: 'assembly', tagline: 'Rain chandelier. Keyed crown ring, vase-mode drop tubes.', schedule: '240 px · 12 V' },
  { code: 'L3', name: 'Gasolier', family: 'assembly', tagline: 'Lathe-turned column, S-arms, RGBW candle flames, prism drops.', schedule: '47 px RGBW' },
  { code: 'L4', name: 'Armillary', family: 'assembly', tagline: 'Equator, meridian, and the ecliptic at 23.4°.', schedule: '301 px · 12 V' },
  { code: 'L5', name: 'Bloom', family: 'assembly', tagline: 'Below-sightline table centrepiece with a battery base.', schedule: '31 px · ~10 h @ 20%' },
  { code: 'L6', name: 'Helix', family: 'assembly', tagline: 'DNA pendant with pixel-bar base pairs.', schedule: '100 px' },
];
