import type { CrossSection, Manifold } from 'manifold-3d';
import { layFlat } from '../../fixtures/util';
import { Geo, type P2 } from '../../geom/geo';
import { Rx } from '../../geom/mat';
import { basis, frameZ } from '../../geom/vec';
import { socketCutter } from '../../pixels/sockets';
import type { Mat4, Vec3 } from '../../types';
import type { CsDims } from './params';
import type { CapPlan, SegPlan } from './plan';

/**
 * Column Stack part geometry. Every segment is modelled upright in its print orientation:
 * shell from z=0 to z=h, a keyed spigot on top (h…h+J) and a plain socket bore at the bottom.
 * Overhangs are held to 45° or less, so nothing needs supports.
 *
 * The joint: the spigot of the part below slides into the socket bore, a rib at 0° drops into
 * a matching slot (so pixel rows line up from segment to segment), and two M3 self-tappers go
 * radially through the socket wall into pilot holes in the spigot at 90° and 270°.
 */

const up: Vec3 = [0, 0, 1];
const dirAt = (a: number): Vec3 => [Math.cos(a), Math.sin(a), 0];
const tanAt = (a: number): Vec3 => [-Math.sin(a), Math.cos(a), 0];

/** Frame at angle a, height z, radius r: local +Z points out along the radius, local +Y up. */
export const radialFrame = (a: number, r: number, z: number): Mat4 => frameZ(dirAt(a), tanAt(a), [r * Math.cos(a), r * Math.sin(a), z]);

/** Revolve profile: outer wall, top face, spigot, ledge cone, then the inner contour back down. */
function jointProfile(d: CsDims, h: number, innerUp: P2[]): P2[] {
  return [[d.R, 0], [d.R, h], [d.rs, h], [d.rs, h + d.J - 0.8], [d.rs - 0.8, h + d.J], [d.rsi, h + d.J], [d.rsi, h - 2], ...[...innerUp].reverse()];
}

/** Inner contour of a plain shell: the bore straight up to the ledge cone under the spigot. */
const plainInner = (d: CsDims, h: number): P2[] => [
  [d.Ri, 0],
  [d.Ri, h - 2 - (d.Ri - d.rsi)],
];

/** Inner contour with a ridge that traps a carrier disc resting on the spigot below. */
const ridgeInner = (d: CsDims, upTo: P2): P2[] => [
  [d.Ri, 0],
  [d.Ri, d.ridgeZ],
  [d.Ri - 1.5, d.ridgeZ],
  [d.Ri, d.ridgeZ + 1.5],
  upTo,
];

/** Spigot key rib (0°) on a top at height `top`. */
function spigotRib(g: Geo, d: CsDims, top: number): Manifold {
  return g.box([d.rs - 0.6, -d.keyW / 2, top - 0.01], [d.rs + d.keyD, d.keyW / 2, top + d.J - 1.2]);
}

/** M3 pilot holes through a spigot whose root is at `top`. */
function spigotPilots(g: Geo, d: CsDims, top: number): Manifold[] {
  return [Math.PI / 2, -Math.PI / 2].map((a) => g.place(g.cylZ(1.25, -1, d.rs - d.rsi + 2, 0, 0, 12), radialFrame(a, d.rsi - 1, top + d.J / 2)));
}

/** Socket key slot (0°, up to `slotTop`) and the two M3 clearance holes. */
function socketCuts(g: Geo, d: CsDims, slotTop = d.J + 0.8): Manifold[] {
  return [
    g.box([d.Ri - 0.5, -(d.keyW / 2 + d.fit), -1], [d.Ri + d.keyD + d.fit + 0.1, d.keyW / 2 + d.fit, slotTop]),
    ...[Math.PI / 2, -Math.PI / 2].map((a) => g.place(g.cylZ(1.7, -1, d.R - d.Ri + 2, 0, 0, 16), radialFrame(a, d.Ri - 1, d.J / 2))),
  ];
}

/** Room for the spigot of the part below: nothing but the shell may sit here. */
const socketClearance = (g: Geo, d: CsDims) => g.tubeZ(d.Ri + 0.01, d.rsi - 0.6, -1, d.J + 0.6);

