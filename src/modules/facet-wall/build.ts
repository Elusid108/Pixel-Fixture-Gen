import type { CrossSection, Manifold } from 'manifold-3d';
import { str } from '../../fixtures/util';
import { Geo, type P2 } from '../../geom/geo';
import { apply, mul, Rx, Rz, T } from '../../geom/mat';
import { basis, scale } from '../../geom/vec';
import { socketCutter } from '../../pixels/sockets';
import { planeNormal } from '../../sketch/geom';
import type { Vec2 } from '../../sketch/types';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine } from '../../types';
import { idsOf, mm, steps } from '../shared/assembly';
import { planeFrame } from '../shared/layout';
import { layoutFacets, SQ3, type FwLayout, type TileClass } from './layout';
import { parseDesign } from './model';
import { FW_PARAMS, type FwDims } from './params';

/*
 * Geometry constants, mm. Insets are measured from the grid line (the lattice edge) inward.
 */
/** Facet skirt corners are cut back this far from each grid vertex, so a wall-screw head fits there. */
const CORNER_CLEAR = 4.5;
/** Snap tab: inner face inset, thickness, width. The barb is `FwDims.barb`: the fit gap plus the snap. */
export const TAB_IN = 3.4;
export const TAB_T = 1.2;
export const TAB_W = 6;
/** Free cantilever length of the tab inside the facet, above its pad. */
const TAB_FREE = 5;
/** Magnet pads and pockets on each tile edge, at ±s/4. */
const MAG_R = 3.15;
const MAG_DEPTH = 3.4;
const MAG_Z = 7;
const PAD_IN = 4.4;
const PAD_H = 11.5;
const PAD_HALF = 5;
/** Wall-screw bosses. */
const BOSS_R = 4.5;
const SCREW_R = 1.7;
/** Wire notch at each tile-edge midpoint, cut down from the back. */
const NOTCH_HALF = 6;
const NOTCH_D = 10;

const fl = (p: Vec2): P2 => [p[0], -p[1]];
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** Frame on the bed at `mid`: local X runs `inward`, Y along the edge, Z up. */
const edgeMat = (mid: P2, inward: P2): Mat4 => basis([inward[0], inward[1], 0], [-inward[1], inward[0], 0], [0, 0, 1], [mid[0], mid[1], 0]);

/** Rectangle in an edge frame (d inward from the edge line, x along it), as bed points. */
const edgeRect = (mid: P2, inward: P2, d0: number, d1: number, x0: number, x1: number): P2[] => {
  const along: P2 = [-inward[1], inward[0]];
  const at = (d: number, x: number): P2 => [mid[0] + inward[0] * d + along[0] * x, mid[1] + inward[1] * d + along[1] * x];
  return [at(d0, x0), at(d1, x0), at(d1, x1), at(d0, x1)];
};

/**
 * One facet in print orientation: face down on the bed, skirt rising to the backer. The
 * canonical facet is an "up" triangle; printed mirrored in y (so it reads as pointing down here).
 * Skirt corners are cut back for the wall-screw heads; three snap tabs with barbs rise from pads
 * at the edge midpoints and clip through slots in the backer's face plate.
 */
