import type { Params } from '../types';
import type { SystemCore } from '../workbench/system';
import { idMaker, isPlanar, regionToPaths } from './ops';
import type { Sketch, SketchPath, SketchRegion } from './types';

/**
 * Routing drawn entities into a system's adapters:
 * - Regions go to `fromRegions`. Systems without it get the outlines as closed paths.
 * - Planar paths go to `fromPaths`, falling back to `fromPaths3D`.
 * - Non-planar (3D) paths go only to `fromPaths3D`.
 */

export interface GeneratePlan {
  regions: SketchRegion[];
  /** Paths for `fromPaths`, including region outlines when the system has no `fromRegions`. */
  paths: SketchPath[];
  paths3d: SketchPath[];
  /** Entities the system can't take. */
  skipped: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function planGenerate(sketch: Sketch, selected: string[], core: SystemCore<any>): GeneratePlan {
  const pick = selected.length ? new Set(selected) : null;
  const regions = sketch.regions.filter((r) => !pick || pick.has(r.id));
  const paths = sketch.paths.filter((p) => !pick || pick.has(p.id));
  const nextId = idMaker('O', []);
  const plan: GeneratePlan = { regions: [], paths: [], paths3d: [], skipped: 0 };

  for (const r of regions) {
    if (core.fromRegions) plan.regions.push(r);
    else if (core.fromPaths) plan.paths.push(...regionToPaths(r, nextId));
    else if (core.fromPaths3D) plan.paths3d.push(...regionToPaths(r, nextId));
    else plan.skipped++;
  }
  for (const p of paths) {
    const flat = isPlanar(p);
    if (flat && core.fromPaths) plan.paths.push(p);
    else if (core.fromPaths3D) plan.paths3d.push(p);
    else plan.skipped++;
  }
  return plan;
}

export const planSize = (p: GeneratePlan) => p.regions.length + p.paths.length + p.paths3d.length;

/** Systems that can take at least something from the drawing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const canGenerate = (core: SystemCore<any>) => Boolean(core.fromPaths || core.fromRegions || core.fromPaths3D);

/** Run the adapters in order (regions, paths, 3D paths), each merging into the last result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyGenerate<D>(core: SystemCore<D>, design: D, params: Params, plan: GeneratePlan): D {
  let d = design;
  if (plan.regions.length && core.fromRegions) d = core.fromRegions(plan.regions, d, params);
  if (plan.paths.length && core.fromPaths) d = core.fromPaths(plan.paths, d, params);
  if (plan.paths3d.length && core.fromPaths3D) d = core.fromPaths3D(plan.paths3d, d, params);
  return d;
}
