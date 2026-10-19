import type { Vec3 } from '../types';

/**
 * The drawing engine's output, and the contract every Workbench system's sketch adapters
 * consume. Text and SVG import are converted into these at creation time, so systems only
 * ever see paths and regions.
 */

export type Vec2 = [number, number];

/** A drawing plane: points are origin + x·u + y·v (Z-up mm, u ⊥ v, both unit). */
export interface SketchPlane {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

export type SketchSource = 'draw' | 'text' | 'svg' | '3d';

/**
 * An open or closed polyline in 3D. 2D-drawn paths keep their plane, and 3D sketches
 * (chained across planes) leave it unset. Arcs and curves arrive pre-sampled.
 */
export interface SketchPath {
  id: string;
  pts: Vec3[];
  closed: boolean;
  plane?: SketchPlane;
  source?: SketchSource;
}

/** A filled area on a plane: one outer loop (CCW) and any number of holes (CW), in plane coords. */
export interface SketchRegion {
  id: string;
  outer: Vec2[];
  holes: Vec2[][];
  plane: SketchPlane;
  source?: SketchSource;
}

export interface Sketch {
  paths: SketchPath[];
  regions: SketchRegion[];
}

export const emptySketch = (): Sketch => ({ paths: [], regions: [] });

/** The bench floor at height z, with plane x/y matching world X/Y. */
export const planeXY = (z = 0): SketchPlane => ({ origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0] });
/** A vertical plane facing -Y (front), at depth y; plane x → world X, plane y → world Z. */
export const planeXZ = (y = 0): SketchPlane => ({ origin: [0, y, 0], u: [1, 0, 0], v: [0, 0, 1] });
/** A vertical plane facing +X (side), at x; plane x → world Y, plane y → world Z. */
export const planeYZ = (x = 0): SketchPlane => ({ origin: [x, 0, 0], u: [0, 1, 0], v: [0, 0, 1] });