function facetSolid(g: Geo, D: FwDims, H: number): Manifold {
  const s = D.side;
  const r = s / (2 * SQ3);
  const R = s / SQ3;
  const dirs: P2[] = [-90, 150, 30].map((deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]);
  const tri = (inset: number) => g.poly(dirs.map((u) => [u[0] * (R - 2 * inset), u[1] * (R - 2 * inset)] as P2));
  const anti = g.poly(dirs.map((u) => [-u[0] * 2 * (R - CORNER_CLEAR), -u[1] * 2 * (R - CORNER_CLEAR)] as P2));
  const outer = tri(D.facetGap).intersect(anti);
  const skirt = outer.subtract(outer.offset(-D.wall, 'Miter'));
  const padTop = Math.max(D.face + 1.5, H - TAB_FREE);
  const top = H + D.plate + 1.6;
  // The barb catches half a fit gap clear of the plate back.
  const zc = H + D.plate + D.half;
  const BARB = D.barb;

  const pads: P2[][] = [];
  const tabs: Manifold[] = [];
  const profile = g.poly([
    [TAB_IN + TAB_T, padTop - 0.01],
    [TAB_IN + TAB_T, top],
    [TAB_IN, top],
    [TAB_IN, zc + 1.25],
    [TAB_IN - BARB, zc + 0.2],
    [TAB_IN - BARB, zc],
    [TAB_IN, zc],
    [TAB_IN, padTop - 0.01],
  ]);
  const tab = g.extrude(profile, -TAB_W / 2, TAB_W / 2);
  for (const u of dirs) {
    // Edge opposite corner u: midpoint at -u·r, inward along +u.
    const mid: P2 = [-u[0] * r, -u[1] * r];
    pads.push(edgeRect(mid, u, D.facetGap + D.wall - 0.2, TAB_IN + TAB_T, -TAB_W / 2, TAB_W / 2));
    tabs.push(g.place(tab, basis([u[0], u[1], 0], [0, 0, 1], [u[1], -u[0], 0], [mid[0], mid[1], 0])));
  }
  return g.union([
    g.extrude(tri(D.facetGap), 0, D.face),
    g.extrude(skirt, 0, H),
    g.extrude(g.CS.union(pads.map((p) => g.poly(p))), 0, padTop),
    ...tabs,
  ]);
}

/**
 * One backer tile in print orientation: face plate on the bed (the side facets snap to), rim
 * and screw bosses rising to the wall. Node sockets at every facet centroid, three snap slots
 * per facet, magnet pads and pockets at ±s/4 and a wire notch at the middle of each outline
 * edge. All features follow from the patch shape, so patches that match under the grid's 60°
 * turns stay one part.
 */
function backerSolid(g: Geo, D: FwDims, cls: TileClass): Manifold {
  const s = D.side;
  // Bed coords are the canonical plane coords mirrored in y (the backer prints face down).
  const shape = g.CS.ofPolygons(cls.tris.map((t) => t.map(fl).reverse()));
  const outline = shape.offset(-D.tileGap, 'Miter');
  const rimRing = outline.subtract(outline.offset(-D.rim, 'Miter'));

  const slots: P2[][] = [];
  cls.tris.forEach((t, i) => {
    const c = fl(cls.centroids[i]);
    for (let k = 0; k < 3; k++) {
      const a = fl(t[k]);
      const b = fl(t[(k + 1) % 3]);
      const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const inward = unit([c[0] - mid[0], c[1] - mid[1]]);
      // Slot: the tab plus the fit gap (half each side), and room behind it for the barb to pass.
      const d0 = TAB_IN - D.half;
      slots.push(edgeRect(mid, inward, d0, d0 + TAB_T + D.barb + D.fit, -TAB_W / 2 - D.half, TAB_W / 2 + D.half));
    }
  });
  const screws = cls.screws.map(fl);
  const holes: CrossSection | null = screws.length ? g.CS.union(screws.map((p) => g.circle(SCREW_R, p[0], p[1]))) : null;
  let plate = outline.subtract(g.CS.union(slots.map((p) => g.poly(p))));
  if (holes) plate = plate.subtract(holes);

  const solids: Manifold[] = [g.extrude(plate, 0, D.plate), g.extrude(rimRing, 0, D.depth)];
  if (screws.length && holes) {
    const bosses = g.CS.union(screws.map((p) => g.circle(BOSS_R, p[0], p[1]))).intersect(outline).subtract(holes);
    solids.push(g.extrude(bosses, 0, D.depth));
  }

  const cutters: Manifold[] = [];
  const edges = cls.perimeter.map((e) => ({ mid: fl(e.mid), inward: [-e.n[0], e.n[1]] as P2 }));
  if (D.magnets) {
    const pads = edges.flatMap((e) => [-s / 4, s / 4].map((x) => g.poly(edgeRect(e.mid, e.inward, -1, PAD_IN, x - PAD_HALF, x + PAD_HALF))));
    solids.push(g.extrude(g.CS.union(pads).intersect(outline), 0, PAD_H));
    const pocket = g.union([g.cylX(MAG_R, -1, MAG_DEPTH, -s / 4, MAG_Z), g.cylX(MAG_R, -1, MAG_DEPTH, s / 4, MAG_Z)]);
    for (const e of edges) cutters.push(g.place(pocket, edgeMat(e.mid, e.inward)));
  }
  const notch = g.box([-1, -NOTCH_HALF, D.depth - NOTCH_D], [D.tileGap + D.rim + 0.8, NOTCH_HALF, D.depth + 1]);
  for (const e of edges) cutters.push(g.place(notch, edgeMat(e.mid, e.inward)));

  // Node sockets: emitter at the front face (z = 0 here) looking down through the bed side.
  const socket = g.place(socketCutter(g, D.pixel, { tol: D.tol }), Rx(180));
  for (const c of cls.centroids.map(fl)) cutters.push(g.place(socket, T(c[0], c[1], 0)));
  return g.cut(g.union(solids), cutters);
}