/* ---------------- Segments ---------------- */

function helixSolid(g: Geo, d: CsDims, s: SegPlan & { layout: { kind: 'helix' } }): Manifold {
  const L = s.layout;
  const shell = g.revolve(
    jointProfile(d, s.h, [
      [d.Ri, 0],
      [d.Ri, d.J + 1],
      [L.Rt, L.zA],
      [L.Rt, L.zB],
    ]),
  );
  // One dot cutter: the PCB seat 1 mm under the surface, its wire exit, and a window through the skin.
  const dot = g.union([socketCutter(g, d.dot, { tol: d.tol, over: 0.2, wire: 3.2 }), g.cylZ(3.25, -0.4, 2, 0, 0, 24)]);
  const cuts = [...socketCuts(g, d), ...spigotPilots(g, d, s.h), ...L.dots.map((p) => g.place(dot, radialFrame(p.a, d.R - 1, p.z)))];
  return g.cut(g.union([shell, spigotRib(g, d, s.h)]), cuts);
}

function bandSolid(g: Geo, d: CsDims, s: SegPlan): Manifold {
  const top = s.h - 2 - (d.Ri - d.rsi);
  const shell = g.revolve(jointProfile(d, s.h, ridgeInner(d, [d.Ri, top])));
  return g.cut(g.union([shell, spigotRib(g, d, s.h)]), [...socketCuts(g, d, d.J + d.carrierT + 0.2), ...spigotPilots(g, d, s.h)]);
}

/** Key tab on a carrier disc, so the PCB's first LED always sits at the same angle. */
const carrierTab = (g: Geo, d: CsDims) => g.box([d.Ri - 0.6, -(d.keyW / 2 - 0.15), 0], [d.Ri + d.keyD - 0.1, d.keyW / 2 - 0.15, d.carrierT]);

