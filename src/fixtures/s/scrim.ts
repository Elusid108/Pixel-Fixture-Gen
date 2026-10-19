import type { CrossSection, Manifold } from 'manifold-3d';
import { Geo, type P2 } from '../../geom/geo';
import { mul, Rx, Rz, T } from '../../geom/mat';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { layFlat, num, str } from '../util';
import { rng } from './common';

type Scene = 'forest' | 'skyline' | 'sea';

/**
 * Three silhouette layers for a scene, near to far, in panel coords: x across (±w/2), z up from
 * the bottom of the floor groove. Every layer is one connected piece (everything grows from a
 * ground band), so it prints and stands as a single cut-out.
 */
export function sceneLayers(g: Geo, scene: Scene, w: number, h: number): CrossSection[] {
  const r = rng(scene.length * 7 + 3);
  const L = -w / 2;
  const R = w / 2;
  const clip = g.rect(w, h, 0, h / 2);
  const band = (top: number) => g.rect(w, top, 0, top / 2);
  const tri = (x: number, base: number, z0: number, z1: number) => g.poly([[x - base / 2, z0], [x + base / 2, z0], [x, z1]]);
  const profile = (f: (x: number) => number): CrossSection => {
    const pts: P2[] = [[R, 0], [L, 0]];
    for (let x = L; x <= R + 0.01; x += 2) pts.push([Math.min(R, x), Math.min(h, f(x))]);
    return g.poly(pts);
  };
  const U = (list: CrossSection[]) => g.CS.union(list).intersect(clip);

  if (scene === 'forest') {
    const grass: CrossSection[] = [];
    for (let x = L + 2; x < R; x += 3.5) grass.push(tri(x, 4.5, 5, 9 + 5 * r()));
    const tree = (x0: number, s: number) => [
      g.poly([[x0 - 6 * s, 0], [x0 + 6 * s, 0], [x0 + 3 * s, 72], [x0 - 2 * s, 72]]),
      g.circle(17, x0 + 4 * s, 76),
      g.circle(14, x0 + 16 * s, 88),
      g.circle(15, x0 - 2 * s, 96),
      g.circle(10, x0 + 24 * s, 70),
      g.poly([[x0 + 10 * s, 78], [x0 + 46 * s, 92], [x0 + 46 * s, 95], [x0 + 10 * s, 84]]),
      g.circle(6, x0 + 44 * s, 93),
    ];
    const near = U([band(6), ...grass, ...tree(L + 8, 1), ...tree(R - 6, -1)]);
    const pines: CrossSection[] = [];
    for (let x = L + 4; x < R; x += 9 + 6 * r()) {
      const top = 34 + 34 * r();
      for (let t = 0; t < 3; t++) pines.push(tri(x, 20 - t * 4, 10 + t * (top - 10) * 0.28, top - (2 - t) * 4));
      pines.push(g.rect(2, 12, x, 12));
    }
    const mid = U([band(12), ...pines]);
    const ridge: CrossSection[] = [];
    const hill = (x: number) => 30 + 10 * Math.sin(x / 24 + 1) + 5 * Math.sin(x / 9.5);
    for (let x = L + 6; x < R; x += 7 + 5 * r()) ridge.push(tri(x, 5, hill(x) - 2, hill(x) + 6));
    const far = U([profile(hill), ...ridge]);
    return [near, mid, far];
  }

  if (scene === 'skyline') {
    const rail: CrossSection[] = [g.rect(w, 2.5, 0, 16)];
    for (let x = L + 3; x < R; x += 8) rail.push(g.rect(2, 12, x, 10));
    const lh = Math.min(84, h - 8); // lamp post height, kept under the lid
    const lamp = [
      g.rect(2.6, lh, L + 18, lh / 2),
      g.rect(14, 2, L + 24, lh - 1),
      g.poly([[L + 27, lh - 2], [L + 35, lh - 2], [L + 33, lh - 8], [L + 29, lh - 8]]),
      g.circle(3, L + 18, lh + 1),
    ];
    const near = U([band(5), ...rail, ...lamp]);
    const blocks: CrossSection[] = [band(10)];
    const windows: CrossSection[] = [];
    for (let x = L; x < R; ) {
      const bw = 14 + 10 * r();
      const top = 34 + 40 * r();
      blocks.push(g.rect(bw, top, x + bw / 2, top / 2));
      if (r() > 0.6) blocks.push(g.rect(2, 10, x + bw / 2, top + 5));
      for (let wz = 16; wz < top - 6; wz += 9) {
        for (let wx = x + 4; wx < x + bw - 4; wx += 6.5) if (r() > 0.35) windows.push(g.rect(3, 4.5, wx + 1.5, wz));
      }
      x += bw + 1;
    }
    const mid = U(blocks).subtract(g.CS.union(windows));
    const towers: CrossSection[] = [band(12)];
    for (let x = L + 6; x < R; x += 12 + 10 * r()) {
      const top = 46 + 40 * r();
      towers.push(g.rect(7 + 5 * r(), top, x, top / 2));
    }
    towers.push(g.circle(9, L + w * 0.62, 62), g.rect(18, 62, L + w * 0.62, 31), tri(L + w * 0.3, 6, 80, 100), g.rect(6, 82, L + w * 0.3, 41));
    const far = U(towers);
    return [near, mid, far];
  }

  // sea
  const swell = (a: number, f: number, p: number, base: number) => (x: number) => base + a * Math.sin(x / f + p) + (a / 3) * Math.sin(x / (f / 2.7) + 2 * p);
  const curls: CrossSection[] = [];
  for (let x = L + 14; x < R; x += 34) curls.push(g.circle(5, x + 4, swell(7, 12, 0, 18)(x) - 1));
  const near = U([profile(swell(7, 12, 0, 18)), ...curls]);
  const sx = L + w * 0.42;
  const ship = [
    g.poly([[sx - 30, 22], [sx + 30, 22], [sx + 24, 32], [sx - 26, 32]]),
    g.rect(2, 52, sx - 8, 56),
    g.rect(2, 44, sx + 12, 52),
    g.poly([[sx - 7, 36], [sx + 9, 38], [sx - 7, 78]]),
    g.poly([[sx + 13, 36], [sx + 27, 37], [sx + 13, 72]]),
    g.poly([[sx - 9, 36], [sx - 26, 38], [sx - 9, 66]]),
    g.poly([[sx - 7, 80], [sx + 3, 78], [sx - 7, 76]]),
  ];
  const mid = U([profile(swell(4, 9, 2, 24)), ...ship]);
  const lx = R - 26;
  const lighthouse = [
    g.poly([[lx - 7, 30], [lx + 7, 30], [lx + 4.5, 76], [lx - 4.5, 76]]),
    g.rect(12, 8, lx, 80),
    tri(lx, 14, 84, 92),
    g.circle(14, lx, 28),
  ];
  const lamp = g.rect(6, 4, lx, 80);
  const far = U([profile(swell(2.5, 7, 1, 32)), ...lighthouse]).subtract(lamp);
  return [near, mid, far];
}

