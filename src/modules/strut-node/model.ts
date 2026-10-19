import type { Vec3 } from '../../types';

/**
 * M4 Strut & Node: the editable design. Nodes become printed hubs, struts become diffuser
 * tubes with a pixel spine inside. Everything derived (offsets, cut lengths, classes,
 * data order) is recomputed from this, so the design stays small enough to keep in a param.
 */

export interface SnNode {
  id: string;
  /** Hub centre, mm, Z-up. */
  pos: Vec3;
}

export interface SnStrut {
  id: string;
  a: string;
  b: string;
  /** Wire-only: an opaque tube with no pixels. Data and power still pass through. */
  dark?: boolean;
  /** Reverse the strip relative to the data path. A return wire runs back through the spine. */
  flip?: boolean;
}

export interface SnDesign {
  name: string;
  nodes: SnNode[];
  struts: SnStrut[];
  /** Node whose hub takes the controller feed. Data order starts here. */
  controller: string;
  /** User-picked strut order. The suggested path continues from the last one. */
  order: string[];
}

export function emptyDesign(): SnDesign {
  return { name: 'Untitled', nodes: [], struts: [], controller: '', order: [] };
}

export function parseDesign(json: string): SnDesign {
  try {
    const d = JSON.parse(json) as Partial<SnDesign>;
    return {
      name: typeof d.name === 'string' ? d.name : 'Untitled',
      nodes: Array.isArray(d.nodes) ? d.nodes.filter((n) => n && typeof n.id === 'string' && Array.isArray(n.pos)) : [],
      struts: Array.isArray(d.struts) ? d.struts.filter((s) => s && typeof s.id === 'string') : [],
      controller: typeof d.controller === 'string' ? d.controller : '',
      order: Array.isArray(d.order) ? d.order.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return emptyDesign();
  }
}

/** Next free id with a prefix: H01, H02 … then H100 when the two-digit space runs out. */
export function nextId(prefix: string, taken: Iterable<string>): string {
  let max = 0;
  for (const id of taken) {
    const m = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    if (Number.isFinite(m)) max = Math.max(max, m);
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

export * from '../../geom/vec';
