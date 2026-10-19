import type { Vec3 } from '../../types';
import { isVec3, nextId } from '../shared/layout';

/**
 * M6 Column Stack: the editable design. Each stack is a base (or a ceiling canopy for a
 * hanging drop), an ordered list of segments and a cap. Segments are keyed modules of one
 * column diameter, so they stack in any order; everything derived (heights, joints, pixels,
 * data order) is recomputed from this by `plan.ts`.
 *
 * Segment order: index 0 sits on the base (floor) or hangs right under the canopy (hang).
 * Data enters there and runs out along the column, so the list is also the data order.
 */

export type Mount = 'floor' | 'hang';
export type SegKind = 'helix' | 'band' | 'lattice' | 'louver' | 'ring';
export type CapKind = 'dome' | 'fresnel' | 'finial';

export interface Segment {
  id: string;
  kind: SegKind;
  /** Segment height (shell, without the spigot), mm. Default per kind. */
  h?: number;
  /** Count option, per kind: helix dots, lattice strip runs, louver cells around, nodes per ring. */
  n?: number;
  /** Helix only: how far the helix turns over the segment, degrees. 360 continues seamlessly. */
  twist?: number;
}

export interface Stack {
  id: string;
  /** Floor: centre of the base on the floor. Hang: the ceiling point the canopy mounts to. Z-up mm. */
  pos: Vec3;
  mount: Mount;
  /** Hang only: cable length between the canopy and the column, mm. */
  drop?: number;
  segments: Segment[];
  cap: CapKind;
}

export interface ColumnDesign {
  name: string;
  stacks: Stack[];
}

export const SEG_KINDS: SegKind[] = ['helix', 'band', 'lattice', 'louver', 'ring'];
export const CAP_KINDS: CapKind[] = ['dome', 'fresnel', 'finial'];

export interface KindInfo {
  name: string;
  code: string;
  blurb: string;
  /** Default and minimum height, mm. */
  h: number;
  minH: number;
  /** Count option, when the kind has one. */
  n?: { def: number; min: number; max: number; label: string };
  twist?: boolean;
}

export const KINDS: Record<SegKind, KindInfo> = {
  helix: {
    name: 'Helix dots',
    code: 'HLX',
    blurb: 'Pixel dots on a helix behind windows in a thick shell. 360° twist runs on into the next helix.',
    h: 100,
    minH: 60,
    n: { def: 12, min: 4, max: 24, label: 'Dots' },
    twist: true,
  },
  band: {
    name: 'Ring band',
    code: 'BND',
    blurb: 'Translucent band lit by a ring PCB under a 45° reflector cone.',
    h: 44,
    minH: 38,
  },
  lattice: {
    name: 'Lattice',
    code: 'LAT',
    blurb: 'Open diamond lattice around a core carrying vertical strip runs.',
    h: 100,
    minH: 60,
    n: { def: 4, min: 3, max: 6, label: 'Strip runs' },
  },
  louver: {
    name: 'Louver',
    code: 'LVR',
    blurb: 'Stacked angled louvers, one pixel cell per gap. No direct glare.',
    h: 96,
    minH: 60,
    n: { def: 4, min: 3, max: 8, label: 'Cells around' },
  },
  ring: {
    name: 'Pixel ring',
    code: 'PXR',
    blurb: 'Rings of push-in bullet nodes around the column, alternate rows staggered.',
    h: 70,
    minH: 40,
    n: { def: 8, min: 4, max: 16, label: 'Nodes per ring' },
  },
};

export const CAPS: Record<CapKind, { name: string; code: string; blurb: string }> = {
  dome: { name: 'Dome', code: 'DOM', blurb: 'Pointed diffuser dome over a 7-px jewel. 45° ogive, prints upright.' },
  fresnel: { name: 'Fresnel cap', code: 'FRS', blurb: 'Stepped-ring lens over a 7-px jewel. Prints lens face down.' },
  finial: { name: 'Finial', code: 'FIN', blurb: 'Turned spire. Unlit, ends the wire chase.' },
};

/** Default cable length for a new hanging drop, mm. */
export const DEFAULT_DROP = 250;

export function emptyDesign(): ColumnDesign {
  return { name: 'Untitled', stacks: [] };
}

const isKind = (k: unknown): k is SegKind => typeof k === 'string' && (SEG_KINDS as string[]).includes(k);
const isCap = (k: unknown): k is CapKind => typeof k === 'string' && (CAP_KINDS as string[]).includes(k);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseSegment(x: unknown, taken: Set<string>): Segment | null {
  const s = x as Partial<Segment> | null;
  if (!s || typeof s !== 'object' || !isKind(s.kind)) return null;
  const id = typeof s.id === 'string' && s.id && !taken.has(s.id) ? s.id : nextId('S', taken);
  taken.add(id);
  const out: Segment = { id, kind: s.kind };
  if (finite(s.h)) out.h = s.h;
  if (finite(s.n)) out.n = s.n;
  if (finite(s.twist)) out.twist = s.twist;
  return out;
}

/** Defensive parse: malformed input yields a valid (possibly empty) design. Ids stay unique. */
export function parseDesign(json: string): ColumnDesign {
  try {
    const d = JSON.parse(json) as Partial<ColumnDesign> | null;
    if (!d || typeof d !== 'object') return emptyDesign();
    const stackIds = new Set<string>();
    const segIds = new Set<string>();
    const stacks: Stack[] = [];
    for (const x of Array.isArray(d.stacks) ? d.stacks : []) {
      const s = x as Partial<Stack> | null;
      if (!s || typeof s !== 'object' || !isVec3(s.pos)) continue;
      const id = typeof s.id === 'string' && s.id && !stackIds.has(s.id) ? s.id : nextId('T', stackIds);
      stackIds.add(id);
      stacks.push({
        id,
        pos: s.pos,
        mount: s.mount === 'hang' ? 'hang' : 'floor',
        ...(finite(s.drop) ? { drop: s.drop } : {}),
        segments: (Array.isArray(s.segments) ? s.segments : []).map((g) => parseSegment(g, segIds)).filter((g): g is Segment => g !== null),
        cap: isCap(s.cap) ? s.cap : 'dome',
      });
    }
    return { name: typeof d.name === 'string' ? d.name : 'Untitled', stacks };
  } catch {
    return emptyDesign();
  }
}

export const allSegmentIds = (d: ColumnDesign) => d.stacks.flatMap((s) => s.segments.map((g) => g.id));

/** The stack holding a segment, with its index. */
export function findSegment(d: ColumnDesign, segId: string): { stack: Stack; index: number; seg: Segment } | null {
  for (const stack of d.stacks) {
    const index = stack.segments.findIndex((g) => g.id === segId);
    if (index >= 0) return { stack, index, seg: stack.segments[index] };
  }
  return null;
}

/** A new segment of a kind with a fresh id. Options stay unset, so kind defaults apply. */
export function newSegment(d: ColumnDesign, kind: SegKind, extraIds: string[] = []): Segment {
  return { id: nextId('S', [...allSegmentIds(d), ...extraIds]), kind };
}
