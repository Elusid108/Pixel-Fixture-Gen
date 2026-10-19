import type { Manifold } from 'manifold-3d';
import { Geo } from '../geom/geo';
import { mul, Rz, T } from '../geom/mat';
import { getPixel } from '../pixels/library';
import { socketCutter } from '../pixels/sockets';
import type { FixtureDef, PartSpec, PixelPlacement, Port } from '../types';
import { bool, num, str } from './util';

const SQ3 = Math.sqrt(3);

/** Pointy-top hex lattice of `rings` rings: rows of 2n+1-|r| cells, serpentine data order. */
export function hiveCells(rings: number, pitch: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = -rings; r <= rings; r++) {
    const row: [number, number][] = [];
    for (let q = -rings; q <= rings; q++) {
      if (Math.abs(q + r) > rings) continue;
      row.push([pitch * (q + r / 2), pitch * (SQ3 / 2) * r]);
    }
    out.push(...((r + rings) % 2 ? row.reverse() : row));
  }
  return out;
}

/**
 * M1 Hive tile: concept 1 grown into a system.
 *
 * Layers from back to front: shell, then pixel carrier (12 mm nodes push through), then
 * honeycomb baffle (no cell-to-cell bleed), then opal diffuser. Each of the six edges carries
 * two 6×3 magnets, a JST pass-through notch at floor level and a bowtie key pocket on the
 * back face, so any edge mates with any edge.
 *
 * Magnet rule: on every edge, the left pocket takes N-out and the right takes S-out. Every
 * edge is then the same, and any two tiles mate in any rotation.
 */
