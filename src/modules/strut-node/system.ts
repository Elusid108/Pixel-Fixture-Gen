import { fromPlane } from '../../sketch/geom';
import type { SketchPath, SketchRegion } from '../../sketch/types';
import type { SystemCore } from '../../workbench/system';
import { add, dist, emptyDesign, nextId, parseDesign, scale, type SnDesign } from './model';
import { snParams } from './plan';
import { designRadius, PRESETS } from './presets';
import type { Vec3 } from '../../types';

/** Drawn vertices closer than this to an existing hub reuse it, mm. */
export const MERGE_TOL = 2;

/**
 * Sketch → wireframe: every vertex becomes a hub (merged with any hub within MERGE_TOL),
 * every segment a strut (duplicates skipped). Closed paths close the loop.
 */
export function addPolylines(design: SnDesign, polylines: { pts: Vec3[]; closed: boolean }[]): SnDesign {
  const nodes = [...design.nodes];
  const struts = [...design.struts];
  const hubAt = (p: Vec3): string => {
    const hit = nodes.find((n) => dist(n.pos, p) <= MERGE_TOL);
    if (hit) return hit.id;
    const id = nextId('H', nodes.map((n) => n.id));
    nodes.push({ id, pos: p.map((v) => Math.round(v * 10) / 10) as Vec3 });
    return id;
  };
  for (const pl of polylines) {
    const ids = pl.pts.map(hubAt);
    const n = pl.closed ? ids.length : ids.length - 1;
    for (let i = 0; i < n; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      if (a === b || struts.some((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))) continue;
      struts.push({ id: nextId('S', struts.map((s) => s.id)), a, b });
    }
  }
  return { ...design, nodes, struts, controller: design.controller || nodes[0]?.id || '' };
}

const fromPaths = (paths: SketchPath[], design: SnDesign) => addPolylines(design, paths);

const code = (id: string) => (id === 'geo2v' ? '2V' : id.slice(0, 3).toUpperCase());

/** M4 Strut & Node, pure half. */
export const strutNodeCore: SystemCore<SnDesign> = {
  id: 'strut-node',
  code: 'M4',
  name: 'Strut & Node',
  tagline: 'Wireframes with hubs generated at their exact socket angles.',
  moduleId: 'strut-node',
  empty: emptyDesign,
  parse: parseDesign,
  // Icosahedron first: it's what a fresh bench has always opened with.
  presets: [...PRESETS].sort((a, b) => Number(b.id === 'icosa') - Number(a.id === 'icosa')).map((p) => ({ id: p.id, code: code(p.id), name: p.name, blurb: p.blurb, make: p.make })),
  buildParams: (design, params, printerId) => ({ ...snParams({ ...params, printer: printerId }), design: JSON.stringify(design) }),
  frame: (d) => {
    if (!d.nodes.length) return { center: [0, 0, 60], radius: 300 };
    const c = d.nodes.reduce<Vec3>((s, n) => add(s, scale(n.pos, 1 / d.nodes.length)), [0, 0, 0]);
    // The bench canvas is short and wide; give the whole design room.
    return { center: c, radius: designRadius(d) * 1.5 };
  },
  remove: (d, sel) => {
    if (sel.kind === 'node') {
      const nodes = d.nodes.filter((n) => n.id !== sel.id);
      const gone = new Set(d.struts.filter((s) => s.a === sel.id || s.b === sel.id).map((s) => s.id));
      return {
        ...d,
        nodes,
        struts: d.struts.filter((s) => !gone.has(s.id)),
        order: d.order.filter((o) => !gone.has(o)),
        controller: d.controller === sel.id ? (nodes[0]?.id ?? '') : d.controller,
      };
    }
    if (sel.kind === 'strut') return { ...d, struts: d.struts.filter((s) => s.id !== sel.id), order: d.order.filter((o) => o !== sel.id) };
    return d;
  },
  fromPaths,
  fromPaths3D: fromPaths,
  // Outlines of drawn shapes become rings of struts.
  fromRegions: (regions: SketchRegion[], design) =>
    addPolylines(
      design,
      regions.flatMap((r) => [r.outer, ...r.holes].map((loop) => ({ pts: loop.map((p) => fromPlane(p, r.plane)), closed: true }))),
    ),
  // Unique engraving makes every hub its own part; keep that variant to the smaller presets.
  skipVariant: (d, key, value) => key === 'labels' && value === 'ids' && d.nodes.length > 12,
};
