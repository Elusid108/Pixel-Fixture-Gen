import { dist } from '../../geom/vec';
import type { SketchPath } from '../../sketch/types';
import type { Params, Vec3 } from '../../types';
import type { Selection, SystemCore } from '../../workbench/system';
import { buildParamsWith } from '../shared/params';
import { nextId } from '../shared/layout';
import { addPaths } from './lock';
import { emptyDesign, parseDesign, type LineaDesign, type LineaRun } from './model';
import { LINEA_PARAMS } from './params';
import { PRESETS } from './presets';
import { topology } from './topology';

/** Sketch → bars: each planar polyline becomes a pitch-locked run in its plane. */
export function lineaFromPaths(paths: SketchPath[], design: LineaDesign, params: Params): LineaDesign {
  return addPaths(design, paths, params);
}

/** Split run `id` by removing segment `seg`: open runs become two runs, closed runs open up. */
export function cutSegment(d: LineaDesign, id: string, seg: number): LineaDesign {
  const run = d.runs.find((r) => r.id === id);
  if (!run) return d;
  const n = run.pts.length;
  let pieces: Vec3[][];
  if (run.closed) pieces = [[...run.pts.slice(seg + 1), ...run.pts.slice(0, seg + 1)]];
  else pieces = [run.pts.slice(0, seg + 1), run.pts.slice(seg + 1, n)];
  const keep = pieces.filter((p) => p.length >= 2);
  const out: LineaRun[] = [];
  const taken = d.runs.map((r) => r.id);
  keep.forEach((pts, k) => {
    const rid = k === 0 ? run.id : nextId('R', [...taken, ...out.map((r) => r.id)]);
    out.push({ ...run, id: rid, pts, closed: false });
  });
  const runs = d.runs.flatMap((r) => (r.id === id ? out : [r]));
  return { ...d, runs, feed: runs.some((r) => r.id === d.feed) ? d.feed : '' };
}

/** Remove every run vertex sitting on a joint; runs left with one point go. */
export function removeJoint(d: LineaDesign, nodeId: string): LineaDesign {
  const node = topology(d).nodes.find((n) => n.id === nodeId);
  if (!node || !node.verts.length) return d;
  const runs = d.runs
    .map((r) => {
      const drop = new Set(node.verts.filter((v) => v.run === r.id).map((v) => v.i));
      if (!drop.size) return r;
      const pts = r.pts.filter((_, i) => !drop.has(i));
      return { ...r, pts, closed: r.closed && pts.length >= 3 };
    })
    .filter((r) => r.pts.length >= 2);
  return { ...d, runs, feed: runs.some((r) => r.id === d.feed) ? d.feed : '' };
}

function remove(d: LineaDesign, sel: NonNullable<Selection>): LineaDesign {
  if (sel.kind === 'run') {
    const runs = d.runs.filter((r) => r.id !== sel.id);
    return { ...d, runs, feed: d.feed === sel.id ? '' : d.feed };
  }
  if (sel.kind === 'bar') {
    const e = topology(d).edges.find((x) => x.id === sel.id);
    return e ? cutSegment(d, e.run, e.seg) : d;
  }
  if (sel.kind === 'joint') return removeJoint(d, sel.id);
  return d;
}

function frame(d: LineaDesign): { center: Vec3; radius: number } {
  const pts = d.runs.flatMap((r) => r.pts);
  if (!pts.length) return { center: [0, 0, 120], radius: 400 };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { center, radius: Math.max(150, dist(min, max) / 2) * 1.5 };
}

/** M2 Linea, pure half. */
export const lineaCore: SystemCore<LineaDesign> = {
  id: 'linea',
  code: 'M2',
  name: 'Linea',
  tagline: 'Pixel bars drawn as lines: pitch-locked straights, exact-angle corners, T and X joints.',
  moduleId: 'linea',
  empty: emptyDesign,
  parse: parseDesign,
  presets: PRESETS,
  buildParams: (design, params, printerId) => buildParamsWith(LINEA_PARAMS, design, params, printerId),
  frame,
  remove,
  fromPaths: lineaFromPaths,
};