export const hive: FixtureDef = {
  id: 'hive',
  code: 'M1',
  name: 'Hive tile',
  family: 'modular',
  tagline: 'Honeycomb pixel tile. Magnets, bowtie keys and wire notches on all six edges.',
  description:
    'One tile of the Hive system. Tiles mate edge to edge with magnets and bowtie keys hidden on the back. The strand runs serpentine through the cells and out through any edge notch to the next tile. The Workbench (next phase) builds whole walls from this tile.',
  params: [
    { key: 'pixel', label: 'Node', type: 'pixel', default: 'node-12-bullet', pixels: ['node-12-bullet', 'node-12-bullet-12v'], group: 'Pixels' },
    {
      key: 'rings',
      label: 'Size',
      type: 'select',
      default: '2',
      options: [
        { value: '1', label: 'S · 7 cells' },
        { value: '2', label: 'M · 19 cells' },
        { value: '3', label: 'L · 37 cells' },
      ],
      group: 'Shape',
    },
    { key: 'pitch', label: 'Cell pitch', type: 'number', default: 30, min: 22, max: 60, step: 1, unit: 'mm', group: 'Shape' },
    { key: 'baffle', label: 'Baffle depth', type: 'number', default: 20, min: 10, max: 45, step: 1, unit: 'mm', group: 'Shape', help: 'Deeper means a softer, more even cell.' },
    { key: 'wiring', label: 'Wiring space', type: 'number', default: 24, min: 18, max: 40, step: 1, unit: 'mm', group: 'Shape', help: 'Room behind the carrier for node bodies and strand slack.' },
    { key: 'diffuser', label: 'Diffuser', type: 'number', default: 1.2, min: 0.6, max: 2.4, step: 0.2, unit: 'mm', group: 'Shape' },
    { key: 'wall', label: 'Shell wall', type: 'number', default: 4.2, min: 3.6, max: 6, step: 0.2, unit: 'mm', group: 'Shape' },
    { key: 'magnets', label: 'Magnet pockets', type: 'boolean', default: true, group: 'Joinery' },
    { key: 'bowties', label: 'Bowtie keys', type: 'boolean', default: true, group: 'Joinery' },
    { key: 'tol', label: 'Node hole clearance', type: 'number', default: 0.1, min: 0, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit' },
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const pixel = getPixel(str(params, 'pixel'));
    const n = Number(str(params, 'rings'));
    const p = num(params, 'pitch');
    const baffleH = num(params, 'baffle');
    const wiring = num(params, 'wiring');
    const difT = num(params, 'diffuser');
    const wall = num(params, 'wall');
    const tol = num(params, 'tol');
    const nodeD = pixel.shape.kind === 'round' ? pixel.shape.d : 12;
    const warnings: string[] = [];

    const bw = 1.2; // baffle wall
    const cellIn = p / 2 - bw / 2;
    if (cellIn < nodeD / 2 + 1) warnings.push(`Cells are tight for a ${nodeD} mm node at ${p} mm pitch. Try ${Math.ceil(nodeD + 2 + bw)} mm or more.`);

    const floorT = 3.2;
    const carrierT = 2;
    const Ai = n * p * (SQ3 / 2) + p / SQ3 + 0.6;
    const A = Ai + wall;
    const Al = Ai - 2.5;
    const zLedge = floorT + wiring;
    const zBaffle = zLedge + carrierT;
    const zDiff = zBaffle + baffleH;
    const Hs = zDiff + difT;
    const edgeLen = 2 * A * Math.tan(Math.PI / 6);
    const cells = hiveCells(n, p);

    /* ---------- Shell ---------- */
    const shellCuts: Manifold[] = [g.extrude(g.hex(Al), floorT, Hs + 1), g.extrude(g.hex(Ai), zLedge, Hs + 1)];
    const edgeFeature = (m: Manifold, k: number) => g.place(m, Rz(30 + 60 * k));
    for (let k = 0; k < 6; k++) {
      // Edge-local: face at x=A, tangent along Y.
      shellCuts.push(edgeFeature(g.box([A - wall - 3.5, -4.5, floorT], [A + 1, 4.5, floorT + 7]), k)); // JST notch
      if (bool(params, 'magnets')) {
        for (const s of [-1, 1]) shellCuts.push(edgeFeature(g.cylX(3.15, A - 3.2, A + 0.1, (s * edgeLen) / 4, floorT + 8), k));
      }
      if (bool(params, 'bowties')) {
        shellCuts.push(edgeFeature(g.extrude(g.halfBowtie(8, 14, 10).rotate(90).translate([A, 0]), -1, 2.0), k));
      }
    }
    for (const sy of [-1, 1]) shellCuts.push(g.keyhole(floorT).translate([0, sy * A * 0.45, 0]));
    shellCuts.push(g.cylZ(5, -1, floorT + 1));
    const label = g
      .text(`M1 ${cells.length}`, 6, 0.8)
      .mirror([0, 1])
      .translate([0, -A * 0.18]);
    shellCuts.push(g.extrude(label, -1, 0.6));
    const shell = g.cut(g.extrude(g.hex(A), 0, Hs), shellCuts);

    /* ---------- Carrier, baffle, diffuser ---------- */
    const carrier = g.cut(
      g.extrude(g.hex(Ai - 0.3), 0, carrierT),
      cells.map(([x, y]) => g.place(socketCutter(g, pixel, { tol }), T(x, y, carrierT))),
    );
    const cellHoles = g.CS.union(cells.map(([x, y]) => g.hex(cellIn, false, x, y)));
    const baffle = g.extrude(g.hex(Ai - 0.3).subtract(cellHoles), 0, baffleH);
    const diffuser = g.extrude(g.hex(Ai - 0.25), 0, difT);
    const key = g.extrude(g.bowtie(7.7, 13.7, 9.8), 0, 1.8);

    const parts: PartSpec<Manifold>[] = [
      { id: 'shell', name: 'Back shell', role: 'body', solid: shell, instances: [T(0, 0, 0)], explode: [0, 0, -1] },
      { id: 'carrier', name: 'Pixel carrier', role: 'body', solid: carrier, instances: [T(0, 0, zLedge)], explode: [0, 0, 0.6] },
      { id: 'baffle', name: 'Honeycomb baffle', role: 'baffle', solid: baffle, instances: [T(0, 0, zBaffle)], explode: [0, 0, 1.4] },
      { id: 'diffuser', name: 'Opal diffuser', role: 'diffuser', solid: diffuser, instances: [T(0, 0, zDiff)], explode: [0, 0, 2.4] },
    ];
    if (bool(params, 'bowties')) {
      // Three keys, half-seated on alternate edges, so the view shows how neighbours lock on.
      parts.push({
        id: 'bowtie',
        name: 'Bowtie key',
        role: 'body',
        solid: key,
        instances: [0, 2, 4].map((k) => mul(Rz(30 + 60 * k), T(A, 0, 0), Rz(90), T(0, 0, -0.01))),
        explode: [0, 0, -1.6],
        note: 'One per seam. Glue optional.',
      });
    }

    const pixels: PixelPlacement[] = cells.map(([x, y]) => ({ pos: [x, y, Hs], normal: [0, 0, 1], unit: 'M1-A' }));
    const ports: Port[] = Array.from({ length: 6 }, (_, k) => {
      const a = ((30 + 60 * k) * Math.PI) / 180;
      return { id: `edge-${k}`, pos: [A * Math.cos(a), A * Math.sin(a), Hs / 2], normal: [Math.cos(a), Math.sin(a), 0], kind: 'hive-edge' };
    });

    const area = (6 * Ai * Ai) / SQ3;
    return {
      parts,
      pixels,
      ports,
      schedule: [
        {
          unit: 'M1-A',
          position: `Cells 1–${cells.length}, serpentine`,
          purpose: 'Pixel cells',
          pixelId: pixel.id,
          units: cells.length,
          px: cells.length,
          notes: 'Data in and out through any edge notch.',
        },
      ],
      hardware: [
        ...(bool(params, 'magnets') ? [{ item: '6×3 mm disc magnet', qty: 12, note: 'Left pocket N-out, right pocket S-out, on every edge' }] : []),
        { item: 'JST-SM 3-pin pigtail pair', qty: 1, note: 'Data/power in and out' },
        { item: 'Pan-head screw #6 / M3.5', qty: 2, note: 'Keyhole wall mount' },
      ],
      warnings,
      enclosureCm3: (area * (wiring + baffleH)) / 1000,
    };
  },
};
