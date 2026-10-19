import type { CrossSection, Manifold } from 'manifold-3d';
import { FIT_PARAMS, seatOf, sideOf } from '../../fit';
import type { P2 } from '../../geom/geo';
import { Geo } from '../../geom/geo';
import { Rx, T } from '../../geom/mat';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, PartSpec, PixelPlacement, ScheduleLine } from '../../types';
import { decodeImage, imageFrom, type GrayImage } from '../image';
import { layFlat, num, str } from '../util';
import { blurField, dropCrumbs, edgeDist, fieldFromImage, inside, isoRegion, loopsOf, shortPath, spreadPoints, type Field } from './common';

const gauss = (u: number, v: number, cu: number, cv: number, s: number) => Math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / (2 * s * s));

/** Built-in terrains (u, v in 0–1, v down the image), used when no heightmap is given. */
export const CONTOUR_PRESETS: Record<string, () => GrayImage> = {
  peak: () =>
    imageFrom(96, 96, (u, v) => {
      const h =
        gauss(u, v, 0.46, 0.52, 0.2) +
        0.45 * gauss(u, v, 0.72, 0.32, 0.11) +
        0.3 * gauss(u, v, 0.28, 0.74, 0.1) +
        0.05 * Math.sin(u * 17 + v * 5) * Math.sin(v * 13 - u * 4);
      return h / 1.25;
    }),
  twin: () =>
    imageFrom(96, 96, (u, v) => {
      const h = gauss(u, v, 0.32, 0.4, 0.15) + 0.85 * gauss(u, v, 0.68, 0.62, 0.15) + 0.04 * Math.sin(u * 19) * Math.cos(v * 15);
      return h / 1.1;
    }),
  caldera: () =>
    imageFrom(96, 96, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5);
      const a = Math.atan2(v - 0.5, u - 0.5);
      const rim = Math.exp(-((r - 0.2 - 0.02 * Math.sin(a * 3)) ** 2) / (2 * 0.075 ** 2));
      return 0.9 * rim + 0.25 * Math.exp(-(r * r) / (2 * 0.3 ** 2)) - 0.1 * gauss(u, v, 0.5, 0.5, 0.06);
    }),
};

/**
 * S8 Contour: a heightmap cut into stacked topo bands, each one a lit zone.
 *
 * Every band is a hollow translucent tray: a 2 mm top plate (the glowing terrace) on a wall
 * that follows its contour. Trays nest, each standing on the plate below. A band's nodes push
 * up through the plate below it, so their heads light the band's own cavity and their bodies
 * hang down through clearance holes into the hollow base. Chase the bands bottom to top for
 * "rising water".
 *
 * Fit: each tray's wall foot drops into a shallow locating groove in the plate below, the wall
 * plus the fit gap wide, so the stack registers itself. Nodes take the seat clearance.
 */
