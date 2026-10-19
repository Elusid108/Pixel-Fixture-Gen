import { add, dist, dot, scale, sub } from '../../geom/vec';
import type { SketchPath } from '../../sketch/types';
import type { Params, Vec3 } from '../../types';
import type { SystemCore } from '../../workbench/system';
import { buildParamsWith } from '../shared/params';
import { r1 } from '../shared/layout';
import { emptyDesign, nextId, parseDesign, type RigDesign } from './model';
import { RIG_PARAMS, TRUSS_W } from './params';
import { SNAP_DEG } from './plan';
import { PRESETS } from './presets';

/** Drawn vertices within this of an existing node reuse it, mm. */
export const MERGE_TOL = 20;

const yawAxes = (yaw: number): Vec3[] => [
  [Math.cos(yaw), Math.sin(yaw), 0],
  [-Math.sin(yaw), Math.cos(yaw), 0],
  [0, 0, 1],
];

/**
 * Box axes for a drawn path: world Z, and world X/Y. A path whose first horizontal segment is
 * clearly turned (more than SNAP_DEG off X or Y) keeps that turn, so a rig drawn at an angle
 * stays square to itself; anything within SNAP_DEG of the grid squares to the grid.
 */
export function pathAxes(pts: Vec3[]): Vec3[] {
  const first = pts.findIndex((p, i) => i > 0 && Math.abs(p[2] - pts[i - 1][2]) < 0.7 * dist(p, pts[i - 1]));
  const raw = first > 0 ? Math.atan2(pts[first][1] - pts[first - 1][1], pts[first][0] - pts[first - 1][0]) : 0;
  const q = Math.PI / 2;
  const yaw = ((((raw + q / 2) % q) + q) % q) - q / 2;
  return yawAxes(Math.abs(yaw) <= (SNAP_DEG * Math.PI) / 180 ? 0 : yaw);
}

/** Move `p` onto the nearest axis through `prev` when the segment is within SNAP_DEG of it. */
export function snapSegment(prev: Vec3, p: Vec3, axes: Vec3[]): Vec3 {
  const v = sub(p, prev);
  const L = Math.hypot(...v);
  if (L < 1e-6) return p;
  const best = axes.reduce((m, a) => (Math.abs(dot(v, a)) > Math.abs(dot(v, m)) ? a : m), axes[0]);
  const along = dot(v, best);
  const off = (Math.acos(Math.min(1, Math.abs(along) / L)) * 180) / Math.PI;
  return off <= SNAP_DEG ? add(prev, scale(best, along)) : p;
}

/**
 * Sketch → truss runs. Every drawn segment becomes a span; every vertex a node, merged with
 * any node within MERGE_TOL. Segments are squared to the block axes first, and anything
 * drawn on the desk is lifted so its blocks sit on the desk. The block type at each node
 * follows from its spans in `planRig`.
 */
export function addRuns(design: RigDesign, polylines: { pts: Vec3[]; closed: boolean }[]): RigDesign {
  const nodes = [...design.nodes];
  const spans = [...design.spans];
  const lift = (p: Vec3): Vec3 => [p[0], p[1], Math.max(p[2], TRUSS_W / 2)];
  const nodeAt = (p: Vec3): { id: string; pos: Vec3 } => {
    const hit = nodes.find((n) => dist(n.pos, p) <= MERGE_TOL);
    if (hit) return hit;
    const n = { id: nextId('N', nodes.map((x) => x.id)), pos: p.map(r1) as Vec3, base: false, pick: false };
    nodes.push(n);
    return n;
  };
  for (const pl of polylines) {
    const raw = pl.pts.map(lift).filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > 1);
    if (raw.length < 2) continue;
    // Square each segment from where its start actually landed (a merged node, maybe).
    const axes = pathAxes(raw);
    const ids: string[] = [];
    let prev = nodeAt(raw[0]);
    ids.push(prev.id);
    for (let i = 1; i < raw.length; i++) {
      prev = nodeAt(snapSegment(prev.pos, raw[i], axes));
      ids.push(prev.id);
    }
    const n = pl.closed ? ids.length : ids.length - 1;
    for (let i = 0; i < n; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      if (a === b || spans.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) continue;
      spans.push({ id: nextId('S', spans.map((s) => s.id)), a, b });
    }
  }
  return { ...design, nodes, spans, controller: design.controller || nodes[0]?.id || '' };
}

const fromPaths = (paths: SketchPath[], design: RigDesign, _params?: Params) => addRuns(design, paths);

function bounds(d: RigDesign): { min: Vec3; max: Vec3 } | null {
  if (!d.nodes.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const n of d.nodes)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], n.pos[k]);
      max[k] = Math.max(max[k], n.pos[k]);
    }
  return { min, max };
}

/** Remove a node, span or instrument, with everything that hangs off it. */
export function removeFrom(d: RigDesign, sel: { kind: string; id: string }): RigDesign {
  if (sel.kind === 'node') {
    const gone = new Set(d.spans.filter((s) => s.a === sel.id || s.b === sel.id).map((s) => s.id));
    const nodes = d.nodes.filter((n) => n.id !== sel.id);
    return {
      ...d,
      nodes,
      spans: d.spans.filter((s) => !gone.has(s.id)),
      instruments: d.instruments.filter((i) => !gone.has(i.span)),
      controller: d.controller === sel.id ? (nodes[0]?.id ?? '') : d.controller,
    };
  }
  if (sel.kind === 'span') return { ...d, spans: d.spans.filter((s) => s.id !== sel.id), instruments: d.instruments.filter((i) => i.span !== sel.id) };
  if (sel.kind === 'instrument') return { ...d, instruments: d.instruments.filter((i) => i.id !== sel.id) };
  return d;
}

/** M3 Mini Rig, pure half. */
export const miniRigCore: SystemCore<RigDesign> = {
  id: 'mini-rig',
  code: 'M3',
  name: 'Mini Rig',
  tagline: '1:6 F34 box truss with clip-on instruments. Build your rig on your desk.',
  moduleId: 'mini-rig',
  empty: emptyDesign,
  parse: parseDesign,
  presets: PRESETS,
  buildParams: (design, params, printerId) => buildParamsWith(RIG_PARAMS, design, params, printerId),
  frame: (d) => {
    const b = bounds(d);
    if (!b) return { center: [0, 0, 150], radius: 450 };
    const c = scale(add(b.min, b.max), 0.5);
    const r = Math.max(150, Math.hypot(...sub(b.max, b.min)) / 2 + TRUSS_W);
    return { center: c, radius: r * 1.45 };
  },
  remove: removeFrom,
  fromPaths,
  fromPaths3D: fromPaths,
};