/**
 * S4 Scrim Box: the scrim trick in a box.
 *
 * Box frame: x across, y depth (front opening at y=0, viewer on -Y), z up. A printed gauze
 * stands just behind the proscenium. A front-of-house strip under the teaser grazes its face;
 * three electrics on the grid light the silhouette layers from behind. Front light alone and
 * the gauze reads as a solid wall; bring up the electrics and it vanishes into the scene.
 */
export const scrim: FixtureDef = {
  id: 'scrim-box',
  code: 'S4',
  name: 'Scrim Box',
  family: 'single',
  tagline: 'Front-light it and the scrim goes opaque. Backlight it and the scene appears.',
  description:
    'A printed 0.4 mm-thread gauze stands in front of three silhouette layers. An 8-px FOH strip under the teaser grazes the gauze from the front, and three 4-px electrics on the lid light the layers from behind, so the classic scrim reveal plays at desk scale. Print the gauze in matte white with the mesh face on the plate, the layers in black, and the box in black so the house stays dark. Every part fits a 180 mm bed.',
  params: [
    {
      key: 'scene',
      label: 'Scene',
      type: 'select',
      default: 'forest',
      options: [
        { value: 'forest', label: 'Forest: wings, pines, hills' },
        { value: 'skyline', label: 'Skyline: lamp post, lit windows, towers' },
        { value: 'sea', label: 'Sea: swells, ship, lighthouse' },
      ],
      group: 'Scene',
    },
    { key: 'front', label: 'FOH strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: ['strip-60-ws2812b', 'strip-144-ws2812b'], group: 'Pixels' },
    { key: 'back', label: 'Electrics strip', type: 'pixel', default: 'strip-30-ws2812b', pixels: ['strip-30-ws2812b', 'strip-60-ws2812b'], group: 'Pixels' },
    { key: 'width', label: 'Opening width', type: 'number', default: 150, min: 110, max: 160, step: 5, unit: 'mm', group: 'Box' },
    { key: 'height', label: 'Opening height', type: 'number', default: 105, min: 80, max: 140, step: 5, unit: 'mm', group: 'Box' },
    { key: 'spacing', label: 'Layer spacing', type: 'number', default: 16, min: 12, max: 24, step: 1, unit: 'mm', group: 'Box', help: 'More depth between layers means more parallax as you move.' },
    { key: 'mesh', label: 'Thread pitch', type: 'number', default: 1.6, min: 1.2, max: 2.4, step: 0.1, unit: 'mm', group: 'Scrim', help: 'Threads are 0.45 mm wide. A finer pitch is more opaque under front light.' },
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const scene = str(params, 'scene') as Scene;
    const fp = getPixel(str(params, 'front'));
    const bp = getPixel(str(params, 'back'));
    const W = num(params, 'width');
    const Hin = num(params, 'height');
    const sp = num(params, 'spacing');
    const mp = num(params, 'mesh');
    const warnings: string[] = [];

    /* ---------- Layout ---------- */
    const t = 3; // side walls and back
    const tf = 3; // floor
    const gd = 1.5; // groove depth
    const pt = 1.6; // panel thickness
    const gw = pt + 0.4;
    const Hs = tf + Hin; // top of walls
    const lt = 4.5; // lid
    const wedge = 12;
    const ys = 2.4 + wedge + 3.5; // scrim
    const yl = [1, 2, 3].map((k) => ys + k * sp); // near, mid, far layers
    const yc = yl[2] + sp; // cyc (back wall inner face)
    const elec = [(yl[0] + yl[1]) / 2, (yl[1] + yl[2]) / 2, (yl[2] + yc) / 2];
    const Wp = W + 2 * gd - 0.4; // panel width
    const Hp = Hin + gd - 0.3; // panel height
    const pitchOf = (p: typeof fp) => (p.shape.kind === 'strip' ? p.shape.pitch : 1000 / 60);
    const nF = Math.floor((0.9 * W) / pitchOf(fp));
    const nB = Math.floor((0.9 * W) / pitchOf(bp));

    /* ---------- Shell ---------- */
    const panelY = [ys, ...yl];
    const shellCuts: Manifold[] = [g.box([-W / 2, -1, tf], [W / 2, yc, Hs + 1])];
    for (const y of panelY) {
      shellCuts.push(g.box([-W / 2 - gd, y - gw / 2, tf - gd], [W / 2 + gd, y + gw / 2, Hs + 1]));
    }
    shellCuts.push(g.cylY(4, yc - 1, yc + t + 1, W / 2 - 12, tf + 8)); // cable, back-right
    const shell = g.cut(g.box([-W / 2 - t, 0, 0], [W / 2 + t, yc + t, Hs]), shellCuts);

    /* ---------- Lid: the grid, with the electrics and the FOH teaser ---------- */
    const sk = 4; // skirt over the walls
    const lo = W / 2 + t + 0.2;
    const lidCuts: Manifold[] = [];
    const runB = nB * pitchOf(bp);
    elec.forEach((y, k) => {
      lidCuts.push(g.place(socketCutter(g, bp, { tol: 0.25, length: runB + 6 }), mul(T(0, y, Hs), Rx(180))));
      const end = (k % 2 === 0 ? 1 : -1) * (runB / 2 + 1.5);
      for (const s of [-1, 1]) lidCuts.push(g.cylZ(2, Hs - 1, Hs + lt + 1, s * end, y)); // leads up to the jumpers
    });
    const runF = nF * pitchOf(fp);
    const wy = 2.4 + wedge / 2;
    const wz = Hs - wedge / 2;
    const Mf = mul(T(0, wy, wz), Rx(-135)); // FOH face frame: emit back and down at 45°
    lidCuts.push(g.place(socketCutter(g, fp, { tol: 0.25, length: runF + 6 }), Mf));
    lidCuts.push(g.cylZ(2, wz - 3, Hs + lt + 1, -(runF / 2 + 1.5), wy - 1.5));
    const lidPlate = g.box([-lo - 1.8, -0.01, Hs - sk], [lo + 1.8, yc + t + 2, Hs + lt]).subtract(g.box([-lo, -1, Hs - sk - 1], [lo, yc + t + 0.2, Hs]));
    const lidAsm = g.cut(
      g.union([
        lidPlate,
        g.box([-W / 2, 0, Hs - wedge - 4], [W / 2, 2.4, Hs + 0.01]), // teaser
        g.place(g.extrude(g.poly([[2.4, Hs + 0.01], [2.4, Hs - wedge], [2.4 + wedge, Hs + 0.01]]), -W / 2, W / 2), mul(Rz(90), Rx(90))),
      ]),
      lidCuts,
    );
    const lid = layFlat(g, lidAsm, Rx(180));

    /* ---------- Scrim: frame + two-layer thread mesh, printed mesh face down ---------- */
    const fw = 6;
    const ow = Wp - 2 * fw;
    const oh = Hp - 2 * fw - gd;
    const tw = 0.45;
    const nx = Math.floor(ow / mp);
    const nz = Math.floor(oh / mp);
    const warp: CrossSection[] = Array.from({ length: nx }, (_, i) => g.rect(tw, oh + 2, -ow / 2 + (i + 0.5) * (ow / nx), 0));
    const weft: CrossSection[] = Array.from({ length: nz }, (_, j) => g.rect(ow + 2, tw, 0, -oh / 2 + (j + 0.5) * (oh / nz)));
    const frame = g.extrude(g.rect(Wp, Hp, 0, Hp / 2).subtract(g.rect(ow, oh, 0, gd + fw + oh / 2)), 0, pt);
    const mesh = g.union([g.extrude(g.CS.union(weft), 0, 0.42), g.extrude(g.CS.union(warp), 0.38, 0.8)]).translate([0, gd + fw + oh / 2, 0]);
    const gauze = g.union([frame, mesh]);

    /* ---------- Layers ---------- */
    const layers = sceneLayers(g, scene, Wp, Hp);
    const panelAt = (y: number) => mul(T(0, y + pt / 2, tf - gd), Rx(90));

    const parts: PartSpec<Manifold>[] = [
      { id: 'shell', name: 'Box', role: 'body', solid: shell, instances: [T(0, 0, 0)], explode: [0, 0, -0.6], note: 'Black. Floor down, open top.' },
      { id: 'lid', name: 'Grid lid (3 electrics + FOH)', role: 'body', solid: lid.solid, instances: [lid.instance], explode: [0, 0, 1.6], note: 'Prints upside down: strip channels face up.' },
      {
        id: 'scrim',
        name: 'Scrim (gauze)',
        role: 'diffuser',
        solid: gauze,
        instances: [panelAt(ys)],
        explode: [0, -1.4, 0.4],
        note: `Matte white, mesh face on a smooth plate, 0.2 mm layers. ${nx}×${nz} threads.`,
      },
    ];
    const names = ['Near', 'Mid', 'Far'];
    layers.forEach((cs, k) => {
      parts.push({
        id: `layer-${k + 1}`,
        name: `${names[k]} layer`,
        role: 'baffle',
        solid: g.extrude(cs, 0, pt),
        instances: [panelAt(yl[k])],
        explode: [0, -0.4 + k * 0.3, 0.7 + k * 0.3],
        note: k === 0 ? 'Black. Silhouettes read against the light behind them.' : undefined,
      });
    });

    /* ---------- Pixels in data order: FOH, then electrics near to far (snaking) ---------- */
    const pixels: PixelPlacement[] = [];
    const s2 = Math.SQRT1_2;
    for (let i = 0; i < nF; i++) pixels.push({ pos: [-runF / 2 + (i + 0.5) * pitchOf(fp), wy, wz], normal: [0, s2, -s2], unit: 'S4-F' });
    elec.forEach((y, k) => {
      for (let i = 0; i < nB; i++) {
        const x = -runB / 2 + (i + 0.5) * pitchOf(bp);
        pixels.push({ pos: [k % 2 === 0 ? x : -x, y, Hs] as Vec3, normal: [0, 0, -1], unit: `S4-B${k + 1}` });
      }
    });

    const schedule: ScheduleLine[] = [
      { unit: 'S4-F', position: 'FOH, under the teaser', purpose: 'Front light · makes the scrim opaque', pixelId: fp.id, units: Math.round(runF), px: nF, notes: 'Grazes the gauze at 45°. Data in, left to right.' },
      ...elec.map((_, k) => ({
        unit: `S4-B${k + 1}`,
        position: ['1st electric, behind near layer', '2nd electric, behind mid layer', 'Cyc electric, behind far layer'][k],
        purpose: ['Backlight · reveals the near layer', 'Backlight · reveals the mid layer', 'Cyc wash · sky'][k],
        pixelId: bp.id,
        units: Math.round(runB),
        px: nB,
        notes: k % 2 === 0 ? 'Left to right' : 'Right to left (snake)',
      })),
    ];
    if (mp / tw < 2.6) warnings.push('At this pitch the gauze is mostly thread. It will hide the scene even when backlit.');
    if (mp / tw > 4.6) warnings.push('At this pitch the gauze is very open. Front light will not fully hide the scene.');

    return {
      parts,
      pixels,
      schedule,
      hardware: [
        { item: 'WLED controller (ESP32)', qty: 1, note: 'On the lid or behind the box; cable through the back wall' },
        { item: 'Hook-up wire, 3-core', qty: 0.5, note: 'metres, jumpers between runs over the lid' },
      ],
      warnings,
      enclosureCm3: (W * Hin * (yc - ys)) / 1000,
    };
  },
};
