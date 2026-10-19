import type { Manifold } from 'manifold-3d';
import { Geo } from '../../geom/geo';
import { apply, applyDir, mul, Rx, T } from '../../geom/mat';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, Mat4, PartSpec, PixelPlacement } from '../../types';
import { decodeImage, imageFrom, type GrayImage } from '../image';
import { num, str } from '../util';
import { heightfield, smoothstep, squareSample } from './common';

/**
 * The built-in picture: an empty proscenium with the house curtain pulled back, a follow spot
 * cutting down to centre stage and one figure in the pool. Lots of mid-tones, so it shows off
 * the relief, and a relight story baked in (sunrise across the drapes, the spot snapping on).
 */
export const defaultLithoImage = (): GrayImage =>
  imageFrom(160, 160, (u, v) => {
    const x = u - 0.5;
    // Proscenium wall with a moulded border.
    const inOpening = Math.abs(x) < 0.4 && v > 0.1 && v < 0.86;
    if (!inOpening) {
      const border = Math.abs(x) < 0.44 && v > 0.06 && v < 0.9;
      return border ? 0.42 + 0.12 * Math.cos(v * 90) : 0.12 + 0.04 * Math.sin(u * 40) * Math.sin(v * 40);
    }
    // Swagged valance across the top.
    const swag = 0.18 + 0.035 * Math.abs(Math.sin(x * Math.PI * 5));
    if (v < swag) return 0.3 + 0.25 * Math.cos(x * 70) ** 2 * (1 - (v - 0.1) / 0.12);
    // House curtain, pulled back to the legs, velvet folds.
    const drape = 0.12 + 0.07 * (1 - (v - swag) / 0.7);
    if (0.4 - Math.abs(x) < drape) return 0.18 + 0.32 * Math.cos(Math.abs(x) * 110) ** 2;
    // Deck in perspective.
    const deck = v > 0.72;
    let lum = deck ? 0.22 + 0.06 * Math.cos((x / (v - 0.4)) * 60) : 0.06;
    // Follow spot: a cone from the booth (top centre) down to a pool on the deck.
    const pool = Math.hypot(x / 0.13, (v - 0.8) / 0.04);
    const coneHalf = 0.012 + 0.11 * Math.max(0, (v - 0.12) / 0.68);
    if (v < 0.8 && Math.abs(x) < coneHalf) lum = Math.max(lum, 0.32 + 0.25 * (1 - Math.abs(x) / coneHalf));
    if (deck) lum = Math.max(lum, 1 - 0.75 * smoothstep(0.75, 1.05, pool));
    // The performer, a silhouette standing in the pool.
    const head = Math.hypot(x / 0.022, (v - 0.6) / 0.026) < 1;
    const body = v > 0.625 && v < 0.79 && Math.abs(x) < 0.018 + 0.03 * ((v - 0.625) / 0.165);
    if (head || body) lum = 0.05;
    return lum;
  });

const GRIDS = {
  strip: { n: 6, pitch: 1000 / 30, pixel: 'strip-30-ws2812b' },
  nodes: { n: 8, pitch: 25, pixel: 'node-12-bullet' },
  'nodes-12v': { n: 8, pitch: 25, pixel: 'node-12-bullet-12v' },
} as const;

/**
 * S5 Litho Relight: a lithophane over a baffled pixel grid, so the photo can be relit.
 *
 * Panel-local frame: picture in XY, viewer on +Z, z=0 the back of the tray. Assembled, the
 * panel stands on its bottom edge facing -Y.
 */
