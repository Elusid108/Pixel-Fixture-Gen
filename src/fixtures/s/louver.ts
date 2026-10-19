import type { Manifold } from 'manifold-3d';
import { FIT_PARAMS, seatOf, sideOf } from '../../fit';
import { Geo, type P2 } from '../../geom/geo';
import { apply, applyDir, mul, Rx, Ry, Rz, T } from '../../geom/mat';
import { getPixel } from '../../pixels/library';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, PartSpec, PixelPlacement, Vec3 } from '../../types';
import { layFlat, num, str } from '../util';

/**
 * S6 Louver Sconce: Pixel Louver Lights grown into a wall sconce.
 *
 * Sconce frame: wall plane y=0, the fixture projects toward +y, z up. The assembly is turned
 * to face -Y. A vertical run of strip on the back plate puts one pixel behind every gap in a
 * stack of down-angled blades, so each gap is its own cell. The housing's top and bottom caps
 * carry short runs facing up and down for independent wall wash.
 *
 * Fit: the cassette cheeks sit in back-plate grooves with the fit gap, and the wash lenses in
 * their rebates. The strip takes the seat clearance.
 */
export const louver: FixtureDef = {
  id: 'louver-sconce',
  code: 'S6',
  name: 'Louver Sconce',
  family: 'single',
  tagline: 'Pixel Louver Lights, grown up. A pixel in every gap, plus up and down wash.',
  description:
    'A wall sconce of stacked, down-angled blades. One strip pixel sits behind each gap, so every gap is a cell you can chase. Short runs in the top and bottom caps wash the wall above and below on their own zones. Print the blade cassette in white or natural PETG so the blades catch the light; it lies on a cheek to print with no supports.',
  params: [
    { key: 'pixel', label: 'Strip', type: 'pixel', default: 'strip-60-ws2812b', pixels: ['strip-60-ws2812b', 'strip-60-ws2815'], group: 'Pixels' },
    { key: 'cells', label: 'Cells', type: 'number', default: 10, min: 6, max: 12, step: 1, group: 'Shape', help: 'One gap per strip pixel, so the gap pitch is the strip pitch.' },
    { key: 'wash', label: 'Wash pixels (each)', type: 'number', default: 3, min: 0, max: 4, step: 1, group: 'Pixels', help: '0 leaves the caps dark.' },
    { key: 'angle', label: 'Louver angle', type: 'number', default: 30, min: 15, max: 45, step: 5, unit: '°', group: 'Shape', help: 'Steeper hides the pixels from below and throws the glow down.' },
    { key: 'width', label: 'Width', type: 'number', default: 90, min: 70, max: 120, step: 5, unit: 'mm', group: 'Shape' },
    { key: 'depth', label: 'Louver depth', type: 'number', default: 40, min: 30, max: 55, step: 1, unit: 'mm', group: 'Shape' },
    ...FIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const pixel = getPixel(str(params, 'pixel'));
    const p = pixel.shape.kind === 'strip' ? pixel.shape.pitch : 1000 / 60;
    const n = num(params, 'cells');
    const nw = num(params, 'wash');
    const th = (num(params, 'angle') * Math.PI) / 180;
    const W = num(params, 'width');
    const D = num(params, 'depth');
    const tol = seatOf(params);
    const side = sideOf(params);
    const warnings: string[] = [];

    const bt = 4; // back plate
    const cheek = 3;
    const tb = 1.6; // blade thickness
    const tv = tb / Math.cos(th); // its vertical extent
    const hc = 12; // cap height
    const Dc = 18; // cap depth
    const yb = bt + 0.6; // blade inner edge
    const drop = D * Math.tan(th);
    // The cheeks' lower edge runs from the groove at the plate to the bottom blade's front edge.
    const cheekSlope = drop / (yb + D - (bt - 1.5));
    // Lowest blade and the cheeks both clear the bottom cap by 1 mm.
    const zb0 = hc + 1 + tv + Math.max((bt + Dc - yb) * Math.tan(th), (Dc + 1.5) * cheekSlope);
    const zb = (j: number) => zb0 + j * p;
    const H = zb(n) + 1 + hc;
    const xo = W / 2 + cheek;
    const Wp = 2 * xo + 10;

    /* ---------- Blade cassette (assembled in sconce coords) ---------- */
    // A section in (y, z), extruded across X.
    const yz = (pts: P2[], x0: number, x1: number): Manifold => g.place(g.extrude(g.poly(pts), x0, x1), mul(Rz(90), Rx(90)));
    const blade = (j: number): P2[] => [
      [yb, zb(j)],
      [yb + D, zb(j) - drop],
      [yb + D, zb(j) - drop - tv],
      [yb, zb(j) - tv],
    ];
    const cheekPts: P2[] = [
      [bt - 1.5, zb(0) - tv],
      [yb + D, zb(0) - drop - tv],
      [yb + D, zb(n) - drop],
      [bt - 1.5, zb(n)],
    ];
    // The cheek's lower edge falls toward the front, so it is lowest where it leaves the groove.
    const cheekLow = zb(0) - tv - 1.5 * cheekSlope;
    const cassetteAsm = g.union([
      ...Array.from({ length: n + 1 }, (_, j) => yz(blade(j), -W / 2 - 0.01, W / 2 + 0.01)),
      yz(cheekPts, W / 2, xo),
      yz(cheekPts, -xo, -W / 2),
    ]);
    const cassette = layFlat(g, cassetteAsm, Ry(90));

    /* ---------- Housing: back plate with integral wash caps ---------- */
    const toYZ = mul(Ry(-90), Rx(-90)); // socket frame (run X, emit +Z) → run Z, emit +Y
    const washLen = nw * p;
    const lensW = pixel.shape.kind === 'strip' ? pixel.shape.width + 4 : 14;
    const lensL = washLen + 7.6;
    const yw = bt + Dc / 2;
    const housingCuts: Manifold[] = [
      // Cell run up the middle of the plate, wire grooves on to each cap.
      g.place(socketCutter(g, pixel, { tol, length: n * p + 4 }), mul(T(0, bt, (zb(0) + zb(n)) / 2), toYZ)),
      g.box([-2, bt - 2, hc - 1], [2, bt + 0.1, H - hc + 1]),
      // Cheek grooves: the cheek plus the fit gap across and along, half a gap past its edge.
      ...[-1, 1].map((s) => g.box([s > 0 ? W / 2 - side : -xo - side, bt - 1.5 - side, cheekLow - side], [s > 0 ? xo + side : -W / 2 + side, bt + 0.1, zb(n) + side])),
      // Cable entry from the wall box, just under the stack.
      g.cylY(3.5, -1, bt + 1, 0, zb(0) - 6),
      // Keyholes: head in, slide down.
      ...[-1, 1].map((s) => g.place(g.keyhole(bt), mul(T(s * (W / 2 - 12), bt, H - hc - 30), Rx(90)))),
    ];
    if (nw > 0) {
      for (const [z, up] of [
        [H, 1],
        [0, -1],
      ] as const) {
        const face = mul(T(0, yw, z), up > 0 ? Rx(0) : Rx(180));
        housingCuts.push(g.place(socketCutter(g, pixel, { tol, length: washLen + 6 }), face));
        housingCuts.push(g.place(g.box([-lensL / 2 - side, -lensW / 2 - side, -1.2], [lensL / 2 + side, lensW / 2 + side, 1]), face)); // lens rebate
        for (const s of [-1, 1]) housingCuts.push(g.place(g.cylZ(2, -hc - 1, -1), mul(face, T(s * (washLen / 2 + 1.5), 0, 0)))); // leads through the cap
      }
    }
    const housingAsm = g.cut(
      g.union([
        g.box([-Wp / 2, 0, 0], [Wp / 2, bt, H]),
        g.box([-xo, bt - 0.01, 0], [xo, bt + Dc, hc]),
        g.box([-xo, bt - 0.01, H - hc], [xo, bt + Dc, H]),
      ]),
      housingCuts,
    );
    const housing = layFlat(g, housingAsm, Rx(90));

    /* ---------- Assembly: face -Y ---------- */
    const M = Rz(180);
    const parts: PartSpec<Manifold>[] = [
      { id: 'housing', name: 'Back plate + caps', role: 'body', solid: housing.solid, instances: [mul(M, housing.instance)], explode: [0, 0.6, 0], note: 'Back face on the plate.' },
      {
        id: 'cassette',
        name: `Louver cassette (${n + 1} blades)`,
        role: 'diffuser',
        solid: cassette.solid,
        instances: [mul(M, cassette.instance)],
        explode: [0, -1.2, 0],
        note: 'Prints on a cheek. Glue the cheeks into the back-plate grooves.',
      },
    ];
    if (nw > 0) {
      const lens = g.extrude(g.roundRect(lensL, lensW, 1), 0, 1.2);
      parts.push({
        id: 'wash-lens',
        name: 'Wash lens',
        role: 'diffuser',
        solid: lens,
        instances: [mul(M, T(0, yw, H - 1.2)), mul(M, T(0, yw, 1.2), Rx(180))],
        explode: [0, 0, 1],
        note: 'One over each wash run. Drops into the rebate with the fit gap; a dot of CA holds it.',
      });
    }

    /* ---------- Pixels in data order: down wash, cells bottom to top, up wash ---------- */
    // Wash runs go left to right as you face the sconce, which is -x in sconce coords.
    const pixels: PixelPlacement[] = [];
    const put = (pos: Vec3, normal: Vec3, unit: string) => pixels.push({ pos: apply(M, pos), normal: applyDir(M, normal), unit });
    for (let i = 0; i < nw; i++) put([washLen / 2 - (i + 0.5) * p, yw, 0], [0, 0, -1], 'S6-D');
    for (let i = 0; i < n; i++) put([0, yb + D, (zb(i) + zb(i + 1) - tv) / 2 - drop], [0, Math.cos(th), -Math.sin(th)], 'S6-C');
    for (let i = 0; i < nw; i++) put([washLen / 2 - (i + 0.5) * p, yw, H], [0, 0, 1], 'S6-U');

    const gapClear = p - tv;
    if (gapClear < 10) warnings.push(`At ${num(params, 'angle')}° the gaps are only ${gapClear.toFixed(1)} mm tall. Use a shallower angle or thinner blades.`);

    const schedule = [
      ...(nw > 0 ? [{ unit: 'S6-D', position: 'Bottom cap', purpose: 'Down wash', pixelId: pixel.id, units: Math.round(nw * p), px: nw, notes: 'Data in here, left to right.' }] : []),
      { unit: 'S6-C', position: `Louver cells 1–${n}, bottom to top`, purpose: 'Cell chase', pixelId: pixel.id, units: Math.round(n * p), px: n, notes: 'One pixel behind each gap.' },
      ...(nw > 0 ? [{ unit: 'S6-U', position: 'Top cap', purpose: 'Up wash', pixelId: pixel.id, units: Math.round(nw * p), px: nw }] : []),
    ];
    return {
      parts,
      pixels,
      assembly: [
        { title: 'Lay the strip', parts: ['housing'], hardware: `${pixel.name}: ${n} px${nw > 0 ? ` + 2 × ${nw} px` : ''}`, note: `Cell run up the plate channel${nw > 0 ? ', wash runs in the caps. Jumper them through the lead holes' : ''}. Data in at the bottom.` },
        ...(nw > 0 ? [{ title: 'Wash lenses', parts: ['wash-lens'], hardware: 'CA glue', note: 'One into each cap rebate, over the run.' }] : []),
        { title: 'Fit the cassette', parts: ['cassette', 'housing'], hardware: 'CA glue', note: 'Cheeks into the back-plate grooves, blades sloping down and out.' },
        { title: 'Hang it', hardware: '2 screws + plugs, 4 mm shank', note: 'Cable from the wall box through the entry under the stack. Keyholes: head in, slide down.' },
      ],
      schedule,
      hardware: [
        { item: 'WLED controller (ESP32)', qty: 1, note: 'In the wall box or remote; cable enters behind the stack' },
        { item: 'Hook-up wire, 3-core', qty: 0.3, note: 'metres, jumpers between the three runs' },
        { item: 'Screws + plugs for the keyholes', qty: 2, note: '4 mm shank' },
        { item: 'CA glue', qty: 1, note: 'Cheeks into the back-plate grooves' },
      ],
      warnings,
    };
  },
};
