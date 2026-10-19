import type { LinDims } from './params';

/**
 * Linea cross-sections, pure numbers. Coordinates are (y, z) in the bar frame: y across the
 * bar, z up from the back (the drawing plane) toward the light. Half-profiles for the joint
 * hubs are (r, z), revolved about the face normal, so a hub has the same section in every
 * direction and unions cleanly with arms at any angle.
 *
 *          diffuser plate (H .. H+td)
 *     ____________________________________
 *     \  wedge|leg                leg|wedge /   wall tops slope 45° into the chamber
 *      \      |  |   chamber        |  |  /
 *      |      |barb                barb|  |     barbs snap into grooves in the walls
 *      |  ____|________________________|__|
 *      | shoulder |   strip seat    | shoulder  (seat top = LED face, zSh)
 *      |__________|_________________|_________|
 *                     [back groove]              keys sit in pockets either side of it
 */

export type P2 = [number, number];

const mirror = (pts: P2[]): P2[] => pts.map(([y, z]) => [-y, z] as P2).reverse();

/** Outer solid of the U-channel. */
export function bodyOuter(D: LinDims): P2[] {
  const { W, wc, H, t } = D;
  return [
    [-W / 2, 0],
    [W / 2, 0],
    [W / 2, H],
    [wc / 2, H - t],
    [-wc / 2, H - t],
    [-W / 2, H],
  ];
}

/** Chamber (open to the top) plus the two snap grooves. The seat is cut separately by socketCutter. */
export function chamberCut(D: LinDims): P2[][] {
  const { wc, zSh, H, groove: g } = D;
  const side: P2[] = [
    [wc / 2 - 0.01, g.z0],
    [wc / 2 + g.d, g.z0],
    [wc / 2 + g.d, g.z1],
    [wc / 2 - 0.01, g.z1],
  ];
  return [
    [
      [-wc / 2, zSh - 0.01],
      [wc / 2, zSh - 0.01],
      [wc / 2, H + 1],
      [-wc / 2, H + 1],
    ],
    side,
    mirror(side),
  ];
}

/** Pixel PCBs: a wire channel down the middle of the seat (the pockets are cut per pixel). */
export function pcbChannel(D: LinDims): P2[] {
  return [
    [-2.5, D.F + 1],
    [2.5, D.F + 1],
    [2.5, D.zSh + 0.2],
    [-2.5, D.zSh + 0.2],
  ];
}

/** Return-wire groove along the back. */
export function backGroove(D: LinDims): P2[] {
  const { w, d } = D.back;
  return [
    [-w / 2, -1],
    [w / 2, -1],
    [w / 2, d],
    [-w / 2, d],
  ];
}

/** Grooves on the outside of the walls that the clips grip. */
export function clipGrooves(D: LinDims): P2[][] {
  const { W, clipGroove: c } = D;
  const side: P2[] = [
    [W / 2 - c.d, c.z0],
    [W / 2 + 1, c.z0],
    [W / 2 + 1, c.z1],
    [W / 2 - c.d, c.z1],
  ];
  return [side, mirror(side)];
}

/* ---- Covers: diffusers, joint lids, grilles ---- */

/** Leg half-width at its inner face: the aperture of every cover. */
export const aperture = (D: LinDims) => D.wc / 2 - D.clr - D.legT;

/** Plate across the top, the wedges that fill the wall-top chamfers, and the snap legs with barbs. */
export function coverPieces(D: LinDims, legs = true): P2[][] {
  const { W, wc, H, t, td, clr, legT, legL, barb } = D;
  const plate: P2[] = [
    [-W / 2, H],
    [W / 2, H],
    [W / 2, H + td],
    [-W / 2, H + td],
  ];
  const wedge: P2[] = [
    [wc / 2 - clr, H + 0.01],
    [wc / 2 - clr, H - t],
    [wc / 2, H - t],
    [W / 2, H],
    [W / 2, H + 0.01],
  ];
  const out: P2[][] = [plate, wedge, mirror(wedge)];
  if (legs) {
    const yo = wc / 2 - clr;
    const z0 = H - t - legL;
    // Legs run up to the plate, so they hang from it rather than from the wedge's edge.
    const leg: P2[] = [
      [yo - legT, z0],
      [yo, z0],
      [yo, H + 0.01],
      [yo - legT, H + 0.01],
    ];
    const bz = z0 + 0.4;
    const hook: P2[] = [
      [yo - 0.01, bz],
      [yo + barb, bz + barb],
      [yo - 0.01, bz + 2 * barb],
    ];
    out.push(leg, mirror(leg), hook, mirror(hook));
  }
  return out;
}

/** Hub half-profile of a joint lid: plate and wedge, no legs (the arms carry them). */
export function lidHubHalf(D: LinDims): P2[] {
  const { W, wc, H, t, td, clr } = D;
  return [
    [0, H],
    [wc / 2 - clr, H],
    [wc / 2 - clr, H - t],
    [wc / 2, H - t],
    [W / 2, H],
    [W / 2, H + td],
    [0, H + td],
  ];
}

