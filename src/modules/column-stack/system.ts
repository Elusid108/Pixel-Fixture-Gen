import type { BenchPreset, SystemCore } from '../../workbench/system';
import type { Vec3 } from '../../types';
import { buildParamsWith } from '../shared/params';
import { emptyDesign, parseDesign, type CapKind, type ColumnDesign, type Mount, type Segment, type SegKind, type Stack } from './model';
import { CS_PARAMS, csParams } from './params';
import { designBounds } from './plan';

/** Preset helper: a stack of kinds, ids numbered across the whole design. */
function presetDesign(name: string, stacks: { pos: Vec3; mount: Mount; drop?: number; kinds: (SegKind | [SegKind, Partial<Segment>])[]; cap: CapKind }[]): ColumnDesign {
  let seg = 0;
  return {
    name,
    stacks: stacks.map((s, i): Stack => ({
      id: `T${String(i + 1).padStart(2, '0')}`,
      pos: s.pos,
      mount: s.mount,
      ...(s.drop !== undefined ? { drop: s.drop } : {}),
      segments: s.kinds.map((k) => {
        const [kind, opts] = Array.isArray(k) ? k : [k, {}];
        return { id: `S${String(++seg).padStart(2, '0')}`, kind, ...opts };
      }),
      cap: s.cap,
    })),
  };
}

const around = (r: number, deg: number, z: number): Vec3 => [Math.round(r * Math.cos((deg * Math.PI) / 180)), Math.round(r * Math.sin((deg * Math.PI) / 180)), z];

export const PRESETS: BenchPreset<ColumnDesign>[] = [
  {
    id: 'spiral',
    code: 'SPR',
    name: 'Spiral tower',
    blurb: 'Floor column on a PSU base: helix, ring bands, lattice, louver and a pixel ring under a dome.',
    make: () => presetDesign('Spiral tower', [{ pos: [0, 0, 0], mount: 'floor', kinds: ['helix', 'band', 'lattice', 'louver', 'ring', 'band'], cap: 'dome' }]),
  },
  {
    id: 'chandelier',
    code: 'CHN',
    name: 'Chandelier trio',
    blurb: 'Three drops of different lengths from ceiling canopies, each ending in a different cap.',
    make: () =>
      presetDesign('Chandelier trio', [
        { pos: around(150, 90, 1000), mount: 'hang', drop: 120, kinds: ['band', 'ring', 'band'], cap: 'dome' },
        { pos: around(150, 210, 1000), mount: 'hang', drop: 320, kinds: ['band', 'helix', 'band'], cap: 'fresnel' },
        { pos: around(150, 330, 1000), mount: 'hang', drop: 220, kinds: ['band', 'louver', 'band'], cap: 'finial' },
      ]),
  },
  {
    id: 'desk',
    code: 'DSK',
    name: 'Desk column',
    blurb: 'A short column for a desk: a pixel ring and a band under a Fresnel cap.',
    make: () => presetDesign('Desk column', [{ pos: [0, 0, 0], mount: 'floor', kinds: [['ring', { h: 50 }], 'band'], cap: 'fresnel' }]),
  },
];

/** M6 Column Stack, pure half. */
export const columnStackCore: SystemCore<ColumnDesign> = {
  id: 'column-stack',
  code: 'M6',
  name: 'Column Stack',
  tagline: 'Keyed column segments on a PSU base, or hung as chandelier drops.',
  moduleId: 'column-stack',
  empty: emptyDesign,
  parse: parseDesign,
  presets: PRESETS,
  buildParams: (design, params, printerId) => buildParamsWith(CS_PARAMS, design, params, printerId),
  frame: (d) => {
    const b = designBounds(d, csParams());
    if (!b) return { center: [0, 0, 150], radius: 450 };
    const center: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const half = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    return { center, radius: Math.max(250, half * 1.4) };
  },
  remove: (d, sel) => {
    if (sel.kind === 'stack') return { ...d, stacks: d.stacks.filter((s) => s.id !== sel.id) };
    if (sel.kind === 'segment') return { ...d, stacks: d.stacks.map((s) => (s.segments.some((g) => g.id === sel.id) ? { ...s, segments: s.segments.filter((g) => g.id !== sel.id) } : s)) };
    return d;
  },
};
