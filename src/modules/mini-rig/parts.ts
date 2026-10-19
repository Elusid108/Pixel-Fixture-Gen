import type { Manifold } from 'manifold-3d';
import type { Geo } from '../../geom/geo';
import { add, basis, frameZ, len, norm, perp, scale, sub } from '../../geom/vec';
import { socketCutter } from '../../pixels/sockets';
import type { Vec3 } from '../../types';
import { CLAMP, YOKE, type InstDims } from './instruments';
import type { RigDims } from './params';
import { FACES, pinwheel } from './plan';

/**
 * Printed pieces of the Mini Rig, each modelled in its print orientation on z = 0.
 *
 * Truss sections print STANDING, chords vertical. That is the one orientation where:
 * - the chords come out as true round tubes with a clean wire bore and coupler sockets,
 *   instead of drooping horizontal cylinders;
 * - the lacing is self-supporting: the zigzag pitch is never less than the chord spacing, so
 *   every diagonal rises at 45° or steeper (short sections switch to a V, then to none);
 * - the only bridges are the top end frame's bars, about 34 mm between chords;
 * - the bottom end frame is a full 48 mm square ring on the bed, so tall sections stay put.
 * Flat "ladder" faces would print faster but need four glued seams per section and lose the
 * round hollow chords, which is where the wiring runs.
 */

const SEG = 20;

/* ---------------- Truss section ---------------- */

/** End-frame bolt holes: both hands of the pinwheel, so a frame meets a block or another frame. */
export const frameHoles = (d: RigDims): [number, number][] => [...pinwheel(d.boltAt, d.boltOff), ...pinwheel(d.boltAt, -d.boltOff)];

export function sectionSolid(g: Geo, d: RigDims, Ls: number): Manifold {
  const h = d.c / 2;
  const W = d.W;
  const chords: [number, number][] = [
    [h, -h],
    [h, h],
    [-h, h],
    [-h, -h],
  ];
  const solids: Manifold[] = chords.map(([x, y]) => g.cylZ(d.chordR, 0, Ls, x, y, SEG));
  const ring = g.rect(W, W).subtract(g.rect(W - 2 * d.frameBar, W - 2 * d.frameBar));
  const fT = Math.min(d.frameT, Ls / 3);
  solids.push(g.extrude(ring, 0, fT), g.extrude(ring, Ls - fT, Ls));

  // Lacing, one zigzag per face, every diagonal at 45° or steeper.
  const z0 = fT;
  const z1 = Ls - fT;
  const inner = z1 - z0;
  const rod = (p: Vec3, q: Vec3) => {
    const v = sub(q, p);
    const u = norm(v);
    return g.place(g.cylZ(d.lacingR, 0, len(v), 0, 0, 10), frameZ(u, perp(u), p));
  };
  for (let f = 0; f < 4; f++) {
    const [ax, ay] = chords[f];
    const [bx, by] = chords[(f + 1) % 4];
    if (inner >= d.c) {
      const n = Math.max(1, Math.min(Math.round(inner / (d.c * 1.2)), Math.floor(inner / d.c)));
      const p = inner / n;
      for (let k = 0; k < n; k++) {
        const [fx, fy, tx, ty] = (k + f) % 2 ? [bx, by, ax, ay] : [ax, ay, bx, by];
        solids.push(rod([fx, fy, z0 + k * p], [tx, ty, z0 + (k + 1) * p]));
      }
    } else if (inner >= d.c / 2) {
      const mid: Vec3 = [(ax + bx) / 2, (ay + by) / 2, z1];
      solids.push(rod([ax, ay, z0], mid), rod([bx, by, z0], mid));
    }
  }

  const cutters: Manifold[] = [];
  for (const [x, y] of chords) {
    cutters.push(g.cylZ(d.boreR, -1, Ls + 1, x, y, 16));
    cutters.push(g.cylZ(d.sockR, -1, d.sockDepth, x, y, 16), g.cylZ(d.sockR, Ls - d.sockDepth, Ls + 1, x, y, 16));
    if (d.exits && Ls >= 40) {
      const r = norm([x, y, 0]);
      cutters.push(g.place(g.cylZ(1.2, 0, d.chordR + 1, 0, 0, 12), frameZ(r, [0, 0, 1], [x, y, Ls / 2])));
    }
  }
  for (const [x, y] of frameHoles(d)) cutters.push(g.cylZ(1.65, -1, fT + 0.5, x, y, 12), g.cylZ(1.65, Ls - fT - 0.5, Ls + 1, x, y, 12));
  return g.cut(g.union(solids), cutters);
}