/** Dome arch over the aperture: between an inner and an outer half-ellipse, springing at z = H. */
export function domeArch(D: LinDims, segs = 24): { arch: P2[]; hollow: P2[] } {
  const ai = aperture(D);
  const ao = ai + D.td;
  const bi = D.domeRise;
  const bo = D.domeRise + D.td;
  const outer: P2[] = [];
  const inner: P2[] = [];
  const mid: P2[] = [];
  for (let i = 0; i <= segs; i++) {
    const th = (Math.PI * i) / segs;
    outer.push([ao * Math.cos(th), D.H + bo * Math.sin(th)]);
    inner.push([ai * Math.cos(th), D.H + bi * Math.sin(th)]);
    mid.push([(ai + D.td / 2) * Math.cos(th), D.H + (bi + D.td / 2) * Math.sin(th)]);
  }
  // End wall: the hollow under the arch (reaching halfway into the shell so they fuse), from the plate level up.
  return { arch: [...outer, ...inner.reverse()], hollow: mid };
}

/** Cut through the plate over the aperture (dome and grille). */
export function apertureCut(D: LinDims): P2[] {
  const ai = aperture(D);
  return [
    [-ai, D.H - 0.5],
    [ai, D.H - 0.5],
    [ai, D.H + D.td + 1],
    [-ai, D.H + D.td + 1],
  ];
}

/**
 * Transverse divider section (cells comb and louver grille). Full chamber width below the
 * cover legs, aperture width between them. `top` is where it stops: just under the diffuser
 * for the comb, flush with the plate top for the grille.
 */
export function bladeSection(D: LinDims, top: number): P2[] {
  const ai = aperture(D);
  const yw = D.wc / 2 - D.clr - 0.05;
  const zLeg = D.H - D.t - D.legL - 0.25;
  const yn = top > D.H ? ai + 0.2 : ai - 0.2;
  return [
    [-yw, D.zSh],
    [yw, D.zSh],
    [yw, zLeg],
    [yn, zLeg],
    [yn, top],
    [-yn, top],
    [-yn, zLeg],
    [-yw, zLeg],
  ];
}

/** Side rails of the cells comb: thin walls standing on the seat shoulders, below the legs. */
export function combRails(D: LinDims): P2[][] {
  const yo = D.wc / 2 - D.clr - 0.05;
  const zLeg = D.H - D.t - D.legL - 0.25;
  const side: P2[] = [
    [yo - 0.8, D.zSh],
    [yo, D.zSh],
    [yo, zLeg],
    [yo - 0.8, zLeg],
  ];
  return [side, mirror(side)];
}

/** Revolve half-profiles for the joint hub: outer solid and cavity (seat, chamber, grooves). */
export function hubSolidHalf(D: LinDims): P2[] {
  const { W, wc, H, t } = D;
  return [
    [0, 0],
    [W / 2, 0],
    [W / 2, H],
    [wc / 2, H - t],
    [0, H - t],
  ];
}

export function hubCavityHalf(D: LinDims): P2[] {
  const { wc, zSh, H, groove: g } = D;
  const seatR = D.strip ? D.seatW / 2 : 2.5;
  const seatZ = D.strip ? D.F : D.F + 1;
  return [
    [0, seatZ],
    [seatR, seatZ],
    [seatR, zSh],
    [wc / 2, zSh],
    [wc / 2, g.z0],
    [wc / 2 + g.d, g.z0],
    [wc / 2 + g.d, g.z1],
    [wc / 2, g.z1],
    [wc / 2, H + 1],
    [0, H + 1],
  ];
}

/** Bowtie key outline, neck on x = 0 (the seam), half-length along ±x. */
export function keyOutline(D: LinDims, grow = 0): P2[] {
  const { neck, wide, half } = D.key;
  const n = neck / 2 + grow;
  const w = wide / 2 + grow;
  const h = half + grow;
  return [
    [-h, -w],
    [0, -n],
    [h, -w],
    [h, w],
    [0, n],
    [-h, w],
  ];
}

/** Half-bowtie pocket for a part whose end face is at x = x0 and which extends toward `sgn`. */
export function keyPocket(D: LinDims, x0: number, sgn: 1 | -1, y: number): P2[] {
  const { neck, wide, half, tol } = D.key;
  const n = neck / 2 + tol;
  const w = wide / 2 + tol;
  const pts: P2[] = [
    [x0 - sgn * 1, y - n],
    [x0, y - n],
    [x0 + sgn * (half + tol), y - w],
    [x0 + sgn * (half + tol), y + w],
    [x0, y + n],
    [x0 - sgn * 1, y + n],
  ];
  return pts;
}
