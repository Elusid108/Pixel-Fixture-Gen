import { Geo } from '../geom/geo';
import { T } from '../geom/mat';
import { getPixel, PIXELS } from '../pixels/library';
import { socketCutter } from '../pixels/sockets';
import type { FixtureDef } from '../types';
import { num, str } from './util';

/**
 * T0: print this first. Three copies of the chosen socket at stepped clearances,
 * each engraved with its tolerance, so you dial in the fit before committing a full fixture.
 */
export const coupon: FixtureDef = {
  id: 'fit-coupon',
  code: 'T0',
  name: 'Socket fit coupon',
  family: 'utility',
  tagline: 'Print first. Three clearances, pick the one that grips.',
  description:
    'Prints the selected pixel socket at three clearances with the value engraved beside each. Press your pixel into all three, then set that clearance as the tolerance on the real fixture.',
  params: [
    { key: 'pixel', label: 'Pixel', type: 'pixel', default: 'node-12-bullet', pixels: PIXELS.map((p) => p.id) },
    { key: 'tol', label: 'Middle clearance', type: 'number', default: 0.15, min: 0, max: 0.6, step: 0.05, unit: 'mm' },
    { key: 'step', label: 'Step', type: 'number', default: 0.1, min: 0.05, max: 0.25, step: 0.05, unit: 'mm' },
    {
      key: 'plate',
      label: 'Node plate thickness',
      type: 'number',
      default: 2,
      min: 1.2,
      max: 4,
      step: 0.2,
      unit: 'mm',
      help: 'Bullet nodes grip 1.5–3 mm material. Ignored for pocket-style pixels.',
    },
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const pixel = getPixel(str(params, 'pixel'));
    const tol = num(params, 'tol');
    const step = num(params, 'step');
    const s = pixel.shape;
    const isNode = pixel.form === 'node';

    const footprint =
      s.kind === 'round' ? s.d : s.kind === 'ring' ? s.od : s.kind === 'strip' ? s.width + 6 : Math.max(s.w, s.l);
    const along = s.kind === 'strip' ? s.pitch * 2 : footprint;
    const cell = Math.max(along, footprint) + 10;
    const thick = isNode ? num(params, 'plate') : s.depth + 1.6;
    const labelH = 5;
    const w = cell * 3 + 6;
    const d = Math.max(footprint, s.kind === 'strip' ? s.width : 0) + labelH + 18;

    let plate = g.extrude(g.roundRect(w, d, 4), 0, thick);
    const tols = [tol - step, tol, tol + step].map((t) => Math.max(0, +t.toFixed(2)));
    tols.forEach((t, i) => {
      const x = (i - 1) * cell;
      const cy = labelH / 2 + 2;
      const cutter = socketCutter(g, pixel, { tol: t, over: 1, wire: thick + 1, length: along });
      const label = g.extrude(g.text(t.toFixed(2), labelH, 0.7).translate([x, -d / 2 + labelH / 2 + 3]), thick - 0.6, thick + 1);
      plate = g.cut(plate, [g.place(cutter, T(x, cy, thick)), label]);
    });

    return {
      parts: [{ id: 'coupon', name: `Fit coupon · ${pixel.name}`, role: 'body', solid: plate, instances: [T(0, 0, 0)] }],
      pixels: [],
      schedule: [],
      hardware: [],
      warnings: [],
    };
  },
};
