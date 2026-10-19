import { isVec3 } from '../shared/layout';
import type { Vec3 } from '../../types';

/**
 * M3 Mini Rig: the editable design. A 1:6 F34 box-truss rig on the desk.
 *
 * - Nodes are corner blocks (block centre, Z-up mm). A node can stand on a base plate or
 *   carry a pick-point eye on top.
 * - Spans run node to node. The planner cuts each one into printable truss sections.
 * - Instruments clip onto a span's chord: which span, where along it (0–1 of the clear run
 *   between the blocks), which chord they hang from, and a pan/tilt for display.
 *
 * Everything derived (sections, block types, data order) is recomputed from this.
 */

export type InstrumentKind = 'par' | 'blinder2' | 'blinder4' | 'mover' | 'batten';

/**
 * Which chord an instrument clamps to. "below" hangs under the truss from a bottom chord,
 * "above" stands on a top chord. Front is the audience side (−Y on the bench). On a vertical
 * span "below" is the face toward the audience.
 */
export type MountSide = 'below-front' | 'below-back' | 'above-front' | 'above-back';

export interface RigNode {
  id: string;
  /** Corner block centre, mm, Z-up. */
  pos: Vec3;
  /** Base plate under the block (towers). */
  base: boolean;
  /** Pick-point eye on top of the block (flown truss). */
  pick: boolean;
}

export interface RigSpan {
  id: string;
  a: string;
  b: string;
}

export interface RigInstrument {
  id: string;
  kind: InstrumentKind;
  span: string;
  /** 0–1 along the clear run between the two corner blocks, from node a. */
  t: number;
  side: MountSide;
  /** Display only, degrees. Pan turns the yoke about the hang axis. */
  pan: number;
  /** Display only, degrees. Positive tilts the beam toward the front. */
  tilt: number;
}

export interface RigDesign {
  name: string;
  nodes: RigNode[];
  spans: RigSpan[];
  instruments: RigInstrument[];
  /** Node where the data and power feed comes in. Instruments chain from here. */
  controller: string;
}

export const KINDS: Record<InstrumentKind, { label: string; short: string; prefix: string; code: string; blurb: string }> = {
  par: { label: 'PAR', short: 'PAR', prefix: 'P', code: 'PAR', blurb: 'PAR can on a yoke. 7-px jewel behind a lens.' },
  blinder2: { label: '2-lite blinder', short: '2-lite', prefix: 'B', code: '2LT', blurb: 'Two lamps in reflector cups, side by side.' },
  blinder4: { label: '4-lite blinder', short: '4-lite', prefix: 'B', code: '4LT', blurb: 'Four lamps in reflector cups, 2 × 2.' },
  mover: { label: 'Static mover', short: 'Mover', prefix: 'M', code: 'MOV', blurb: 'Moving-head look: base, yoke and head with a jewel.' },
  batten: { label: 'Batten', short: 'Batten', prefix: 'L', code: 'BAT', blurb: 'Short LED batten: strip under a slide-in diffuser.' },
};

export const KIND_LIST = Object.keys(KINDS) as InstrumentKind[];
export const SIDES: MountSide[] = ['below-front', 'below-back', 'above-front', 'above-back'];
export const SIDE_LABEL: Record<MountSide, string> = {
  'below-front': 'Under, front chord',
  'below-back': 'Under, back chord',
  'above-front': 'On top, front chord',
  'above-back': 'On top, back chord',
};

export function emptyDesign(): RigDesign {
  return { name: 'Untitled rig', nodes: [], spans: [], instruments: [], controller: '' };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Defensive parse: anything malformed is dropped or defaulted, never thrown. */
export function parseDesign(json: string): RigDesign {
  try {
    const d = JSON.parse(json) as Partial<RigDesign> | null;
    if (!d || typeof d !== 'object') return emptyDesign();
    const nodes: RigNode[] = Array.isArray(d.nodes)
      ? d.nodes.filter((n) => n && typeof n.id === 'string' && isVec3(n.pos)).map((n) => ({ id: n.id, pos: [n.pos[0], n.pos[1], n.pos[2]] as Vec3, base: n.base === true, pick: n.pick === true }))
      : [];
    const spans: RigSpan[] = Array.isArray(d.spans)
      ? d.spans.filter((s) => s && typeof s.id === 'string' && typeof s.a === 'string' && typeof s.b === 'string').map((s) => ({ id: s.id, a: s.a, b: s.b }))
      : [];
    const instruments: RigInstrument[] = Array.isArray(d.instruments)
      ? d.instruments
          .filter((i) => i && typeof i.id === 'string' && typeof i.span === 'string' && KIND_LIST.includes(i.kind))
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            span: i.span,
            t: Math.min(1, Math.max(0, num(i.t, 0.5))),
            side: SIDES.includes(i.side) ? i.side : 'below-front',
            pan: num(i.pan, 0),
            tilt: num(i.tilt, 0),
          }))
      : [];
    return {
      name: typeof d.name === 'string' ? d.name : 'Untitled rig',
      nodes,
      spans,
      instruments,
      controller: typeof d.controller === 'string' ? d.controller : '',
    };
  } catch {
    return emptyDesign();
  }
}

export { nextId } from '../shared/layout';