/** Hollow chord coupler: half in each chord end, the wiring runs through it. */
export function couplerSolid(g: Geo, d: RigDims): Manifold {
  const L = d.couplerLen;
  const ch = 0.4;
  const body = g.union([g.coneZ(d.couplerR - ch, d.couplerR, 0, ch), g.cylZ(d.couplerR, ch, L - ch), g.coneZ(d.couplerR, d.couplerR - ch, L - ch, L)]);
  return body.subtract(g.cylZ(d.couplerIR, -1, L + 1, 0, 0, 12));
}

/* ---------------- Corner block ---------------- */

/** Face frame: local XY on the face (u, v), local +Z out of the block. */
const faceFrame = (f: number, W: number) => basis(FACES[f].u, FACES[f].v, FACES[f].n, scale(FACES[f].n, W / 2));

/**
 * A corner block in its canonical frame, centred on the origin. Each used face gets four
 * M3 heat-set holes (pinwheel), four shallow wire grooves from the chord ends to a centre
 * hole, and that hole runs into an octahedral wire chamber. The chamber's walls are 35° off
 * vertical whichever face is down, so the block prints support-free on any face.
 */
export function blockSolid(g: Geo, d: RigDims, mask: number): Manifold {
  const W = d.W;
  const h = d.c / 2;
  const rOct = W / 2 - 6;
  const cutters: Manifold[] = [
    g.M.hull([
      [rOct, 0, 0],
      [-rOct, 0, 0],
      [0, rOct, 0],
      [0, -rOct, 0],
      [0, 0, rOct],
      [0, 0, -rOct],
    ]),
  ];
  const grooves = g.extrude(
    g.CS.union(([[h, h], [-h, h], [-h, -h], [h, -h]] as [number, number][]).map(([x, y]) => g.CS.hull([g.circle(1.5, x, y), g.circle(1.5, 0, 0)]))),
    -1.2,
    0.5,
  );
  const face = g.union([grooves, g.cylZ(3, -(W / 2 - rOct + 1), 0.5, 0, 0, 16), ...pinwheel(d.boltAt, d.boltOff).map(([x, y]) => g.cylZ(2.0, -5.7, 0.5, x, y, 14))]);
  for (let f = 0; f < 6; f++) if (mask & (1 << f)) cutters.push(g.place(face, faceFrame(f, W)));
  return g.cut(g.box([-W / 2, -W / 2, -W / 2], [W / 2, W / 2, W / 2]), cutters);
}

/* ---------------- Base plate and pick eye ---------------- */

/** Pinwheel hole positions of a block face, in the block frame's XY (for the top/bottom faces). */
const faceXY = (f: number, d: RigDims): [number, number][] =>
  pinwheel(d.boltAt, d.boltOff).map(([a, b]) => {
    const p = add(scale(FACES[f].u, a), scale(FACES[f].v, b));
    return [p[0], p[1]];
  });

/** 1:6 F34 base plate (600 mm square → 100 mm). The block sits inside a rim; the feed cable runs out underneath. */
export function baseSolid(g: Geo, d: RigDims): Manifold {
  const S = d.baseSize;
  const T = d.baseT;
  const W = d.W;
  // A 1 mm rim registers the block on the plate.
  // The block drops into the rim with the fit gap across.
  const rim = g.extrude(g.rect(W + 3 + d.fit, W + 3 + d.fit).subtract(g.rect(W + d.fit, W + d.fit)), T - 0.5, T + 1);
  const plate = g.union([g.extrude(g.roundRect(S, S, 6), 0, T), rim]);
  const cutters: Manifold[] = [
    g.cylZ(3, -1, T + 1, 0, 0, 16),
    g.box([0, -2.5, -1], [S / 2 + 1, 2.5, 2.5]),
  ];
  for (const [x, y] of faceXY(5, d)) cutters.push(g.union([g.coneZ(3.3, 1.65, -0.01, 1.65, x, y), g.cylZ(1.65, -1, T + 1, x, y, 14)]));
  const c = S / 2 - 8;
  for (const [x, y] of [
    [c, c],
    [-c, c],
    [-c, -c],
    [c, -c],
  ])
    cutters.push(g.union([g.coneZ(4, 2, -0.01, 2, x, y), g.cylZ(2, -1, T + 1, x, y, 14)]));
  return g.cut(plate, cutters);
}