/** Ring band carrier: disc with the ring PCB seat, and a 45° funnel that throws its light onto the band. */
export function bandCarrierSolid(g: Geo, d: CsDims, s: SegPlan & { layout: { kind: 'band' } }): Manifold {
  const { Rc, rb, rIn, Rf } = s.layout;
  const T = d.carrierT;
  const zf = T + (Rf - rb);
  const zq = T + (rIn - (rb - 2.3));
  const body = g.revolve([
    [d.chaseR, 0],
    [Rc, 0],
    [Rc, T],
    [rb, T],
    [Rf, zf],
    [Rf - 2.3, zf],
    [rIn, zq],
    [d.chaseR, zq],
  ]);
  return g.cut(g.union([body, carrierTab(g, d)]), [g.place(socketCutter(g, d.ring, { tol: d.tol, over: 0.5, wire: T + 1 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, T, 1])]);
}

function latticeSolid(g: Geo, d: CsDims, s: SegPlan & { layout: { kind: 'lattice' } }): Manifold {
  const L = s.layout;
  const n = L.faces.length;
  const shell = g.revolve(jointProfile(d, s.h, plainInner(d, s.h)));
  // Core: a regular prism, one strip run per face, the wire chase down the middle.
  const vR = L.apo / Math.cos(Math.PI / n);
  const corePts: P2[] = L.faces.map((a) => [vR * Math.cos(a + Math.PI / n), vR * Math.sin(a + Math.PI / n)]);
  const core = g.extrude(g.poly(corePts).subtract(g.circle(d.chaseR)), 0, s.h);
  // 45° spokes from the shell up into the core, at the core's corners (between the strips).
  const r0 = L.apo * 0.9;
  const r1 = d.Ri + 0.5;
  const rise = r1 - r0;
  const spokeCs = g.poly([
    [r0, L.spokeZ + rise],
    [r1, L.spokeZ],
    [r1, L.spokeZ + 4.3],
    [r0, L.spokeZ + rise + 4.3],
  ]);
  const spoke = g.extrude(spokeCs, -1.5, 1.5);
  const spokes = L.faces.map((a) => {
    const v = a + Math.PI / n;
    return g.place(spoke, basis([Math.cos(v), Math.sin(v), 0], up, [Math.sin(v), -Math.cos(v), 0]));
  });
  // Diamond windows, sides steeper than 45°.
  const { m, w, hd, rows } = L.win;
  const diamond = g.extrude(
    g.poly([
      [0, -hd / 2],
      [w / 2, 0],
      [0, hd / 2],
      [-w / 2, 0],
    ]),
    d.Ri - 1.5,
    d.R + 1,
  );
  const windows = rows.flatMap((row) =>
    Array.from({ length: m }, (_, j) => {
      const a = row.phase + (j * 2 * Math.PI) / m;
      return g.place(diamond, basis(tanAt(a), up, dirAt(a), [0, 0, row.z]));
    }),
  );
  const len = L.zs1 - L.zs0;
  const strip = socketCutter(g, d.strip, { tol: d.tol, over: 0.5, length: len });
  const wireHole = g.cylZ(2.5, 0, L.apo - d.chaseR - 1.5, 0, 0, 16);
  const coreCuts = L.faces.flatMap((a) => [
    g.place(strip, frameZ(dirAt(a), up, [L.apo * Math.cos(a), L.apo * Math.sin(a), (L.zs0 + L.zs1) / 2])),
    g.place(wireHole, radialFrame(a, d.chaseR - 1, L.zs0 + 4)),
    g.place(wireHole, radialFrame(a, d.chaseR - 1, L.zs1 - 4)),
  ]);
  return g.cut(g.union([shell, spigotRib(g, d, s.h), core, ...spokes]), [...socketCuts(g, d), ...spigotPilots(g, d, s.h), ...windows, ...coreCuts]);
}

function louverSolid(g: Geo, d: CsDims, s: SegPlan & { layout: { kind: 'louver' } }): Manifold {
  const L = s.layout;
  const h = s.h;
  const tanT = Math.tan((d.louverAngle * Math.PI) / 180);
  const bottomRing = g.revolve([
    [d.R, 0],
    [d.R, d.J + 3],
    [d.Ri, d.J + 3],
    [d.Ri, 0],
  ]);
  const topRing = g.revolve([
    [d.R, L.zTop],
    [d.R, h],
    [d.rs, h],
    [d.rs, h + d.J - 0.8],
    [d.rs - 0.8, h + d.J],
    [d.rsi, h + d.J],
    [d.rsi, h - 2],
    [d.Ri, h - 2 - (d.Ri - d.rsi)],
    [d.Ri, L.zTop],
  ]);
  const core = g.tubeZ(L.rc, d.chaseR, 0, h);
  // Fins stop 0.3 mm inside the skin line so no face is coplanar with the rings.
  const rOut = d.R - 0.3;
  const fins = L.fins.map((z) => {
    const at = (r: number) => z + (r - L.rc) * tanT;
    return g.revolve([
      [L.rc - 0.5, at(L.rc - 0.5)],
      [rOut, at(rOut)],
      [rOut, at(rOut) + L.tv],
      [L.rc - 0.5, at(L.rc - 0.5) + L.tv],
    ]);
  });
  const n = s.n;
  const divider = g.box([L.rc - 0.5, -0.8, 0], [rOut, 0.8, L.zTop + 0.5]);
  const dividers = Array.from({ length: n }, (_, j) => {
    const a = (j * 2 * Math.PI) / n;
    return g.place(divider, basis(dirAt(a), tanAt(a), up));
  });
  const inner = g
    .union([core, ...fins, ...dividers])
    .intersect(g.box([-d.R - 1, -d.R - 1, 0], [d.R + 1, d.R + 1, L.zTop + 0.5]))
    .subtract(socketClearance(g, d));
  const seat = socketCutter(g, d.dot, { tol: d.tol, over: 0.5, wire: 6 });
  const pockets = L.cells.map((c) => g.place(seat, radialFrame(c.a, L.rc, c.zc)));
  return g.cut(g.union([bottomRing, topRing, inner, spigotRib(g, d, h)]), [...socketCuts(g, d), ...spigotPilots(g, d, h), ...pockets]);
}

function ringSolid(g: Geo, d: CsDims, s: SegPlan & { layout: { kind: 'ring' } }): Manifold {
  const L = s.layout;
  const shell = g.revolve(jointProfile(d, s.h, plainInner(d, s.h)));
  const hole = socketCutter(g, d.node, { tol: d.tol, over: 1 });
  const holes = L.rows.flatMap((row) => Array.from({ length: L.n }, (_, i) => g.place(hole, radialFrame(row.phase + (i * 2 * Math.PI) / L.n, d.R, row.z))));
  return g.cut(g.union([shell, spigotRib(g, d, s.h)]), [...socketCuts(g, d), ...spigotPilots(g, d, s.h), ...holes]);
}

/** A segment's printed shell, upright, z=0 on the bed. */
export function segmentSolid(g: Geo, d: CsDims, s: SegPlan): Manifold {
  switch (s.layout.kind) {
    case 'helix':
      return helixSolid(g, d, s as SegPlan & { layout: { kind: 'helix' } });
    case 'band':
      return bandSolid(g, d, s);
    case 'lattice':
      return latticeSolid(g, d, s as SegPlan & { layout: { kind: 'lattice' } });
    case 'louver':
      return louverSolid(g, d, s as SegPlan & { layout: { kind: 'louver' } });
    case 'ring':
      return ringSolid(g, d, s as SegPlan & { layout: { kind: 'ring' } });
  }
}

/* ---------------- Caps ---------------- */

/** Jewel carrier for the lit caps: disc with the jewel seat, resting on the last spigot. */
export function jewelCarrierSolid(g: Geo, d: CsDims): Manifold {
  const body = g.union([g.cylZ(d.Ri - 0.3, 0, d.carrierT), carrierTab(g, d)]);
  return g.cut(body, [g.place(socketCutter(g, d.jewel, { tol: d.tol, over: 0.5, wire: d.carrierT + 1 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, d.carrierT, 1])]);
}

function domeSolid(g: Geo, d: CsDims, c: CapPlan & { layout: { kind: 'dome' } }): Manifold {
  const { t, zb, top } = c.layout;
  const R = d.R;
  const arc = (r: number, from: number, to: number): P2[] => {
    const out: P2[] = [];
    const steps = 15;
    for (let i = 0; i <= steps; i++) {
      const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
      out.push([r * Math.cos(a), zb + r * Math.sin(a)]);
    }
    return out;
  };
  // Circular arc to 45°, then a 45° cone to the tip: a dome that never overhangs past 45°.
  const profile: P2[] = [[R, 0], ...arc(R, 0, 45), [0, top], [0, top - t * Math.SQRT2], ...arc(R - t, 45, 0), [d.Ri - 1.5, d.ridgeZ], [d.Ri, d.ridgeZ], [d.Ri, 0]];
  return g.cut(g.revolve(profile), socketCuts(g, d, d.J + d.carrierT + 0.2));
}

/** Fresnel cap, modelled assembled (socket down, lens on top), returned laid lens-face down. */
function fresnelSolid(g: Geo, d: CsDims, c: CapPlan & { layout: { kind: 'fresnel' } }) {
  const { Hc, lt } = c.layout;
  const Rcurve = 1.6 * d.R;
  const hT = 1.2;
  const lb = 1;
  const rFlat = d.Ri - 2;
  const sag = (r: number) => Rcurve - Math.sqrt(Math.max(0, Rcurve * Rcurve - r * r));
  const zoneR: number[] = [0];
  for (let k = 1; k * hT < Rcurve; k++) {
    const r = Math.sqrt(Rcurve * Rcurve - (Rcurve - k * hT) ** 2);
    if (r >= rFlat - 0.5) break;
    zoneR.push(r);
  }
  const lens: P2[] = [];
  for (let k = zoneR.length - 1; k >= 0; k--) {
    const outer = k === zoneR.length - 1 ? rFlat : zoneR[k + 1];
    const inner = zoneR[k];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const r = outer - ((outer - inner) * i) / steps;
      lens.push([r, Hc - (lb + hT - (sag(r) - k * hT))]);
    }
  }
  // Teeth face the jewel; the flat face is the outside. Printed flat face down: no supports.
  const profile: P2[] = [[d.R, 0], [d.R, Hc], [0, Hc], ...lens.reverse(), [rFlat, Hc - lt], [d.Ri, Hc - lt], [d.Ri, d.ridgeZ + 1.5], [d.Ri - 1.5, d.ridgeZ], [d.Ri, d.ridgeZ], [d.Ri, 0]];
  const asm = g.cut(g.revolve(profile), socketCuts(g, d, d.J + d.carrierT + 0.2));
  return { ...layFlat(g, asm, Rx(180)), zones: zoneR.length };
}

function finialSolid(g: Geo, d: CsDims, c: CapPlan & { layout: { kind: 'finial' } }): Manifold {
  const R = d.R;
  const zN = d.J + 3 + 0.55 * R + 6;
  const top = c.layout.top;
  const profile: P2[] = [
    [R, 0],
    [R, d.J + 3],
    [0.45 * R, d.J + 3 + 0.55 * R],
    [0.45 * R, zN],
    [0.6 * R, zN + 0.15 * R],
    [0.6 * R, zN + 0.15 * R + 4],
    [2.5, top - 3],
    [0, top],
    [0, d.J + 0.8 + d.Ri],
    [d.Ri, d.J + 0.8],
    [d.Ri, 0],
  ];
  return g.cut(g.revolve(profile), socketCuts(g, d));
}

export interface CapSolid {
  solid: Manifold;
  /** Print → cap frame (identity for upright caps). */
  local: Mat4;
  note: string;
}

export function capSolid(g: Geo, d: CsDims, c: CapPlan): CapSolid {
  const I: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  switch (c.layout.kind) {
    case 'dome':
      return { solid: domeSolid(g, d, c as CapPlan & { layout: { kind: 'dome' } }), local: I, note: 'Natural PETG, upright. 45° ogive, so the dome needs no supports. Jewel carrier drops in from below.' };
    case 'fresnel': {
      const f = fresnelSolid(g, d, c as CapPlan & { layout: { kind: 'fresnel' } });
      return { solid: f.solid, local: f.instance, note: `Natural PETG, lens face down. ${f.zones} stepped zones over the jewel; teeth face the LEDs.` };
    }
    case 'finial':
      return { solid: finialSolid(g, d, c as CapPlan & { layout: { kind: 'finial' } }), local: I, note: 'Upright. Unlit; caps the wire chase.' };
  }
}

/* ---------------- Base and canopy ---------------- */

/** Floor base bay: wall, 45° shoulder, spigot, vents, a teardrop gland hole and heat-set bosses. Upright, open bottom down. */
export function baySolid(g: Geo, d: CsDims): Manifold {
  const wb = 3;
  const Rb = d.baseR;
  const H = d.bayH;
  const zt = H + (Rb - d.R);
  const zci = Rb + H - wb * Math.SQRT2 - d.rsi;
  const shell = g.revolve([
    [Rb, 0],
    [Rb, H],
    [d.R, zt],
    [d.rs, zt],
    [d.rs, zt + d.J - 0.8],
    [d.rs - 0.8, zt + d.J],
    [d.rsi, zt + d.J],
    [d.rsi, zci],
    [Rb - wb, H + wb - wb * Math.SQRT2],
    [Rb - wb, 0],
  ]);
  const bossR = Rb - wb - 3.2;
  const bossAngles = [45, 135, 225, 315].map((a) => (a * Math.PI) / 180);
  const bosses = bossAngles.map((a) => {
    const [x, y] = [bossR * Math.cos(a), bossR * Math.sin(a)];
    return g.union([g.cylZ(4.2, 0, 10, x, y, 24), g.coneZ(4.2, 0.6, 9.99, 14.5, x, y)]);
  });
  const cuts: Manifold[] = [...spigotPilots(g, d, zt)];
  for (const a of bossAngles) cuts.push(g.cylZ(2, -0.01, 5.7, bossR * Math.cos(a), bossR * Math.sin(a), 16));
  // Vent slots all round, clear of the gland and the bosses.
  const vent = g.box([Rb - wb - 1, -1.75, 16], [Rb + 1, 1.75, Math.max(26, H - 12)]);
  for (let i = 0; i < 24; i++) {
    const deg = (i + 0.5) * 15;
    if (Math.abs(deg - 180) < 22 || [45, 135, 225, 315].some((b) => Math.abs(deg - b) < 9)) continue;
    const a = (deg * Math.PI) / 180;
    cuts.push(g.place(vent, basis(dirAt(a), tanAt(a), up)));
  }
  // PG7 gland: a teardrop so the hole's roof prints at 45°.
  const r = 6.25;
  const tear: CrossSection = g.CS.hull([g.circle(r), g.circle(0.3, 0, r * Math.SQRT2 - 0.3)]);
  cuts.push(g.place(g.extrude(tear, -wb - 2, 2), radialFrame(Math.PI, Rb, 14)));
  return g.cut(g.union([shell, ...bosses, spigotRib(g, d, zt)]), cuts);
}

/** Removable bottom plate with printed feet, countersunk screws and cable-tie slots. Returns it laid feet-up. */
export function plateSolid(g: Geo, d: CsDims) {
  const Rb = d.baseR;
  const z0 = d.footH;
  const z1 = d.footH + d.plateT;
  const feet = [0, 90, 180, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return g.cylZ(7, 0, z0 + 0.01, (Rb - 16) * Math.cos(a), (Rb - 16) * Math.sin(a), 32);
  });
  const bossR = Rb - 3 - 3.2;
  const cuts: Manifold[] = [];
  for (const deg of [45, 135, 225, 315]) {
    const a = (deg * Math.PI) / 180;
    const [x, y] = [bossR * Math.cos(a), bossR * Math.sin(a)];
    cuts.push(g.cylZ(1.7, z0 - 1, z1 + 1, x, y, 16), g.coneZ(3.3, 1.7, z0 - 0.01, z0 + 1.6, x, y));
  }
  // Cable-tie slots: a pair for the PSU, a pair for the controller.
  for (const [x, y] of [
    [45, -15],
    [-45, -15],
    [20, 40],
    [-20, 40],
  ] as [number, number][])
    cuts.push(g.box([x - 1.5, y - 6, z0 - 1], [x + 1.5, y + 6, z1 + 1]));
  const asm = g.cut(g.union([g.cylZ(Rb, z0, z1), ...feet]), cuts);
  return layFlat(g, asm, Rx(180));
}