export const litho: FixtureDef = {
  id: 'litho-relight',
  code: 'S5',
  name: 'Litho Relight',
  family: 'single',
  tagline: 'A lithophane over a baffled grid. Relight the photo: sunrise, candle, lightning.',
  description:
    'Your picture becomes a lithophane: dark areas print thick and bright areas thin, so it only reads when lit from behind. It sits on a baffled 6×6 grid of 30/m strip (or an 8×8 grid of 12 mm nodes), so every cell relights its own patch of the photo. Print the lithophane in white PLA or natural PETG with the smooth face on the plate. Without a picture it uses a built-in proscenium with a follow spot.',
  params: [
    { key: 'image', label: 'Picture', type: 'image', default: '', group: 'Picture', help: 'Any photo. It is centre-cropped to a square. Strong mid-tones read best.' },
    {
      key: 'grid',
      label: 'Pixel grid',
      type: 'select',
      default: 'strip',
      options: [
        { value: 'strip', label: '6×6 · 30/m strip, serpentine' },
        { value: 'nodes', label: '8×8 · 12 mm nodes' },
        { value: 'nodes-12v', label: '8×8 · 12 mm nodes (12 V)' },
      ],
      group: 'Pixels',
    },
    { key: 'thin', label: 'Brightest thickness', type: 'number', default: 0.8, min: 0.6, max: 1.4, step: 0.1, unit: 'mm', group: 'Lithophane' },
    { key: 'thick', label: 'Darkest thickness', type: 'number', default: 3.2, min: 2.4, max: 4, step: 0.1, unit: 'mm', group: 'Lithophane' },
    { key: 'detail', label: 'Mesh step', type: 'number', default: 0.8, min: 0.5, max: 1.5, step: 0.1, unit: 'mm', group: 'Lithophane', help: 'Finer is sharper but slower. The picture itself is stored at up to 256 px.' },
    { key: 'baffle', label: 'Baffle depth', type: 'number', default: 25, min: 15, max: 40, step: 1, unit: 'mm', group: 'Box', help: 'Deeper cells blend more evenly; shallower cells read as sharper squares.' },
    { key: 'tol', label: 'Node hole clearance', type: 'number', default: 0.1, min: 0, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit' },
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const grid = GRIDS[str(params, 'grid') as keyof typeof GRIDS] ?? GRIDS.strip;
    const pixel = getPixel(grid.pixel);
    const isStrip = pixel.form === 'strip';
    const n = grid.n;
    const pitch = grid.pitch;
    const G = n * pitch;
    const thin = num(params, 'thin');
    const thick = Math.max(num(params, 'thick'), thin + 0.8);
    const hb = num(params, 'baffle');
    const step = num(params, 'detail');
    const tol = num(params, 'tol');
    const warnings: string[] = [];

    const userImg = decodeImage(str(params, 'image'));
    const img = userImg ?? defaultLithoImage();

    /* ---------- Stack heights (panel-local) ---------- */
    const bw = 1.2; // baffle wall
    const wall = 3;
    const tf = isStrip ? pixel.shape.depth + 1.5 : 2.5;
    const inner = G + bw + 0.6;
    const outer = inner + 2 * wall;
    const zBaffle = tf;
    const zFront = tf + hb + thick;
    const Ls = inner - 0.4; // lithophane edge
    const win = G - 2; // bezel window = picture area

    /* ---------- Lithophane (print: show face on the bed, relief up) ---------- */
    const nx = Math.max(20, Math.round(Ls / step) + 1);
    const lith = heightfield(ctx, nx, nx, -Ls / 2, -Ls / 2, Ls, Ls, (i, j) => {
      const xp = -Ls / 2 + (Ls * i) / (nx - 1);
      const yp = -Ls / 2 + (Ls * j) / (nx - 1);
      if (Math.abs(xp) > win / 2 || Math.abs(yp) > win / 2) return thick;
      // Print y is panel -y (the part is flipped onto its face), so image rows run with +yp.
      const lum = squareSample(img, (xp + win / 2) / win, (yp + win / 2) / win);
      return thin + (thick - thin) * (1 - lum);
    });

    /* ---------- Baffle ---------- */
    const cells = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push(g.rect(pitch - bw, pitch - bw, (c - (n - 1) / 2) * pitch, (r - (n - 1) / 2) * pitch));
    const baffle = g.extrude(g.rect(G + bw, G + bw).subtract(g.CS.union(cells)), 0, hb);

    /* ---------- Tray ---------- */
    const cx = (c: number) => (c - (n - 1) / 2) * pitch;
    const trayCuts: Manifold[] = [g.box([-inner / 2, -inner / 2, tf], [inner / 2, inner / 2, zFront + 1])];
    if (isStrip) {
      for (let r = 0; r < n; r++) {
        trayCuts.push(g.place(socketCutter(g, pixel, { tol: 0.25, length: G + 6 }), T(0, cx(r), tf)));
      }
      // Jumper channels at alternate row ends (serpentine), under the baffle's outer wall.
      for (let r = 0; r < n - 1; r++) {
        const sx = r % 2 === 0 ? 1 : -1;
        const x = sx * (G / 2 + 2);
        trayCuts.push(g.box([x - 2, cx(r), tf - 2], [x + 2, cx(r + 1), tf + 0.1]));
      }
      for (const sx of [-1, 1]) trayCuts.push(g.keyhole(tf).translate([sx * G * 0.3, G * 0.32, 0]));
    } else {
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) trayCuts.push(g.place(socketCutter(g, pixel, { tol }), T(cx(c), cx(r), tf)));
    }
    // Cable entry, bottom-left corner (where row 1 starts).
    trayCuts.push(g.cylZ(3.5, -1, tf + 1, -G / 2 - 1.5, -G / 2 + 6));
    // Pilot holes for the bezel screws, two per side.
    const screwZ = zFront - 4;
    for (const s of [-1, 1]) {
      for (const k of [-0.3, 0.3]) {
        trayCuts.push(g.cylX(1.25, s > 0 ? outer / 2 - 6 : -outer / 2 - 1, s > 0 ? outer / 2 + 1 : -outer / 2 + 6, k * G, screwZ));
        trayCuts.push(g.cylY(1.25, s > 0 ? outer / 2 - 6 : -outer / 2 - 1, s > 0 ? outer / 2 + 1 : -outer / 2 + 6, k * G, screwZ));
      }
    }
    const tray = g.cut(g.box([-outer / 2, -outer / 2, 0], [outer / 2, outer / 2, zFront]), trayCuts);

    /* ---------- Bezel (print: face down, skirt up) ---------- */
    const bt = 2.4;
    const skirt = 8;
    const bo = outer + 2 * (0.2 + 2);
    const bezelCuts: Manifold[] = [
      g.box([-win / 2, -win / 2, -1], [win / 2, win / 2, bt + 1]),
      g.box([-outer / 2 - 0.2, -outer / 2 - 0.2, bt], [outer / 2 + 0.2, outer / 2 + 0.2, bt + skirt + 1]),
    ];
    const zs = bt + (zFront - screwZ);
    for (const s of [-1, 1]) {
      for (const k of [-0.3, 0.3]) {
        bezelCuts.push(g.cylX(1.7, s > 0 ? bo / 2 - 4 : -bo / 2 - 1, s > 0 ? bo / 2 + 1 : -bo / 2 + 4, k * G, zs));
        bezelCuts.push(g.cylY(1.7, s > 0 ? bo / 2 - 4 : -bo / 2 - 1, s > 0 ? bo / 2 + 1 : -bo / 2 + 4, k * G, zs));
      }
    }
    const bezel = g.cut(g.extrude(g.roundRect(bo, bo, 3), 0, bt + skirt), bezelCuts);

    /* ---------- Assembly: stand the panel on its bottom edge, facing -Y ---------- */
    const Mp: Mat4 = mul(T(0, 0, outer / 2), Rx(90), T(0, 0, -zFront / 2));
    const fwd = applyDir(Mp, [0, 0, 1]);
    const ex = (k: number): [number, number, number] => [fwd[0] * k, fwd[1] * k, fwd[2] * k];
    const parts: PartSpec<Manifold>[] = [
      { id: 'tray', name: 'Back tray', role: 'body', solid: tray, instances: [Mp], explode: ex(-0.6) },
      { id: 'baffle', name: `Baffle ${n}×${n}`, role: 'baffle', solid: baffle, instances: [mul(Mp, T(0, 0, zBaffle))], explode: ex(0.4), note: 'White keeps cells bright and soft; black gives crisp squares.' },
      {
        id: 'lithophane',
        name: 'Lithophane',
        role: 'diffuser',
        solid: lith,
        instances: [mul(Mp, T(0, 0, zFront), Rx(180))],
        explode: ex(1.4),
        note: `Smooth face on the plate, 100% infill, ${thin}–${thick} mm. White PLA or natural PETG.`,
      },
      { id: 'bezel', name: 'Front bezel', role: 'body', solid: bezel, instances: [mul(Mp, T(0, 0, zFront + bt), Rx(180))], explode: ex(2.4) },
    ];

    let backDepth = 0;
    if (!isStrip) {
      // Node bodies hang 28 mm behind the tray floor; a back box covers them and carries the keyholes.
      backDepth = pixel.shape.depth + 4;
      const bf = 3;
      const back = g.cut(g.box([-outer / 2, -outer / 2, 0], [outer / 2, outer / 2, backDepth]), [
        g.box([-outer / 2 + wall, -outer / 2 + wall, bf], [outer / 2 - wall, outer / 2 - wall, backDepth + 1]),
        g.keyhole(bf).translate([-G * 0.3, G * 0.32, 0]),
        g.keyhole(bf).translate([G * 0.3, G * 0.32, 0]),
        g.box([-G / 2, -outer / 2 - 1, bf + 4], [-G / 2 + 12, -outer / 2 + wall + 1, bf + 12]),
      ]);
      parts.push({ id: 'back', name: 'Back box', role: 'body', solid: back, instances: [mul(Mp, T(0, 0, -backDepth))], explode: ex(-1.4), note: 'Glue or screw to the tray. Hides the node bodies.' });
    }

    /* ---------- Pixels: serpentine from bottom-left, read at the picture face ---------- */
    const pixels: PixelPlacement[] = [];
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) {
        const c = r % 2 === 0 ? k : n - 1 - k;
        pixels.push({ pos: apply(Mp, [cx(c), cx(r), zFront]), normal: fwd, unit: 'S5-A' });
      }
    }

    const range = (() => {
      let lo = 1;
      let hi = 0;
      for (let k = 0; k < img.data.length; k++) {
        lo = Math.min(lo, img.data[k] / 255);
        hi = Math.max(hi, img.data[k] / 255);
      }
      return hi - lo;
    })();
    if (userImg && range < 0.35) warnings.push('The picture is low contrast, so the lithophane will look flat. Boost contrast before importing.');
    if (thick - thin < 1.6) warnings.push(`Only ${(thick - thin).toFixed(1)} mm between brightest and darkest. Expect a washed-out picture.`);

    const stripMm = Math.round(n * n * pitch);
    return {
      parts,
      pixels,
      schedule: [
        {
          unit: 'S5-A',
          position: `Grid ${n}×${n}, from bottom-left`,
          purpose: 'Relight · sunrise sweep, candle, lightning',
          pixelId: pixel.id,
          units: isStrip ? stripMm : n * n,
          px: n * n,
          notes: isStrip
            ? `${n} rows of ${n} px, serpentine. Jumper the row ends through the floor channels.`
            : `One node per cell, pushed through the tray floor from behind.`,
        },
      ],
      hardware: [
        { item: 'M3×8 self-tapping screw', qty: 8, note: 'Bezel skirt into the tray wall' },
        { item: 'WLED controller (ESP32)', qty: 1, note: 'Behind the panel or remote; cable enters bottom-left' },
        ...(isStrip ? [{ item: 'Hook-up wire, 3-core', qty: 0.1, note: 'metres, for the row-end jumpers' }] : []),
        { item: 'Screws for wall hanging', qty: 2, note: 'Keyholes, 4 mm shank' },
      ],
      warnings,
      enclosureCm3: (G * G * hb) / 1000,
    };
  },
};
