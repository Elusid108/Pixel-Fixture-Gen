import type { CrossSection, Manifold } from 'manifold-3d';
import { hiveLabel, hiveTileSolids } from '../../fixtures/hive';
import { str } from '../../fixtures/util';
import { Geo } from '../../geom/geo';
import { mul, Rz, T } from '../../geom/mat';
import { add, scale } from '../../geom/vec';
import { fromPlane, planeNormal } from '../../sketch/geom';
import type { Vec2 } from '../../sketch/types';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { plural, planeFrame } from '../shared/layout';
import { fromLattice, GAP, layoutWall, RAIL, toLattice, type HwDims, type HwSlot } from './layout';
import { parseDesign, type HwDesign } from './model';
import { HW_PARAMS } from './params';

const SQ3 = Math.sqrt(3);

/** Drop slivers a 2D boolean can leave at a trimmed corner. */
function cleanCS(g: Geo, cs: CrossSection, min = 2): CrossSection {
  const bits = cs.decompose();
  if (bits.length < 2) return cs;
  return g.CS.compose(bits.filter((b) => b.area() >= min));
}

function cleanM(g: Geo, m: Manifold, min = 1): Manifold {
  const bits = m.decompose();
  if (bits.length < 2) return m;
  return g.M.compose(bits.filter((b) => b.volume() >= min));
}

/** The wall's areas in one tile's local frame, as one exact CrossSection. */
function regionAt(g: Geo, design: HwDesign, s: HwSlot): CrossSection {
  const local = (loop: Vec2[]) => loop.map((p) => {
    const q = toLattice(design.lattice, p);
    return [q[0] - s.center[0], q[1] - s.center[1]] as [number, number];
  });
  return g.CS.union(design.areas.map((a) => (a.holes.length ? g.poly(local(a.outer)).subtract(g.CS.union(a.holes.map((h) => g.poly(local(h))))) : g.poly(local(a.outer)))));
}

/**
 * A printed cleat rail with `n` hanger studs on the tile pitch. Printed flat, studs up: each stud
 * is a shank that fits the keyhole slot and a head that drops through its entry, with a 45°
 * cone under the head so it prints without support. Countersunk screw holes either side of
 * every stud fix it to the wall.
 */
function railSolid(g: Geo, d: HwDims, n: number, len: number): Manifold {
  const t = RAIL.t;
  const zc = t + d.floorT + 0.4;
  const stud = g.revolve(
    [
      [0, t - 0.5],
      [2.0, t - 0.5],
      [2.0, zc],
      [4.2, zc + 2.2],
      [4.2, zc + 3.2],
      [0, zc + 3.2],
    ],
    24,
  );
  const xs = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * d.colW);
  const bar = g.extrude(g.roundRect(len, RAIL.w, 2), 0, t);
  const screw = g.union([g.cylZ(2.1, -1, t + 1, 0, 0, 16), g.coneZ(2.1, 4.4, t - 2.3, t + 0.01)]);
  const holes = xs.flatMap((x) => [-1, 1].map((s) => g.place(screw, T(x + (s * d.colW) / 4, 0, 0))));
  return g.union([g.cut(bar, holes), ...xs.map((x) => g.place(stud, T(x, 0, 0)))]);
}

