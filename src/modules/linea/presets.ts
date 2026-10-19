import { fromPlane, regularPolygon } from '../../sketch/geom';
import { planeXY, planeXZ, type SketchPlane, type Vec2 } from '../../sketch/types';
import type { BenchPreset } from '../../workbench/system';
import { addPaths, type PathIn } from './lock';
import { emptyDesign, type LineaDesign } from './model';

/**
 * Presets are drawn the way a user would draw them, then run through the same adapter, so
 * they arrive pitch-locked with their T and X joints. Sizes are picked to lock exactly at
 * 60 px/m (other pixels re-lock and absorb any leftover at the T and X joints).
 */

const P = 1000 / 60;

function path(plane: SketchPlane, pts: Vec2[], closed = false): PathIn {
  return { plane, pts: pts.map((p) => fromPlane(p, plane)), closed };
}

function make(name: string, paths: PathIn[]): LineaDesign {
  return { ...addPaths(emptyDesign(), paths), name };
}

const wall = planeXZ(0);

export const PRESETS: BenchPreset<LineaDesign>[] = [
  {
    id: 'corner-t',
    code: 'L+T',
    name: 'Wall line with a T',
    blurb: 'A wall line with a 90° and a 135° corner, and a branch dropping onto it as a T.',
    make: () =>
      make('Wall line with a T', [
        path(wall, [
          [-310, 80],
          [0, 80],
          [0, 280],
          [190 * Math.SQRT1_2, 280 + 190 * Math.SQRT1_2],
        ]),
        path(wall, [
          [-150, 80 + 10 + 2 * P + 10 * P],
          [-150, 80],
        ]),
      ]),
  },
  {
    id: 'window',
    code: 'WIN',
    name: 'Window',
    blurb: 'A square frame with a mullion and a transom: four corners, four T joints and an X.',
    make: () =>
      make('Window', [
        path(
          wall,
          [
            [-200, 40],
            [200, 40],
            [200, 440],
            [-200, 440],
          ],
          true,
        ),
        path(wall, [
          [0, 40],
          [0, 440],
        ]),
        path(wall, [
          [-200, 240],
          [200, 240],
        ]),
      ]),
  },
  {
    id: 'hexagon',
    code: 'HEX',
    name: 'Hexagon frame',
    blurb: 'A closed hexagon on the floor, light facing up: six exact 120° corners, five of them one part.',
    make: () => make('Hexagon frame', [path(planeXY(0), regularPolygon([0, 0], 2 * P + 9 * P, 6, 0), true)]),
  },
];
