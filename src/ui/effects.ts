import { Color } from 'three';
import type { PixelPlacement } from '../types';
import type { Effect } from './store';

/**
 * Preview looks over the real pixel positions, in data order. These stand in for the
 * WLED/Madrix content you'd run on the finished fixture; they are not sent anywhere.
 */
export function makeEffect(pixels: PixelPlacement[], effect: Effect) {
  const n = pixels.length;
  const c = [0, 0, 0];
  for (const p of pixels) for (let k = 0; k < 3; k++) c[k] += p.pos[k] / Math.max(1, n);
  const radius = pixels.map((p) => Math.hypot(p.pos[0] - c[0], p.pos[1] - c[1], p.pos[2] - c[2]));
  const maxR = Math.max(1, ...radius);
  const tmp = new Color();
  const warm = new Color().setRGB(1, 0.62, 0.28);

  return (i: number, t: number, out: Color): Color => {
    switch (effect) {
      case 'off':
        return out.setRGB(0.02, 0.02, 0.025);
      case 'warm': {
        const flicker = 0.85 + 0.15 * Math.sin(t * 7.3 + i * 1.7) * Math.sin(t * 3.1 + i * 0.6);
        return out.copy(warm).multiplyScalar(flicker);
      }
      case 'rainbow':
        return out.setHSL((i / Math.max(1, n) + t * 0.08) % 1, 0.95, 0.55);
      case 'ripple': {
        const phase = radius[i] / maxR - t * 0.45;
        const wave = 0.5 + 0.5 * Math.cos(phase * Math.PI * 4);
        return out.setHSL((0.55 + 0.12 * Math.sin(t * 0.3) + radius[i] / maxR / 6) % 1, 0.9, 0.12 + 0.48 * wave);
      }
      case 'chase':
      default: {
        const head = (t * Math.max(6, n * 0.35)) % n;
        let d = head - i;
        if (d < 0) d += n;
        const tail = Math.exp(-d / Math.max(2, n * 0.12));
        tmp.setHSL((0.08 + (t * 0.02) % 1) % 1, 0.95, 0.5);
        return out.copy(tmp).multiplyScalar(0.06 + 0.94 * tail);
      }
    }
  };
}
