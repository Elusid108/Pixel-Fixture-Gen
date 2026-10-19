import type { Manifold } from 'manifold-3d';
import type { Geo } from '../geom/geo';
import type { PixelType } from './library';

export interface SocketOpts {
  /** Radial clearance added to the pixel outline, mm. */
  tol: number;
  /** How far the cutter extends above the emitter face (to clear diffuser stand-off etc). */
  over?: number;
  /** Wire exit depth behind the pocket. 0 disables it. */
  wire?: number;
  /** Strip pockets only: run length along X, centred. */
  length?: number;
}

/**
 * The cutter that seats a pixel. Convention: emitting face at z=0 facing +Z, body toward -Z.
 * Fixtures position this with a transform and subtract it, so every fixture shares one
 * definition of "how a 24-ring sits in plastic", and the fit-test coupon proves it.
 */
export function socketCutter(g: Geo, p: PixelType, o: SocketOpts): Manifold {
  const over = o.over ?? 0.5;
  const wire = o.wire ?? 6;
  const s = p.shape;
  switch (s.kind) {
    case 'round': {
      const pocket = g.cylZ(s.d / 2 + o.tol, -s.depth, over);
      if (p.form === 'node' || !wire) return pocket;
      return g.union([pocket, g.cylZ(Math.min(2.4, s.d / 4), -s.depth - wire, -s.depth + 0.1)]);
    }
    case 'ring': {
      const ring = g.cylZ(s.od / 2 + o.tol, -s.depth, over).subtract(g.cylZ(s.id / 2 - o.tol, -s.depth - 1, over + 1));
      if (!wire) return ring;
      const rMid = (s.od + s.id) / 4;
      return g.union([ring, g.cylZ(2.4, -s.depth - wire, -s.depth + 0.1, 0, -rMid)]);
    }
    case 'strip': {
      const len = o.length ?? s.pitch;
      return g.box([-len / 2, -s.width / 2 - o.tol, -s.depth], [len / 2, s.width / 2 + o.tol, over]);
    }
    case 'box': {
      const pocket = g.box([-s.l / 2 - o.tol, -s.w / 2 - o.tol, -s.depth], [s.l / 2 + o.tol, s.w / 2 + o.tol, over]);
      if (!wire) return pocket;
      return g.union([pocket, g.box([-s.l / 2 - wire, -2.5, -s.depth], [s.l / 2 + wire, 2.5, -s.depth + 2])]);
    }
  }
}

/** Plate thickness a socket needs behind/around the pixel to hold it. */
export function socketDepth(p: PixelType): number {
  return p.shape.depth;
}
