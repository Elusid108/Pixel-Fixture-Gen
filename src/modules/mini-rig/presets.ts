import type { BenchPreset } from '../../workbench/system';
import type { Vec3 } from '../../types';
import type { InstrumentKind, MountSide, RigDesign, RigInstrument, RigNode, RigSpan } from './model';
import { BASE_T, TRUSS_W } from './params';

/*
 * Preset rigs. Spans are sized so their clear runs are whole stock sections at 1:6:
 * 548 mm centre to centre = 2 × 1.5 m, 381.3 mm = 2 × 1 m (plus a half block each end).
 */

const H = TRUSS_W / 2;
/** Block centre of a node standing on a base plate. */
const FLOOR = BASE_T + H;
/** Top of a 2 × 1 m tower. */
const TOWER = 409.3;

const node = (id: string, pos: Vec3, extra: Partial<Pick<RigNode, 'base' | 'pick'>> = {}): RigNode => ({ id, pos, base: extra.base ?? false, pick: extra.pick ?? false });
const span = (id: string, a: string, b: string): RigSpan => ({ id, a, b });

function hang(list: [InstrumentKind, string, number, MountSide, number, number][]): RigInstrument[] {
  const n = new Map<string, number>();
  const prefix: Record<InstrumentKind, string> = { par: 'P', blinder2: 'B', blinder4: 'B', mover: 'M', batten: 'L' };
  return list.map(([kind, sp, t, side, pan, tilt]) => {
    const p = prefix[kind];
    const k = (n.get(p) ?? 0) + 1;
    n.set(p, k);
    return { id: `${p}${String(k).padStart(2, '0')}`, kind, span: sp, t, side, pan, tilt };
  });
}

/** Two 2 m towers on base plates and a 3 m header: six PARs and a batten, audience blinders. */
function goalpost(): RigDesign {
  return {
    name: 'Goalpost',
    nodes: [node('N01', [-274, 0, FLOOR], { base: true }), node('N02', [-274, 0, TOWER]), node('N03', [274, 0, TOWER]), node('N04', [274, 0, FLOOR], { base: true })],
    spans: [span('S01', 'N01', 'N02'), span('S02', 'N02', 'N03'), span('S03', 'N04', 'N03')],
    instruments: hang([
      ['blinder2', 'S01', 0.62, 'below-front', 90, 0],
      ...[1, 3, 5, 7, 9, 11].map((k) => ['par', 'S02', k / 12, 'below-front', 0, 35] as [InstrumentKind, string, number, MountSide, number, number]),
      ['batten', 'S02', 0.5, 'below-back', 0, 15],
      ['blinder2', 'S03', 0.62, 'below-front', 90, 0],
    ]),
    controller: 'N01',
  };
}

/** Ground-support box: four legs, a 3 m × 2 m roof. Blinders on the front, movers behind. */
function box(): RigDesign {
  const x = 274;
  const y = 190.7;
  return {
    name: 'Box on four legs',
    nodes: [
      node('N01', [-x, -y, FLOOR], { base: true }),
      node('N02', [x, -y, FLOOR], { base: true }),
      node('N03', [x, y, FLOOR], { base: true }),
      node('N04', [-x, y, FLOOR], { base: true }),
      node('N05', [-x, -y, TOWER]),
      node('N06', [x, -y, TOWER]),
      node('N07', [x, y, TOWER]),
      node('N08', [-x, y, TOWER]),
    ],
    spans: [
      span('S01', 'N01', 'N05'),
      span('S02', 'N02', 'N06'),
      span('S03', 'N03', 'N07'),
      span('S04', 'N04', 'N08'),
      span('S05', 'N05', 'N06'),
      span('S06', 'N06', 'N07'),
      span('S07', 'N07', 'N08'),
      span('S08', 'N08', 'N05'),
    ],
    instruments: hang([
      ['blinder4', 'S05', 0.3, 'below-front', 0, 25],
      ['blinder4', 'S05', 0.7, 'below-front', 0, 25],
      ['mover', 'S06', 0.5, 'below-front', 0, 20],
      ['mover', 'S07', 0.25, 'below-front', 0, 30],
      ['mover', 'S07', 0.5, 'below-front', 0, 30],
      ['mover', 'S07', 0.75, 'below-front', 0, 30],
      ['mover', 'S08', 0.5, 'below-back', 0, 20],
    ]),
    controller: 'N01',
  };
}

/** A flown 2 × 2 m pipe on three pick points: PARs, movers and a batten. */
function pipe(): RigDesign {
  const z = 400;
  return {
    name: 'Flown pipe',
    nodes: [node('N01', [-381.3, 0, z], { pick: true }), node('N02', [0, 0, z], { pick: true }), node('N03', [381.3, 0, z], { pick: true })],
    spans: [span('S01', 'N01', 'N02'), span('S02', 'N02', 'N03')],
    instruments: hang([
      ['par', 'S01', 0.15, 'below-front', 0, 40],
      ['mover', 'S01', 0.5, 'below-front', 0, 25],
      ['par', 'S01', 0.85, 'below-front', 0, 40],
      ['batten', 'S01', 0.5, 'below-back', 0, 0],
      ['par', 'S02', 0.15, 'below-front', 0, 40],
      ['mover', 'S02', 0.5, 'below-front', 0, 25],
      ['par', 'S02', 0.85, 'below-front', 0, 40],
    ]),
    controller: 'N01',
  };
}

export const PRESETS: BenchPreset<RigDesign>[] = [
  { id: 'goalpost', code: 'GP', name: 'Goalpost', blurb: 'Two towers on base plates and a 3 m header: six PARs, a batten and two audience blinders.', make: goalpost },
  { id: 'box', code: 'BOX', name: 'Box on four legs', blurb: 'Ground-support box with 3-way corners: 4-lite blinders up front, movers on the back and sides.', make: box },
  { id: 'pipe', code: 'PIP', name: 'Flown pipe', blurb: 'A straight run hung from three pick points, PARs and movers alternating.', make: pipe },
];