/** Pick-point eye: bolts to a block's top face. Teardrop eye so it prints standing without support. */
export function pickSolid(g: Geo, d: RigDims): Manifold {
  const T = 3;
  const plate = g.extrude(g.roundRect(d.W, d.W, 3), 0, T);
  const r = 3.2;
  const eyeZ = 11;
  const tab2 = g.CS.union([g.rect(14, eyeZ, 0, eyeZ / 2), g.circle(7, 0, eyeZ)]).subtract(g.CS.hull([g.circle(r, 0, eyeZ), g.circle(0.1, 0, eyeZ + r * Math.SQRT2)]));
  // Profile drawn in (x, up); extrude across, then stand it up.
  const tab = g.place(g.extrude(tab2, -2.5, 2.5), basis([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, 0, T - 0.5]));
  return g.cut(g.union([plate, tab]), faceXY(4, d).map(([x, y]) => g.cylZ(1.65, -1, T + 1, x, y, 14)));
}

/** Hoist geometry: body centre above the pick eye, and the eye positions in the body profile. */
export const HOIST = { gap: 50, bottomEye: -27, topEye: 26, t: 20 };

/**
 * Mini chain hoist (display): a 1:6 hoist body with a top eye to hang it and a bottom eye
 * for the chain. Printed lying on its side, so both eyes are plain vertical holes.
 */
export function hoistSolid(g: Geo): Manifold {
  const { t, bottomEye, topEye } = HOIST;
  const profile = g.CS.union([g.roundRect(28, 36, 7), g.rect(10, 10, 0, topEye - 5), g.circle(5, 0, topEye), g.rect(8, 8, 0, bottomEye + 5), g.circle(4.5, 0, bottomEye)])
    .subtract(g.circle(2.5, 0, topEye))
    .subtract(g.circle(2.2, 0, bottomEye));
  const motor = g.cylZ(9, t - 0.5, t + 4, 0, 3, 32);
  const label = g.box([-9, -14, t - 0.5], [9, -8, t + 1]);
  return g.union([g.extrude(profile, 0, t), motor, label]);
}

/* ---------------- Instruments ---------------- */

/** Snap clamp: C-ring over the chord (opening into the truss), stem toward the yoke, pilot for the pan screw. */
export function clampSolid(g: Geo, id: InstDims, chordD: number): Manifold {
  const { clampRi: Ri, clampRo: Ro, stemEnd } = id;
  const open = chordD * 0.8;
  const cs = g.CS.union([g.circle(Ro), g.rect(CLAMP.stemW, stemEnd - Ri * 0.5, 0, (stemEnd + Ri * 0.5) / 2)])
    .subtract(g.circle(Ri))
    .subtract(g.rect(Ro + 2, open, -(Ro + 2) / 2, 0));
  const body = g.extrude(cs, 0, CLAMP.h);
  return body.subtract(g.cylY(1.3, stemEnd - CLAMP.pilot, stemEnd + 1, 0, CLAMP.h / 2));
}

/** U yoke, printed flat: pan hole through the bar, tilt holes through both arms. */
export function yokeSolid(g: Geo, id: InstDims): Manifold {
  const { tb, ta, h, tail } = YOKE;
  const wi = id.yokeWi;
  const armLen = tb + id.drop + tail;
  const cs = g.CS.union([g.rect(wi + 2 * ta, tb, 0, tb / 2), g.rect(ta, armLen, wi / 2 + ta / 2, armLen / 2), g.rect(ta, armLen, -wi / 2 - ta / 2, armLen / 2)]);
  return g.cut(g.extrude(cs, 0, h), [g.cylY(1.65, -1, tb + 1, 0, h / 2), g.cylX(1.65, -wi / 2 - ta - 1, wi / 2 + ta + 1, tb + id.drop, h / 2)]);
}

/** Trunnion stubs on ±X at the tilt axis, with pilot holes for the tilt screws. */
function trunnions(g: Geo, halfX: number, zT: number, inner: number): { add: Manifold[]; cut: Manifold[] } {
  return {
    add: [g.cylX(3.5, halfX - 1, halfX + 1.5, 0, zT), g.cylX(3.5, -halfX - 1.5, -halfX + 1, 0, zT)],
    cut: [g.cylX(1.3, inner, halfX + 2.5, 0, zT), g.cylX(1.3, -halfX - 2.5, -inner, 0, zT)],
  };
}

export function parBody(g: Geo, id: InstDims, d: RigDims): Manifold {
  const { R, L, capT, wall, lensR } = id.par!;
  const tr = trunnions(g, R, id.zT, R - 0.5);
  const body = g.union([g.cylZ(R, 0, L, 0, 0, 48), ...tr.add]);
  return g.cut(body, [
    g.cylZ(R - wall, capT, L + 1, 0, 0, 48),
    g.cylZ(lensR, L - 1.2, L + 1, 0, 0, 48),
    socketCutter(g, d.jewel, { tol: d.tol, wire: capT }).translate([0, 0, capT]),
    ...tr.cut,
  ]);
}

