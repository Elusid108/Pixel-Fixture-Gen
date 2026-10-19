import type { SketchPath, SketchRegion } from '../sketch/types';
import type { Params, Vec3 } from '../types';

/**
 * A Workbench system, pure half. Everything the store, the build, the drawing engine and
 * `check:geom` need, with no React or three.js, so it loads in the worker, in tests and in
 * Node. The React half (scene, palette, inspector, tools) is `SystemUI` in ./ui.
 *
 * The design is the system's own JSON-able data. The worker builds it through the module
 * FixtureDef named by `moduleId`, which receives the design as its `design` json param.
 */

export type Selection = { kind: string; id: string } | null;

export interface BenchPreset<D> {
  id: string;
  /** Short badge, e.g. "ICO". */
  code: string;
  name: string;
  blurb: string;
  make(): D;
}

export interface SystemCore<D = unknown> {
  id: string;
  /** Catalogue code, e.g. "M4". */
  code: string;
  name: string;
  tagline: string;
  /** FixtureDef id (in `MODULES`) the worker builds. */
  moduleId: string;
  empty(): D;
  /** Defensive parse: malformed input yields a valid (possibly empty) design. */
  parse(json: string): D;
  /** First preset is what a fresh bench opens with. */
  presets: BenchPreset<D>[];
  /** Params for a worker build: resolved system params, the design JSON and the header's printer. */
  buildParams(design: D, params: Params, printerId: string): Params;
  /** Camera framing for a design, Z-up mm. */
  frame(design: D): { center: Vec3; radius: number };
  /** Delete-key behaviour for the current selection. */
  remove?(design: D, sel: NonNullable<Selection>): D;

  /*
   * Sketch adapters. Each merges drawn geometry into the existing design and returns the new
   * one; the drawing engine offers a system as a target only for the adapters it implements.
   */
  /** Open or closed polylines on a plane (bars along a line, chain garlands, truss runs). */
  fromPaths?(paths: SketchPath[], design: D, params: Params): D;
  /** Filled outlines with holes (tile walls, facet fields). */
  fromRegions?(regions: SketchRegion[], design: D, params: Params): D;
  /** Free 3D polylines (wireframes). */
  fromPaths3D?(paths: SketchPath[], design: D, params: Params): D;

  /** `check:geom`: skip variants that are slow or meaningless for a given preset. */
  skipVariant?(design: D, key: string, value: unknown): boolean;
}

export interface PlannedSystem {
  code: string;
  name: string;
  tagline: string;
}