export const hiveWall: FixtureDef = {
  id: 'hive-wall',
  code: 'M1',
  name: 'Hive wall',
  family: 'modular',
  tagline: 'Hex pixel tiles filling any outline, trimmed at the edges, hung on cleat rails.',
  description:
    'A wall of Hive tiles laid on a hex lattice over a drawn outline. Whole tiles print as one set ×N; tiles that cross the outline or a window are clipped exactly and get a closing wall along the cut. Seams carry magnets and printed bowtie keys; tiles hang on printed cleat rails through their keyholes.',
  params: HW_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    const L = layoutWall(design, params);
    const d = L.dims;
    const warnings = [...L.warnings];
    if (!L.tiles.length) return { parts: [], pixels: [], schedule: [], hardware: [], warnings };

    const n = planeNormal(design.plane);
    const latM = mul(planeFrame(design.plane), T(design.lattice.offset[0], design.lattice.offset[1], 0), Rz(design.lattice.rot));
    const at = (s: HwSlot, z: number): Mat4 => mul(latM, T(s.center[0], s.center[1], d.zBack + z));
    const ex = (k: number): Vec3 => scale(n, k);

    const tile = hiveTileSolids(g, {
      rings: d.rings,
      pitch: d.pitch,
      baffle: d.zDiff - d.zBaffle,
      wiring: d.zLedge - d.floorT,
      diffuser: d.Hs - d.zDiff,
      wall: d.wall,
      magnets: d.magnets,
      bowties: d.bowties,
      tol: d.tol,
      pixel: d.pixel,
      keyholeY: [-d.keyY, d.keyY],
      label: null,
    });
    const { A, Ai, Al, zLedge, zBaffle, zDiff, Hs, carrierT, wall, size } = d;
    const parts: PartSpec<Manifold>[] = [];

    /* ---------- Whole tiles: one set of layers ×N ---------- */
    const whole = L.tiles.filter((t) => t.kind === 'full');
    if (whole.length) {
      const shell = tile.shell.subtract(hiveLabel(g, `M1 ${d.cells.length}`, 0, -A * 0.18));
      parts.push(
        { id: 'shell', name: `Back shell ${size}`, role: 'body', solid: shell, instances: whole.map((t) => at(t.slot, 0)), explode: ex(-1), note: 'Print back down. Magnets and wire notches on all six edges.' },
        { id: 'carrier', name: `Pixel carrier ${size}`, role: 'body', solid: tile.carrier, instances: whole.map((t) => at(t.slot, zLedge)), explode: ex(0.6) },
        { id: 'baffle', name: `Honeycomb baffle ${size}`, role: 'baffle', solid: tile.baffle, instances: whole.map((t) => at(t.slot, zBaffle)), explode: ex(1.4) },
        { id: 'diffuser', name: `Opal diffuser ${size}`, role: 'diffuser', solid: tile.diffuser, instances: whole.map((t) => at(t.slot, zDiff)), explode: ex(2.4) },
      );
    }

    /* ---------- Trimmed edge tiles: clipped exactly, closing wall along the cut ---------- */
    for (const pc of L.pieces) {
      const s = L.bySlot.get(pc.slot)!;
      const units = L.tiles.filter((t) => t.piece === pc.id);
      // Clip region: the outline grown 1 mm past the shell on uncut edges, so no faces coincide.
      const cx = regionAt(g, design, s).intersect(g.hex(A + 1));
      const inset = (k: number) => cx.offset(-k, 'Miter', 2);
      const grown = cx.offset(0.5, 'Miter', 2);
      // Closing wall: a band `wall` wide inside the cut (with the carrier ledge below), kept off
      // the uncut edges, which already have their wall and joinery.
      const rimUp = grown.subtract(inset(wall)).intersect(g.hex(Ai + 0.5));
      const rimLow = grown.subtract(inset(wall + 2.5)).intersect(g.hex(Al + 0.5));
      const rim = g.union([g.extrude(rimUp, 0, Hs), g.extrude(rimLow, 0, zLedge)]);
      let shell = cleanM(g, g.union([tile.shell, rim]).intersect(g.extrude(cx, -1, Hs + 1)));
      if (pc.labelAt) shell = shell.subtract(hiveLabel(g, pc.id, pc.labelAt[0], pc.labelAt[1]));

      const inner = cleanCS(g, inset(wall + 0.3));
      const carrier = g.cut(
        g.extrude(cleanCS(g, inner.intersect(g.hex(Ai - 0.3))), 0, carrierT),
        s.cells.map(([x, y]) => g.place(tile.socket, T(x, y, carrierT))),
      );
      const baffle = g.extrude(cleanCS(g, tile.baffleCS.intersect(inner)), 0, zDiff - zBaffle);
      const diffuser = g.extrude(cleanCS(g, g.hex(Ai - 0.25).intersect(inset(wall + 0.25))), 0, Hs - zDiff);
      const lid = `${pc.id.toLowerCase()}`;
      const note = `Edge tile ${pc.id}: ${plural(pc.cells, 'cell')}, ${Math.round(pc.ratio * 100)} % of a tile. Closing wall along the cut.`;
      parts.push(
        { id: `${lid}-shell`, name: `Back shell ${pc.id}`, role: 'body', solid: shell, instances: units.map((t) => at(t.slot, 0)), explode: ex(-1), note },
        { id: `${lid}-carrier`, name: `Pixel carrier ${pc.id}`, role: 'body', solid: carrier, instances: units.map((t) => at(t.slot, zLedge)), explode: ex(0.6) },
        { id: `${lid}-baffle`, name: `Honeycomb baffle ${pc.id}`, role: 'baffle', solid: baffle, instances: units.map((t) => at(t.slot, zBaffle)), explode: ex(1.4) },
        { id: `${lid}-diffuser`, name: `Opal diffuser ${pc.id}`, role: 'diffuser', solid: diffuser, instances: units.map((t) => at(t.slot, zDiff)), explode: ex(2.4) },
      );
    }

    /* ---------- Bowtie keys, one per seam ---------- */
    if (d.bowties && L.seams.length) {
      parts.push({
        id: 'bowtie',
        name: 'Bowtie key',
        role: 'body',
        solid: tile.key,
        instances: L.seams.map((sm) => mul(at(L.bySlot.get(sm.a)!, 0), Rz(30 + 60 * sm.k), T(A + GAP / 2, 0, 0), Rz(90), T(0, 0, -0.01))),
        explode: ex(-1.6),
        note: 'One per seam, pressed into the back pockets. Key tiles into panels, then hang them.',
      });
    }

    /* ---------- Cleat rails ---------- */
    const studs = L.rails.reduce((k, r) => k + r.n, 0);
    for (const k of [...new Set(L.rails.map((r) => r.n))].sort((a, b) => a - b)) {
      const segs = L.rails.filter((r) => r.n === k);
      parts.push({
        id: `rail-${k}`,
        name: `Cleat rail, ${plural(k, 'stud')}`,
        role: 'body',
        solid: railSolid(g, d, k, segs[0].len),
        instances: segs.map((r) => mul(latM, T(r.x, r.y, 0))),
        explode: ex(-2.4),
        note: 'Screw to the wall level, studs out. Each tile drops 10 mm onto two studs.',
      });
    }

    /* ---------- Pixels and schedule, in data order ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    for (const t of L.tiles) {
      for (const c of t.cellsLat) {
        const p = fromPlane(fromLattice(design.lattice, c), design.plane);
        pixels.push({ pos: add(p, scale(n, d.zBack + Hs)), normal: n, unit: t.unit });
      }
      schedule.push({
        unit: t.unit,
        position: t.position,
        purpose: t.kind === 'full' ? `Hive ${size} tile` : `Hive ${size} tile, trimmed (${t.piece})`,
        pixelId: d.pixel.id,
        units: t.cells.length,
        px: t.cells.length,
        notes: `Strand enters ${t.enters}, serpentine by cell rows.${t.linked ? '' : ' Extension lead from the previous tile.'}`,
      });
    }

    /* ---------- Hardware ---------- */
    const breaks = L.tiles.filter((t, k) => k > 0 && !t.linked);
    const hardware: HardwareLine[] = [];
    if (d.magnets && L.seams.length) hardware.push({ item: '6×3 mm disc magnet', qty: 4 * L.seams.length, note: `Two each side of ${plural(L.seams.length, 'seam')}. Left pocket N-out, right pocket S-out on every edge.` });
    hardware.push({ item: 'JST-SM 3-pin pigtail pair', qty: L.tiles.length, note: 'One per tile: data/power in and out through the edge notches' });
    if (breaks.length) hardware.push({ item: 'JST-SM extension lead', qty: breaks.length, note: `Longest jump ${Math.round(Math.max(...breaks.map((t) => t.jumpIn)))} mm (${breaks.map((t) => t.unit).join(', ')})` });
    if (d.rail) hardware.push({ item: 'Countersunk wood screw 4 × 30 + wall plug', qty: 2 * studs, note: `Two per rail stud (${plural(L.rails.length, 'rail segment')})` });
    else {
      const holes = L.tiles.reduce((k, t) => k + t.slot.keyholes.filter(Boolean).length, 0);
      hardware.push({ item: 'Pan-head screw #6 / M3.5 + wall plug', qty: holes, note: 'Keyhole wall mount, two per tile; mark them off the layout' });
    }
    hardware.push({ item: 'Feed lead, controller to T01', qty: 1, note: `Into ${L.tiles[0].unit} (${L.tiles[0].position})` });

    // Air around the nodes: the inner hex (area 2√3·a²) times wiring space plus baffle depth, per tile.
    const tileArea = 2 * SQ3 * Ai * Ai;
    const enclosure = L.tiles.reduce((v, t) => v + (t.kind === 'full' ? 1 : t.slot.ratio) * tileArea * (zLedge - d.floorT + (zDiff - zBaffle)), 0) / 1000;
    return { parts, pixels, schedule, hardware, warnings, enclosureCm3: enclosure };
  },
};