/** Lens disc for a PAR or mover, printed in natural PETG: the mouth Ø less the fit gap. */
export const lensSolid = (g: Geo, r: number, fit: number): Manifold => g.cylZ(r - fit / 2, 0, 1, 0, 0, 48);

export function moverBase(g: Geo, id: InstDims): Manifold {
  const m = id.mover!;
  return g.extrude(g.roundRect(m.baseW, m.baseD, 5), 0, id.baseH).subtract(g.cylZ(1.65, -1, id.baseH + 1, 0, 0, 14));
}

export function moverHead(g: Geo, id: InstDims, d: RigDims): Manifold {
  const m = id.mover!;
  const jd = d.jewel.shape.kind === 'round' ? d.jewel.shape.d : 23;
  const tr = trunnions(g, m.hw / 2, id.zT, m.hw / 2 - 3);
  const body = g.union([g.extrude(g.roundRect(m.hw, m.hw, 7), 0, m.H), ...tr.add]);
  return g.cut(body, [
    g.cylZ(m.lensR, m.H - 1.2, m.H + 1, 0, 0, 48),
    g.cylZ(jd / 2 + d.tol, m.jewelZ, m.H - 1.1, 0, 0, 48),
    socketCutter(g, d.jewel, { tol: d.tol, wire: m.jewelZ }).translate([0, 0, m.jewelZ]),
    ...tr.cut,
  ]);
}

export function blinderBody(g: Geo, id: InstDims, d: RigDims): Manifold {
  const b = id.blinder!;
  const cell = d.cell;
  const cr = (cell.shape.kind === 'round' ? cell.shape.d : 10) / 2 + d.tol;
  const depth = cell.shape.depth;
  const tr = trunnions(g, b.wH / 2, id.zT, b.wH / 2 - 3);
  const body = g.union([g.extrude(g.roundRect(b.wH, b.dH, 3), 0, b.hz), ...tr.add]);
  const cutters: Manifold[] = [...tr.cut];
  const seat = socketCutter(g, cell, { tol: d.tol, wire: b.seatZ - depth + 1 });
  for (const [x, y] of b.cells) {
    cutters.push(g.coneZ(cr, b.cupR, b.seatZ, b.hz + 0.01, x, y), seat.translate([x, y, b.seatZ]));
    if (cell.form === 'node') cutters.push(g.cylZ(2.5, -1, b.seatZ - depth + 0.5, x, y, 14));
  }
  // Wiring grooves across the back (on the bed), out past the right-hand trunnion.
  const ys = [...new Set(b.cells.map(([, y]) => y))];
  for (const y of ys) cutters.push(g.box([-b.cp / 2 - 2, y - 2, -1], [b.wH / 2 + 1, y + 2, 2]));
  if (ys.length > 1) cutters.push(g.box([b.cp / 2 - 2, Math.min(...ys) - 2, -1], [b.cp / 2 + 2, Math.max(...ys) + 2, 2]));
  return g.cut(body, cutters);
}

/** Batten body lying along X, beam up: strip channel, diffuser grooves, tilt-screw pilot along its length. */
export function battenBody(g: Geo, id: InstDims, d: RigDims): Manifold {
  const b = id.batten!;
  const sw = d.strip.shape.kind === 'strip' ? d.strip.shape.width : 10;
  const sd = d.strip.shape.depth;
  const ch = sd + 2.5;
  // Strip channel: the strip plus its seat clearance. Diffuser grooves: the diffuser plus the
  // fit gap, floor at hB − 2.2 where the diffuser sits.
  const z0 = b.hB - 2.2;
  const cs = g
    .rect(b.wB, b.hB, 0, b.hB / 2)
    .subtract(g.rect(sw + 2 * d.tol, ch + 1, 0, b.hB - ch / 2 + 0.5))
    .subtract(g.rect(b.grooveW, b.grooveH, 0, z0 + b.grooveH / 2))
    .subtract(g.circle(1.3, 0, id.zT));
  return g.place(g.extrude(cs, -b.Lb / 2, b.Lb / 2), basis([0, 1, 0], [0, 0, 1], [1, 0, 0]));
}

export function battenDiffuser(g: Geo, id: InstDims): Manifold {
  const b = id.batten!;
  return g.box([-(b.Lb - 0.5) / 2, -b.diffW / 2, 0], [(b.Lb - 0.5) / 2, b.diffW / 2, b.diffT]);
}
