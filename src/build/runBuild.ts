import type { ManifoldToplevel } from 'manifold-3d';
import { boundsOf, inArena, makeCtx, toMeshData } from '../geom/manifold';
import { getFixture } from '../fixtures/registry';
import { resolveParams } from '../fixtures/util';
import { computeSchedule, type ScheduleReport } from '../schedule/schedule';
import type { AssemblyStep, BuiltPart, Params, PixelPlacement, Port } from '../types';

export interface BuildResult {
  fixtureId: string;
  params: Params;
  parts: BuiltPart[];
  pixels: PixelPlacement[];
  ports: Port[];
  report: ScheduleReport;
  warnings: string[];
  assembly: AssemblyStep[];
  /** Geometry problems: non-manifold or empty parts. Empty when the build is printable. */
  errors: string[];
  ms: number;
}

/** Shared by the web worker, the self-check script and the tests. */
export function runBuild(wasm: ManifoldToplevel, fixtureId: string, given: Params = {}): BuildResult {
  const def = getFixture(fixtureId);
  const params = resolveParams(def, given);
  const t0 = performance.now();
  return inArena(wasm, () => {
    const out = def.build(makeCtx(wasm), params);
    const errors: string[] = [];
    const parts: BuiltPart[] = out.parts.map((p) => {
      const status = p.solid.status();
      const volume = p.solid.volume();
      if (status !== 'NoError') errors.push(`${p.name}: ${status}`);
      if (!(volume > 0.01)) errors.push(`${p.name}: empty solid`);
      const mesh = toMeshData(p.solid);
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        mesh,
        instances: p.instances,
        explode: p.explode ?? [0, 0, 0],
        bounds: boundsOf(p.solid),
        volumeCm3: volume / 1000,
        triangles: mesh.indices.length / 3,
        note: p.note,
      };
    });
    return {
      fixtureId,
      params,
      parts,
      pixels: out.pixels,
      ports: out.ports ?? [],
      report: computeSchedule(out.schedule, out.pixels, out.hardware, { enclosureCm3: out.enclosureCm3 }),
      warnings: out.warnings,
      assembly: out.assembly ?? [],
      errors,
      ms: performance.now() - t0,
    };
  });
}
