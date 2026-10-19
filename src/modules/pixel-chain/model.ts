import { isVec3 } from '../shared/layout';
import type { Vec3 } from '../../types';

/**
 * M7 Pixel Chain: the editable design. A garland is a list of anchor (hang) points with a
 * sag per span between consecutive anchors. Hinged diffuser links, one 12 mm node each, drape
 * between the anchors on a catenary. Everything else (link count, link poses, bend angles,
 * data order, strand splices) is derived in ./plan from this and the system params.
 *
 * Anchors are the centres of the anchor links: the beads that hang from a hook by their bail.
 */

export interface PcGarland {
  id: string;
  /** Anchor link centres, mm, Z-up, in chain order. */
  anchors: Vec3[];
  /** Sag per span, % of the span's pin-to-pin chord, measured vertically from the chord. */
  sags: number[];
  /** Link pitch for this garland, mm. Omitted: the system's pitch param. */
  pitch?: number;
  /** The last anchor links back to the first (a ring). */
  closed?: boolean;
  /** Data enters at the last anchor instead of the first. */
  reverse?: boolean;
}

export interface PcDesign {
  name: string;
  garlands: PcGarland[];
}

/** Sag new spans get, % of chord. */
export const DEFAULT_SAG = 18;
export const SAG_MIN = 1;
export const SAG_MAX = 60;

export function emptyDesign(): PcDesign {
  return { name: 'Untitled', garlands: [] };
}

/** Spans in a garland: anchors − 1, or one more when closed (needs 3+ anchors). */
export function spanCount(g: Pick<PcGarland, 'anchors' | 'closed'>): number {
  const n = g.anchors.length;
  if (n < 2) return 0;
  return g.closed && n >= 3 ? n : n - 1;
}

function parseGarland(x: unknown): PcGarland | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !Array.isArray(o.anchors)) return null;
  const anchors = o.anchors.filter(isVec3).map((v) => [v[0], v[1], v[2]] as Vec3);
  if (!anchors.length) return null;
  const g: PcGarland = { id: o.id, anchors, sags: [] };
  if (o.closed === true) g.closed = true;
  if (o.reverse === true) g.reverse = true;
  if (typeof o.pitch === 'number' && Number.isFinite(o.pitch) && o.pitch > 0) g.pitch = o.pitch;
  const raw = Array.isArray(o.sags) ? o.sags : [];
  const n = spanCount(g);
  g.sags = Array.from({ length: n }, (_, i) => (typeof raw[i] === 'number' && Number.isFinite(raw[i]) ? (raw[i] as number) : DEFAULT_SAG));
  return g;
}

/** Defensive parse: anything malformed is dropped, never thrown. */
export function parseDesign(json: string): PcDesign {
  try {
    const d = JSON.parse(json) as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return emptyDesign();
    const seen = new Set<string>();
    const garlands: PcGarland[] = [];
    for (const raw of Array.isArray(d.garlands) ? d.garlands : []) {
      const g = parseGarland(raw);
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      garlands.push(g);
    }
    return { name: typeof d.name === 'string' ? d.name : 'Untitled', garlands };
  } catch {
    return emptyDesign();
  }
}

/** Selection ids for anchors: "G01:2" (garland, 0-based anchor index). */
export const anchorKey = (gid: string, i: number) => `${gid}:${i}`;
export function parseAnchorKey(key: string): { gid: string; index: number } | null {
  const at = key.lastIndexOf(':');
  if (at < 1) return null;
  const index = Number(key.slice(at + 1));
  return Number.isInteger(index) && index >= 0 ? { gid: key.slice(0, at), index } : null;
}

/** Anchor label shown on the bench and in tables: A1, A2 … */
export const anchorLabel = (i: number) => `A${i + 1}`;

/** Remove one anchor; the two spans either side merge (keeping the earlier span's sag). */
export function removeAnchor(g: PcGarland, index: number): PcGarland | null {
  if (index < 0 || index >= g.anchors.length) return g;
  const anchors = g.anchors.filter((_, i) => i !== index);
  if (anchors.length < 2) return null;
  const sags = [...g.sags];
  // Span k joins anchor k and k+1. Dropping anchor i merges spans i-1 and i into one that
  // keeps span i-1's sag. Open garlands lose span 0 when the first anchor goes. Closed ones
  // re-index so that the same splice is right for every i.
  sags.splice(index, 1);
  const out: PcGarland = { ...g, anchors, sags };
  const want = spanCount(out);
  out.sags = Array.from({ length: want }, (_, i) => sags[i] ?? DEFAULT_SAG);
  if (out.closed && anchors.length < 3) delete out.closed;
  return out;
}

export function removeFromDesign(d: PcDesign, sel: { kind: string; id: string }): PcDesign {
  if (sel.kind === 'garland') return { ...d, garlands: d.garlands.filter((g) => g.id !== sel.id) };
  if (sel.kind === 'anchor') {
    const k = parseAnchorKey(sel.id);
    if (!k) return d;
    const garlands: PcGarland[] = [];
    for (const g of d.garlands) {
      if (g.id !== k.gid) garlands.push(g);
      else {
        const next = removeAnchor(g, k.index);
        if (next) garlands.push(next);
      }
    }
    return { ...d, garlands };
  }
  return d;
}
