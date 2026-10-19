import type { SystemCore } from '../../workbench/system';
import { add, emptyDesign, parseDesign, scale, type SnDesign } from './model';
import { snParams } from './plan';
import { designRadius, PRESETS } from './presets';
import type { Vec3 } from '../../types';

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
  // Unique engraving makes every hub its own part; keep that variant to the smaller presets.
  skipVariant: (d, key, value) => key === 'labels' && value === 'ids' && d.nodes.length > 12,
};