export const contour: FixtureDef = {
  id: 'contour',
  code: 'S8',
  name: 'Contour',
  family: 'single',
  tagline: 'A heightmap as stacked topo bands, each one its own zone. Rising water.',
  description:
    'Upload a heightmap (white is high) or pick a built-in terrain. The app cuts it into 6–10 contour bands, each a hollow tray printed in natural PETG with its terrace face on the plate. Nodes push up through the band below, so each band glows as its own zone. Node count per band follows its visible area, 2 to 6 each.',
  params: [
    { key: 'image', label: 'Heightmap', type: 'image', default: '', group: 'Terrain', help: 'Grayscale, white = high. Centre-cropped to a square. Blurred a little so contours stay printable.' },
    {
      key: 'preset',
      label: 'Built-in terrain',
      type: 'select',
      default: 'peak',
      options: [
        { value: 'peak', label: 'Peak with shoulders' },
        { value: 'twin', label: 'Twin peaks' },
        { value: 'caldera', label: 'Caldera' },
      ],
      group: 'Terrain',
      help: 'Used when no heightmap is loaded.',
    },
    { key: 'bands', label: 'Bands', type: 'number', default: 8, min: 6, max: 10, step: 1, group: 'Shape' },
    { key: 'size', label: 'Footprint', type: 'number', default: 160, min: 120, max: 170, step: 5, unit: 'mm', group: 'Shape' },
    { key: 'bandH', label: 'Band height', type: 'number', default: 14, min: 12, max: 20, step: 1, unit: 'mm', group: 'Shape', help: 'Each band is a hollow tray this tall. The node head needs about 12 mm.' },
    { key: 'target', label: 'Node budget', type: 'number', default: 32, min: 16, max: 48, step: 1, group: 'Pixels', help: 'Shared out by visible band area, 2 to 6 per band.' },
    { key: 'pixel', label: 'Node', type: 'pixel', default: 'node-12-bullet', pixels: ['node-12-bullet', 'node-12-bullet-12v'], group: 'Pixels' },
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const pixel = getPixel(str(params, 'pixel'));
    const nBands = num(params, 'bands');
    const S = num(params, 'size');
    const hb = num(params, 'bandH');
    const target = num(params, 'target');
    const tol = seatOf(params);
    const side = sideOf(params);
    const nodeR = (pixel.shape.kind === 'round' ? pixel.shape.d : 12) / 2;
    const bodyL = pixel.shape.depth;
    const warnings: string[] = [];

    /* ---------- Field ---------- */
    const userImg = decodeImage(str(params, 'image'));
    const img = userImg ?? (CONTOUR_PRESETS[str(params, 'preset')] ?? CONTOUR_PRESETS.peak)();
    const N = 80;
    let fd: Field = fieldFromImage(img, N, N);
    fd = blurField(fd, userImg ? 2 : 1, 2);
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of fd.v) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (hi - lo < 0.05) {
      warnings.push('The heightmap is almost flat, so the built-in peak is used instead.');
      fd = blurField(fieldFromImage(CONTOUR_PRESETS.peak(), N, N), 1, 2);
      lo = Math.min(...fd.v);
      hi = Math.max(...fd.v);
    }

    /* ---------- Bands ---------- */
    const wall = 1.6;
    const tp = 2;
    const step = 2.5; // smallest terrace, so each tray's wall lands on the plate below
    const footprint = g.rect(S, S);
    const regions: CrossSection[] = [];
    for (let k = 0; k < nBands; k++) {
      const level = lo + (hi - lo) * (0.04 + (0.76 * k) / (nBands - 1));
      let r = isoRegion(g, fd, level, -S / 2, -S / 2, S, S).intersect(footprint);
      r = r.offset(-1, 'Round').offset(1, 'Round'); // no slivers thinner than 2 mm
      if (k > 0) r = r.intersect(regions[k - 1].offset(-step, 'Round'));
      r = dropCrumbs(g, r, 300);
      if (r.isEmpty()) break;
      regions.push(r);
    }
    const nb = regions.length;
    if (nb < nBands) warnings.push(`Only ${nb} of ${nBands} bands have room for a node; the summit is too small. Try fewer bands or a broader peak.`);

    const zBase = bodyL + 4;
    const zTop = (k: number) => zBase + (k + 1) * hb; // top of tray k's plate
    const zMount = (k: number) => zBase + k * hb; // plate the band's nodes push through

    /* ---------- Nodes per band, by visible area ---------- */
    const area = regions.map((r, k) => r.area() - (k + 1 < nb ? regions[k + 1].area() : 0));
    // Two each, then hand out the rest of the budget one at a time to the band with the most
    // visible area per node, capped at six.
    const want = area.map(() => 2);
    for (let left = target - 2 * nb; left > 0; left--) {
      let bi = -1;
      area.forEach((a, k) => {
        if (want[k] < 6 && (bi < 0 || a / want[k] > area[bi] / want[bi])) bi = k;
      });
      if (bi < 0) break;
      want[bi]++;
    }
    // Nodes hug the inside of their own contour, so the head sits just behind the visible
    // terrace and riser even where the terrace is narrower than the node.
    const inset = 8 + wall; // clearance-hole radius + wall: the hole never undercuts a wall foot
    const band = 7;
    const apart = 8 + nodeR + 2; // a push hole and a clearance hole never meet in one plate
    const placed: P2[] = [];
    const bandNodes: P2[][] = regions.map(() => []);
    // Summit first: it is the tightest, and the broad lower bands can always work around it.
    for (let k = nb - 1; k >= 0; k--) {
      const spread = k === nb - 1 ? apart : 26;
      const loops = loopsOf(regions[k]);
      const b = regions[k].bounds();
      const hug: P2[] = [];
      const deep: P2[] = [];
      for (let x = b.min[0]; x <= b.max[0]; x += 2.5) {
        for (let y = b.min[1]; y <= b.max[1]; y += 2.5) {
          const p: P2 = [x, y];
          if (!inside(loops, p)) continue;
          const d = edgeDist(loops, p);
          if (d < inset || placed.some((q) => Math.hypot(q[0] - x, q[1] - y) < apart)) continue;
          (d <= inset + band ? hug : deep).push(p);
        }
      }
      let pts = spreadPoints(hug, want[k], spread);
      if (pts.length < want[k]) pts = [...pts, ...spreadPoints(deep.filter((p) => pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= spread)), want[k] - pts.length, spread)];
      if (pts.length < 2) warnings.push(`Band ${k + 1} only has room for ${pts.length} node${pts.length === 1 ? '' : 's'}.`);
      bandNodes[k] = shortPath(pts);
      placed.push(...pts);
    }

    /* ---------- Holes each plate needs ---------- */
    // Plate index -1 is the base top. A node of band m pushes through plate m-1 and its body
    // passes every plate whose top it clears within its length.
    const holesFor = (plate: number): Manifold[] => {
      const out: Manifold[] = [];
      const zPlate = plate < 0 ? zBase : zTop(plate);
      bandNodes.forEach((nodes, m) => {
        for (const [x, y] of nodes) {
          if (m - 1 === plate) {
            out.push(g.place(socketCutter(g, pixel, { tol, over: 2 }), T(x, y, zPlate)));
            out.push(g.cylZ(2.5, zPlate - tp - 1, zPlate + 1, x + nodeR + 4, y)); // lead pass-through
          } else if (m - 1 > plate && zMount(m) - bodyL < zPlate) {
            out.push(g.cylZ(8, zPlate - tp - 1, zPlate + 1, x, y));
          }
        }
      });
      return out;
    };

    // Locating groove for tray k in the plate it stands on: the wall footprint grown by half a gap
    // each side, as deep as the wall foot reaches below that plate's top.
    const lip = 0.8;
    const footGroove = (k: number): Manifold | null => {
      if (k >= nb) return null;
      const zPlate = k === 0 ? zBase : zTop(k - 1);
      const r = regions[k];
      return g.extrude(r.offset(side, 'Round').subtract(r.offset(-wall - side, 'Round')), zPlate - lip, zPlate + 1);
    };

    const parts: PartSpec<Manifold>[] = [];

    /* ---------- Base: hollow plinth, top plate printed on the bed ---------- */
    const B = S + 10;
    const baseAsm = g.cut(g.extrude(g.roundRect(B, B, 6), 0, zBase), [
      g.extrude(g.roundRect(B - 6, B - 6, 3), -1, zBase - 2.5),
      g.box([-B / 2 - 1, B / 2 - 12, -1], [-B / 2 + 4, B / 2 - 2, 8]), // cable exit, back-left
      ...holesFor(-1),
      footGroove(0),
    ]);
    const base = layFlat(g, baseAsm, Rx(180));
    parts.push({ id: 'base', name: 'Base', role: 'body', solid: base.solid, instances: [base.instance], explode: [0, 0, -1], note: 'Hollow. The ESP32 and node tails live inside.' });

    /* ---------- Trays ---------- */
    for (let k = 0; k < nb; k++) {
      const r = regions[k];
      const z0 = zTop(k) - hb;
      const trayAsm = g.cut(g.union([g.extrude(r, zTop(k) - tp, zTop(k)), g.extrude(r.subtract(r.offset(-wall, 'Round')), z0 - lip, zTop(k) - tp + 0.01)]), [...holesFor(k), footGroove(k + 1)]);
      const t = layFlat(g, trayAsm, Rx(180));
      parts.push({
        id: `band-${k + 1}`,
        name: `Band ${k + 1}`,
        role: 'diffuser',
        solid: t.solid,
        instances: [t.instance],
        explode: [0, 0, 0.4 + k * 0.35],
        note: k === 0 ? 'Terrace face on the plate. Natural PETG, 2 walls.' : undefined,
      });
    }

    /* ---------- Pixels + schedule ---------- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    bandNodes.forEach((nodes, k) => {
      const unit = `S8-${k + 1}`;
      for (const [x, y] of nodes) pixels.push({ pos: [x, y, zTop(k)], normal: [0, 0, 1], unit });
      if (!nodes.length) return;
      schedule.push({
        unit,
        position: `Band ${k + 1} of ${nb}${k === 0 ? ' (shore)' : k === nb - 1 ? ' (summit)' : ''}`,
        purpose: k === 0 ? 'Contour zone · rising water starts here' : 'Contour zone',
        pixelId: pixel.id,
        units: nodes.length,
        px: nodes.length,
        notes: `${Math.round(area[k] / 100)} cm² visible terrace. Push through band ${k === 0 ? 'base' : k} plate from below.`,
      });
    });

    const px = pixels.length;
    const bandIds = regions.map((_, k) => `band-${k + 1}`);
    return {
      parts,
      pixels,
      assembly: [
        { title: 'Fit the controller', parts: ['base'], hardware: 'ESP32 (WLED), 4 rubber feet', note: 'Inside the base, cable out the back-left.' },
        { title: 'Band 1 nodes', parts: ['base'], hardware: `${bandNodes[0]?.length ?? 0} × ${pixel.name}`, note: 'Push up through the base top from below.' },
        { title: 'Stack the bands', parts: bandIds, hardware: `${px} nodes in all`, note: 'Each band’s wall drops into the groove in the plate below. Push the next band’s nodes up through it before stacking on. Chain band to band through the lead holes.' },
      ],
      schedule,
      hardware: [
        { item: 'ESP32 (WLED)', qty: 1, note: `Inside the base. Map ${nb} segments, one per band.` },
        { item: '12 mm node strand', qty: Math.ceil(px / 50), note: `${px} nodes; chain band to band through the lead holes` },
        { item: 'Rubber feet', qty: 4 },
      ],
      warnings,
      enclosureCm3: regions.reduce((s, r) => s + (r.area() * (hb - tp)) / 1000, 0),
    };
  },
};
