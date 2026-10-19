import { FIT_PARAMS, seatOf, sideOf } from '../fit';
import { Geo } from '../geom/geo';
import { apply, applyDir, mul, Rx, Rz, T } from '../geom/mat';
import { getPixel } from '../pixels/library';
import type { FixtureDef, Mat4, PartSpec, PixelPlacement } from '../types';
import type { Manifold } from 'manifold-3d';
import { bool, num, str } from './util';

/**
 * S1 Swatchbook: a gel swatchbook made of light.
 *
 * Translucent leaves stack on a hollow pivot post and fan open by hand. Each leaf carries one
 * pixel PCB in a cup on its back, LED facing the show face through an air gap. Fan it open
 * for a chase; close it and the leaves stack like gels, so colours mix through the layers.
 * Leaf numbers are engraved into the back and read as shadows when lit.
 */
export const swatchbook: FixtureDef = {
  id: 'swatchbook',
  code: 'S1',
  name: 'Swatchbook',
  family: 'single',
  tagline: 'A gel swatchbook made of light. Fan it to chase, close it to mix.',
  description:
    'Leaves pivot on a hollow post that carries the wiring down to an ESP32 in the base. Every part fits a 180 mm bed. Print the leaves in natural PETG, face down on a textured plate.',
  params: [
    { key: 'pixel', label: 'Pixel', type: 'pixel', default: 'pcb-9-ws2812b', pixels: ['pcb-9-ws2812b', 'pcb-9-sk6812-rgbw'], group: 'Pixels' },
    { key: 'leaves', label: 'Leaves', type: 'number', default: 12, min: 4, max: 16, step: 1, group: 'Shape' },
    { key: 'length', label: 'Leaf length', type: 'number', default: 150, min: 90, max: 165, step: 5, unit: 'mm', group: 'Shape' },
    { key: 'width', label: 'Leaf width', type: 'number', default: 46, min: 32, max: 60, step: 1, unit: 'mm', group: 'Shape' },
    {
      key: 'plate',
      label: 'Leaf thickness',
      type: 'number',
      default: 2.4,
      min: 1.6,
      max: 4,
      step: 0.2,
      unit: 'mm',
      group: 'Shape',
      help: 'Show face diffusion. 2.4 mm natural PETG hides the LED die at the default air gap.',
    },
    { key: 'numbers', label: 'Engrave leaf numbers', type: 'boolean', default: true, group: 'Shape' },
    { key: 'fan', label: 'Fan angle (view)', type: 'number', default: 150, min: 0, max: 200, step: 5, unit: '°', group: 'View' },
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const pixel = getPixel(str(params, 'pixel'));
    const n = num(params, 'leaves');
    const L = num(params, 'length');
    const W = num(params, 'width');
    const t = num(params, 'plate');
    const tol = seatOf(params);
    const side = sideOf(params);
    const fan = num(params, 'fan');
    const pcbR = (pixel.shape.kind === 'round' ? pixel.shape.d : 9.5) / 2;

    const postR = 6;
    const holeR = postR + side; // leaves turn on the post
    const hubR = postR + 5;
    const airGap = 1.0;
    const cupH = airGap + pixel.shape.depth + 0.2;
    const pitch = t + cupH;
    const xp = L - 22;
    const cupR = pcbR + tol + 1.6;
    const warnings: string[] = [];

    /* Leaf, in print orientation: show face on the bed (z=0), cup and ribs on top. */
    const leafBody = (index: number): Manifold => {
      const outline = g.CS.union([g.roundRect(L + hubR, W, 8, (L - hubR) / 2, 0), g.circle(hubR)]);
      const plate = g.extrude(outline, 0, t);
      const spacer = g.cylZ(hubR, t, t + cupH);
      const cup = g.cylZ(cupR, t, t + cupH, xp);
      const ribs = [-2.4, 2.4].map((y) => g.box([hubR + 1, y - 0.6, t], [xp - cupR + 0.5, y + 0.6, t + 1.8]));
      let leaf = g.union([plate, spacer, cup, ...ribs]);
      // PCB seat: rests on a ledge so the LED sits airGap above the plate.
      const seat = g.cylZ(pcbR + tol, t + airGap, t + cupH + 1, xp);
      const gap = g.cylZ(pcbR - 1.2, t, t + airGap + 0.01, xp);
      const pivot = g.cylZ(holeR, -1, t + cupH + 1);
      const cutters: Manifold[] = [seat, gap, pivot];
      if (bool(params, 'numbers')) {
        // Mirrored so it reads correctly from the show face.
        const label = g.text(String(index + 1).padStart(2, '0'), 7, 0.9).mirror([0, 1]).translate([xp - cupR - 12, W / 4]);
        cutters.push(g.extrude(label, t - 0.6, t + 0.5));
      }
      return g.cut(leaf, cutters);
    };

    /* Base: offset disc so the fanned leaves' weight stays over it, integral hollow post. */
    const baseR = 42;
    const baseX = 12;
    const baseH = 14;
    const postTop = baseH + n * pitch + 7.5;
    const cav = { x0: -17, x1: 9, y: 12, h: 9 };
    let base = g.union([g.cylZ(baseR, 0, baseH, baseX, 0), g.cylZ(postR, baseH - 1, postTop)]);
    base = g.cut(base, [
      g.box([cav.x0, -cav.y, -1], [cav.x1, cav.y, cav.h]), // ESP32-C3 SuperMini bay
      g.box([cav.x0 - 2, -cav.y - 2, -1], [cav.x1 + 2, cav.y + 2, 1.6]), // lid recess
      g.box([-baseR - 20, -5, 1.6], [cav.x0 + 1, 5, 7]), // USB-C
      g.cylZ(3.5, cav.h - 1, postTop + 1), // wire bore
      g.box([0, -1.5, baseH + 2], [postR + 1, 1.5, postTop - 9]), // wire slot
    ]);
    // Lid: the recess less the fit gap each way, flush with the underside.
    const lid = g.extrude(g.roundRect(cav.x1 - cav.x0 + 4 - 2 * side, cav.y * 2 + 4 - 2 * side, 1.5), 0, 1.6);

    /* Cap: slides over the post top and clamps the stack; M3 set screw into a heat-set insert. */
    const capR = 11;
    const postIn = postTop - (baseH + n * pitch); // how far the post reaches into the cap
    let cap = g.coneZ(capR, capR - 1.5, 0, 12);
    cap = g.cut(cap, [g.cylZ(postR + side, -1, postIn + side), g.cylX(2.0, 0, capR + 1, 0, 4.5)]);

    const parts: PartSpec<Manifold>[] = [
      { id: 'base', name: 'Base + post', role: 'body', solid: base, instances: [T(0, 0, 0)], explode: [0, 0, -1] },
      { id: 'lid', name: 'Base lid', role: 'body', solid: lid, instances: [T((cav.x0 + cav.x1) / 2, 0, 0)], explode: [0, 0, -1.6] },
      { id: 'cap', name: 'Post cap', role: 'body', solid: cap, instances: [T(0, 0, baseH + n * pitch)], explode: [0, 0, 1.4] },
    ];

    const pixels: PixelPlacement[] = [];
    const step = n > 1 ? fan / (n - 1) : 0;
    const leafMat = (k: number): Mat4 => mul(T(0, 0, baseH + (k + 1) * pitch), Rz(-fan / 2 + k * step), Rx(180));
    const shared = !bool(params, 'numbers') ? leafBody(0) : null;
    for (let k = 0; k < n; k++) {
      const m = leafMat(k);
      const leafPart = {
        name: shared ? 'Leaf' : `Leaf ${String(k + 1).padStart(2, '0')}`,
        role: 'diffuser' as const,
        explode: [0, 0, 0.6 + k * 0.15] as [number, number, number],
      };
      if (shared) {
        if (k === 0) parts.push({ id: 'leaf', ...leafPart, solid: shared, instances: [] });
        parts[parts.length - 1].instances.push(m);
      } else {
        parts.push({ id: `leaf-${k + 1}`, ...leafPart, solid: leafBody(k), instances: [m] });
      }
      pixels.push({ pos: apply(m, [xp, 0, 0]), normal: applyDir(m, [0, 0, -1]), unit: 'S1-A' });
    }

    const tipGap = n > 1 ? (L * step * Math.PI) / 180 : Infinity;
    if (tipGap < W) {
      warnings.push(
        `At ${fan}° the leaf tips overlap by ${(W - tipGap).toFixed(0)} mm, so light layers through the leaves above like stacked gels.`,
      );
    }

    const leafIds = shared ? ['leaf'] : Array.from({ length: n }, (_, k) => `leaf-${k + 1}`);
    return {
      parts,
      pixels,
      assembly: [
        { title: 'Fit the controller', parts: ['base'], hardware: 'ESP32-C3 SuperMini', note: 'Into the bay, USB-C to the side port. Lead up the post bore.' },
        { title: 'Close the base', parts: ['lid', 'base'], hardware: 'CA glue, 3 rubber feet', note: 'Lid into the recess, flush. Feet on.' },
        { title: 'Seat the pixels', parts: leafIds, hardware: `${n} × ${pixel.name}`, note: 'One PCB per leaf cup, LED down onto the ledge.' },
        { title: 'Stack the leaves', parts: leafIds, hardware: '28 AWG ribbon', note: `Leaf 01 first, onto the post. Wire leaf to leaf down the post slot.` },
        { title: 'Cap the post', parts: ['cap'], hardware: 'M3 heat-set insert, M3×6 set screw', note: 'Insert in the cap side. Cap over the post top, snug on the stack, then lock.' },
      ],
      schedule: [
        {
          unit: 'S1-A',
          position: `Leaves 1–${n}`,
          purpose: 'Swatch glow · fan chase',
          pixelId: pixel.id,
          units: n,
          px: n,
          notes: `One PCB per leaf, LED down through a ${airGap} mm air gap. Wire leaf to leaf down the post slot.`,
        },
      ],
      hardware: [
        { item: 'ESP32-C3 SuperMini (WLED)', qty: 1, note: 'Sits in the base bay; USB-C powers it and the leaves.' },
        { item: '3-core 28 AWG ribbon', qty: Math.ceil((n * (xp * 2 + pitch * 2)) / 100) / 10, note: 'metres, leaf to leaf' },
        { item: 'M3 heat-set insert', qty: 1, note: 'Cap side' },
        { item: 'M3×6 set screw', qty: 1, note: 'Locks the cap' },
        { item: 'Rubber feet', qty: 3 },
      ],
      warnings,
    };
  },
};