/** Hanger: a disc with the column spigot, through which the lamp nipple and cable pass. Spigot up on the bed. */
export function hangerSolid(g: Geo, d: CsDims): Manifold {
  const T = d.hangerT;
  const body = g.union([
    g.cylZ(d.R, 0, T),
    g.revolve([
      [d.rsi, T - 0.01],
      [d.rs, T - 0.01],
      [d.rs, T + d.J - 0.8],
      [d.rs - 0.8, T + d.J],
      [d.rsi, T + d.J],
    ]),
    spigotRib(g, d, T),
  ]);
  return g.cut(body, [g.cylZ(5.25, -1, T + 1, 0, 0, 32), ...spigotPilots(g, d, T)]);
}

/** Ceiling canopy cup: floor down, open to the ceiling. Two screw tubes and a centre cord-grip hole. */
export function canopySolid(g: Geo, d: CsDims): Manifold {
  const Rc = d.canopyR;
  const H = d.canopyH;
  const cup = g.revolve([
    [0, 0],
    [Rc, 0],
    [Rc, H],
    [Rc - 2.4, H],
    [Rc - 2.4, 3],
    [0, 3],
  ]);
  const x = Rc - 2.4 - 6;
  const tubes = [x, -x].map((tx) => g.cylZ(5, 1, H - 2, tx, 0, 32));
  const cuts = [g.cylZ(6.25, -1, 4, 0, 0, 32), ...[x, -x].map((tx) => g.cylZ(2.25, -1, H + 1, tx, 0, 16))];
  return g.cut(g.union([cup, ...tubes]), cuts);
}