const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

export const facetWall: FixtureDef = {
  id: 'facet-wall',
  code: 'M5',
  name: 'Facet Wall',
  family: 'modular',
  tagline: 'Low-poly relief wall: translucent facets at three depths, one node each.',
  description:
    'Draw an outline on the bench and it fills with whole triangles. Each triangle is a snap-in translucent facet standing off the wall at one of three depths, set by a gradient or a picture, or by hand. Facets clip into triangular backer tiles sized to your printer; tiles screw to the wall and align on magnets. One node per facet, wired serpentine tile by tile.',
  params: FW_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    const L: FwLayout = layoutFacets(design, params);
    const D = L.dims;
    const warnings = [...L.warnings];
    if (!L.chain.length) {
      if (!warnings.length) warnings.push('Draw an outline on the bench (or load a preset) to fill it with facets.');
      return { parts: [], pixels: [], schedule: [], hardware: [], warnings };
    }
    const PF = planeFrame(design.plane);
    const n = planeNormal(design.plane);
    const parts: PartSpec<Manifold>[] = [];

    /* ---- Backer tiles: one part per patch shape ---- */
    const tileById = new Map(L.tiles.map((t) => [t.id, t]));
    for (const cls of L.classes) {
      const solid = g.place(backerSolid(g, D, cls), Rz(cls.printRot));
      const flip = mul(T(0, 0, D.depth), Rx(180), Rz(-cls.printRot));
      const members = cls.members.map((id) => tileById.get(id)!);
      parts.push({
        id: `backer-${cls.id}`,
        name: `Backer ${cls.id} · ${cls.tris.length} facet${cls.tris.length === 1 ? '' : 's'}${cls.full ? '' : cls.merged ? ' (edge, joined)' : ' (edge)'}`,
        role: 'body',
        solid,
        instances: members.map((t) => mul(PF, Rz(t.rotDeg), T(t.shift[0], t.shift[1], 0), flip)),
        explode: scale(n, -0.6),
        note: `Face plate down, no supports. Push the nodes in from the front, then screw to the wall through ${cls.screws.length} boss${cls.screws.length === 1 ? '' : 'es'}.${D.magnets ? ' Magnet pockets: the one ahead (counter-clockwise, seen from the front) takes N out, the other S out.' : ''}`,
      });
    }

    /* ---- Facets: one part per depth, up and down triangles are the same part turned ---- */
    for (const lv of [0, 1, 2] as const) {
      const fs = L.chain.filter((f) => f.level === lv);
      if (!fs.length) continue;
      const H = D.heights[lv];
      parts.push({
        id: `facet-d${lv + 1}`,
        name: `Facet D${lv + 1} · ${fmt(H)} mm stand-off`,
        role: 'diffuser',
        solid: facetSolid(g, D, H),
        instances: fs.map((f) => mul(PF, T(f.centroid[0], f.centroid[1], D.depth + H), Rz(f.up ? 0 : 180), Rx(180))),
        explode: scale(n, 1.2),
        note: `Translucent PETG or PLA, face down, ${fmt(D.face)} mm face. Snaps into the backer on three tabs: slots are the tab plus ${mm(D.fit)} mm, and each barb catches ${mm(D.barb - D.half)} mm past the slot edge. Pry a tab from behind to remove.`,
      });
    }

    /* ---- Pixels and schedule, tile by tile in data order ---- */
    const pixels: PixelPlacement[] = L.chain.map((f) => ({ pos: apply(PF, [f.centroid[0], f.centroid[1], D.depth + D.heights[f.level]]), normal: n, unit: f.tile }));
    const gapInto = new Map(L.longGaps.map((x) => [x.to, x.mm]));
    const minJ = Math.min(...L.tiles.map((t) => t.J));
    const schedule: ScheduleLine[] = L.tiles.map((t, i) => {
      const entry = gapInto.get(t.facets[0]);
      const inner = t.facets.slice(1).filter((k) => gapInto.has(k)).length;
      const notes = [i === 0 ? 'Data in' : `From ${L.tiles[i - 1].id}`, entry ? `entry lead ${Math.round(entry)} mm: add an extension` : '', inner ? `${inner} long lead${inner === 1 ? '' : 's'} inside` : '']
        .filter(Boolean)
        .join(' · ');
      return {
        unit: t.id,
        position: `Tile row ${t.J - minJ + 1}`,
        purpose: `Backer ${t.cls} · D1 ${t.depths[0]} · D2 ${t.depths[1]} · D3 ${t.depths[2]}`,
        pixelId: D.pixel.id,
        units: t.facets.length,
        px: t.facets.length,
        notes,
      };
    });

    const hardware: HardwareLine[] = [];
    const screws = L.tiles.reduce((a, t) => a + t.screws, 0);
    if (screws) hardware.push({ item: `Pan-head screw M3 / #6 × ${Math.ceil((D.depth + 20) / 5) * 5} mm + wall plug`, qty: screws, note: 'Through the bosses, before the facets go on' });
    const magnets = L.tiles.reduce((a, t) => a + 2 * t.shared, 0);
    if (D.magnets && magnets) hardware.push({ item: '6×3 mm disc magnet', qty: magnets, note: 'Two per tile edge that meets another tile. Glue in.' });
    hardware.push({ item: 'JST-SM 3-pin pigtail pair', qty: L.tiles.length, note: 'One per tile, through the edge notches, so tiles unplug' });
    if (L.longGaps.length) hardware.push({ item: '3-core extension lead, 150 mm', qty: L.longGaps.length, note: `Where node-to-node runs exceed the ${D.lead} mm factory lead` });

    if (D.heights[0] < 12) warnings.push(`Shallow facets stand ${fmt(D.heights[0])} mm off the node; expect a visible hot spot. 12 mm or more diffuses evenly.`);

    // Air inside the facets around each node, for the thermal check.
    const triArea = (SQ3 / 4) * (D.side - 2 * SQ3 * (D.facetGap + D.wall)) ** 2;
    const enclosure = L.chain.reduce((v, f) => v + triArea * D.heights[f.level], 0) / 1000;

    const backers = idsOf(parts, 'backer-');
    const assembly = steps(parts, [
      {
        title: 'Load the backers',
        parts: backers,
        hardware: `${L.chain.length}× ${D.pixel.name}${D.magnets && magnets ? `, ${magnets}× 6×3 magnet` : ''}`,
        note: `Push a node into each socket from the front (${mm(D.tol)} mm seat clearance) and chain them in the order on the Data tab.${D.magnets ? ' Glue magnets in: the pocket ahead (counter-clockwise, seen from the front) N out, the other S out.' : ''}`,
      },
      {
        title: 'Screw the backers to the wall',
        parts: backers,
        hardware: screws ? `${screws}× pan-head screw + plug` : undefined,
        note: `Start at ${L.tiles[0].id} and let the magnets pull each tile into line, ${mm(D.fit)} mm from its neighbours. Plug the pigtails together through the edge notches as you go.`,
      },
      {
        title: 'Snap on the facets',
        parts: idsOf(parts, 'facet-'),
        note: 'Match each facet to its depth (D1 shallow to D3 deep, as on the bench) and press it straight on until all three tabs click.',
      },
    ]);
    return { parts, pixels, schedule, hardware, warnings, assembly, enclosureCm3: enclosure };
  },
};
