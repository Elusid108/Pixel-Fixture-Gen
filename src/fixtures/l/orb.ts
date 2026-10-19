import type { Manifold } from 'manifold-3d';
import { Geo, type P2 } from '../../geom/geo';
import { apply, mul, Rx, T } from '../../geom/mat';
import { invert, splitParts, splitToBed } from '../../geom/split';
import { add, basis, cross, dist, dot, frameZ, norm, perp, rotMat4, scale, sub } from '../../geom/vec';
import { cluster1D, matchSockets, type KeyedDir } from '../../graph/dedupe';
import { getPixel } from '../../pixels/library';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { layFlat, num, str } from '../util';
import { fmt, geodesic, massG, SPLIT_PARAMS, splitCfg } from './common';

/**
 * L1 The Orb: a geodesic sphere, one lit panel per face.
 *
 * Each panel is a light box. The outer face is a flat diffuser; short skirts along its edges
 * lie in the planes through the sphere's centre, so neighbouring panels butt flush. Inside, a
 * funnel rises at 45° (support-free, face down on the plate) to a collar that holds one 12 mm
 * node aimed back at the face. The funnel keeps each face's light in its own face.
 *
 * Panels join at the vertices from the outside: a cap over every vertex screws into the
 * corner bosses of the 5 or 6 panels that meet there. Nothing has to be reached from inside,
 * so the last panel goes on as easily as the first.
 *
 * The top vertex gets the crown: a 1/8 IPS nipple through the crown and the panel corners,
 * locked by a nut and fender washer on the inside, so the shell hangs from the pipe in
 * compression on the corner bosses. Power comes down the hoist chain and in through the pipe.
 *
 * Faces and vertices dedupe with matchSockets: identical panels print as one part ×N.
 */

const SKIRT_T = 1.6;
const SKIRT_D = 8;
const FACE_T = 1.2;
const FUNNEL_W = 1.2;
const COLLAR_T = 3;
const BOSS_H = 10;
const CAP_T = 2.4;
const CHOP = 7; // corner chop at every vertex: room for the 1/8 IPS nipple at the top
const PIPE_R = 5.35; // 1/8 IPS nipple is 10.3 mm OD

export interface OrbFace {
  idx: number;
  v: [number, number, number];
  pts: Vec3[];
  c: Vec3;
  n: Vec3;
  cls: string;
  /** Rotation taking the class representative onto this face. */
  rot: number[][];
}

export interface OrbVertex {
  idx: number;
  p: Vec3;
  /** Neighbour vertex indices, CCW seen from outside. */
  nbrs: number[];
  /** Incident faces, matching `nbrs`: face k lies between nbrs[k] and nbrs[k+1]. */
  faces: number[];
  cls: string;
  rot: number[][];
  top: boolean;
}

export interface OrbPlan {
  R: number;
  faces: OrbFace[];
  verts: OrbVertex[];
  faceClasses: { id: string; rep: number; members: number[] }[];
  vertexClasses: { id: string; rep: number; members: number[] }[];
  /** Data order: face indices. */
  order: number[];
  minEdge: number;
  maxEdge: number;
  /** Corner region along each edge from a vertex: boss and cap size. */
  rc: number;
}

const ident = () => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function letters(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Geometry and dedupe for an orb, no kernel needed. */
export function planOrb(freq: number, diameter: number): OrbPlan {
  const R = diameter / 2;
  const geo = geodesic(freq);
  const P = geo.verts.map((u) => scale(u, R));
  const faces: OrbFace[] = geo.faces.map((v, idx) => {
    const pts = v.map((i) => P[i]);
    const c = scale(add(add(pts[0], pts[1]), pts[2]), 1 / 3);
    const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    return { idx, v: [...v] as [number, number, number], pts, c, n, cls: '', rot: ident() };
  });
  let minEdge = Infinity;
  let maxEdge = 0;
  for (const f of faces)
    for (let i = 0; i < 3; i++) {
      const e = dist(f.pts[i], f.pts[(i + 1) % 3]);
      minEdge = Math.min(minEdge, e);
      maxEdge = Math.max(maxEdge, e);
    }

  /* ---- Face classes: same triangle up to rotation (mirror images are different prints) ---- */
  const radial = faces.flatMap((f) => f.pts.map((p, i) => ({ f: f.idx, i, d: dist(p, f.c) })));
  const rClass = new Map<string, number>();
  cluster1D(radial, (x) => x.d, 0.02 * (R / 250)).forEach((grp, k) => grp.forEach((x) => rClass.set(`${x.f}:${x.i}`, k)));
  const faceKeys = (f: OrbFace): KeyedDir[] => [
    ...f.pts.map((p, i) => ({ key: `r${rClass.get(`${f.idx}:${i}`)}`, dir: norm(sub(p, f.c)), face: [0, 0, 1] as Vec3, lit: false })),
    { key: 'n', dir: f.n, face: [0, 0, 1], lit: false },
  ];
  const faceClasses: { id: string; rep: number; members: number[]; keys: KeyedDir[] }[] = [];
  for (const f of faces) {
    const keys = faceKeys(f);
    let hit = false;
    for (const c of faceClasses) {
      const rot = matchSockets(c.keys, keys);
      if (rot) {
        c.members.push(f.idx);
        f.cls = c.id;
        f.rot = rot;
        hit = true;
        break;
      }
    }
    if (!hit) {
      const id = letters(faceClasses.length);
      faceClasses.push({ id, rep: f.idx, members: [f.idx], keys });
      f.cls = id;
    }
  }

  /* ---- Vertices: neighbours in CCW order, and their classes ---- */
  const topIdx = P.reduce((best, p, i) => (p[2] > P[best][2] ? i : best), 0);
  const inc = new Map<number, number[]>();
  faces.forEach((f) => f.v.forEach((i) => inc.set(i, [...(inc.get(i) ?? []), f.idx])));
  const verts: OrbVertex[] = P.map((p, idx) => {
    const nV = norm(p);
    const fs = inc.get(idx)!;
    const nbrSet = new Set<number>();
    for (const fi of fs) for (const j of faces[fi].v) if (j !== idx) nbrSet.add(j);
    const x = perp(nV);
    const y = cross(nV, x);
    const ang = (j: number) => {
      const d = sub(P[j], p);
      return Math.atan2(dot(d, y), dot(d, x));
    };
    const nbrs = [...nbrSet].sort((a, b) => ang(a) - ang(b));
    const fOrdered = nbrs.map((a, k) => {
      const b = nbrs[(k + 1) % nbrs.length];
      return fs.find((fi) => faces[fi].v.includes(a) && faces[fi].v.includes(b))!;
    });
    return { idx, p, nbrs, faces: fOrdered, cls: '', rot: ident(), top: idx === topIdx };
  });
  const edges = verts.flatMap((v) => v.nbrs.map((j) => ({ v: v.idx, j, d: dist(v.p, P[j]) })));
  const eClass = new Map<string, number>();
  cluster1D(edges, (e) => e.d, 0.02 * (R / 250)).forEach((grp, k) => grp.forEach((e) => eClass.set(`${e.v}:${e.j}`, k)));
  const vertexClasses: { id: string; rep: number; members: number[]; keys: KeyedDir[] }[] = [];
  for (const v of verts) {
    const keys: KeyedDir[] = [...v.nbrs.map((j) => ({ key: `e${eClass.get(`${v.idx}:${j}`)}`, dir: norm(sub(P[j], v.p)), face: [0, 0, 1] as Vec3, lit: false })), { key: 'n', dir: norm(v.p), face: [0, 0, 1], lit: false }];
    let hit = false;
    if (!v.top) {
      for (const c of vertexClasses) {
        if (verts[c.rep].top) continue;
        const rot = matchSockets(c.keys, keys);
        if (rot) {
          c.members.push(v.idx);
          v.cls = c.id;
          v.rot = rot;
          hit = true;
          break;
        }
      }
    }
    if (!hit) {
      const id = v.top ? 'crown' : `V${letters(vertexClasses.filter((c) => !verts[c.rep].top).length)}`;
      vertexClasses.push({ id, rep: v.idx, members: [v.idx], keys });
      v.cls = id;
    }
  }

  /* ---- Data order: latitude bands top to bottom. Each band is a ring, so it starts at the face
     nearest the end of the band above and runs whichever way keeps the next hop short. ---- */
  const orderFor = (tolK: number): number[] => {
    const bands = cluster1D(faces, (f) => -f.c[2], minEdge * tolK);
    const out: number[] = [];
    for (const band of bands) {
      const ring = [...band].sort((a, b) => Math.atan2(a.c[1], a.c[0]) - Math.atan2(b.c[1], b.c[0]));
      const last = out.length ? faces[out[out.length - 1]].c : null;
      let s0 = 0;
      if (last) ring.forEach((f, i) => dist(f.c, last) < dist(ring[s0].c, last) && (s0 = i));
      const n = ring.length;
      const fwd = n > 1 && dist(ring[(s0 + 1) % n].c, ring[s0].c) <= dist(ring[(s0 - 1 + n) % n].c, ring[s0].c);
      for (let k = 0; k < n; k++) out.push(ring[(s0 + (fwd ? k : -k) + n * n) % n].idx);
    }
    return out;
  };
  const worstHop = (o: number[]) => o.reduce((w, fi, k) => (k ? Math.max(w, dist(faces[fi].c, faces[o[k - 1]].c)) : w), 0);
  let order = orderFor(0.2);
  for (const k of [0.1, 0.3, 0.4, 0.5, 0.6]) {
    const o = orderFor(k);
    if (worstHop(o) < worstHop(order) - 1e-6) order = o;
  }

  const rc = Math.min(0.4 * minEdge, Math.max(CHOP + 6, Math.min(28, 0.24 * minEdge)));
  return {
    R,
    faces,
    verts,
    faceClasses: faceClasses.map(({ id, rep, members }) => ({ id, rep, members })),
    vertexClasses: vertexClasses.map(({ id, rep, members }) => ({ id, rep, members })),
    order,
    minEdge,
    maxEdge,
    rc,
  };
}

/** Print frame of a face: outer face on z=0, panel rising toward the centre (+z). */
function faceFrame(f: OrbFace): Mat4 {
  const z = scale(f.n, -1);
  const x = norm(sub(f.pts[0], f.c));
  return basis(x, cross(z, x), z, f.c);
}

/** Corner screw point on a face corner (assembled frame): along the corner bisector. */
function cornerPoint(f: OrbFace, i: number, rc: number): Vec3 {
  const p = f.pts[i];
  const a = norm(sub(f.pts[(i + 1) % 3], p));
  const b = norm(sub(f.pts[(i + 2) % 3], p));
  return add(p, scale(norm(add(a, b)), rc * 0.5));
}

/** Cap print frame: flat outer top on z=0, concave side up (+z toward the centre). */
function capFrame(plan: OrbPlan, v: OrbVertex): Mat4 {
  const nV = norm(v.p);
  const z = scale(nV, -1);
  const toN = sub(plan.verts[v.nbrs[0]].p, v.p);
  const x = norm(sub(toN, scale(nV, dot(toN, nV))));
  return basis(x, cross(z, x), z, add(v.p, scale(nV, CAP_T)));
}

export const orb: FixtureDef = {
  id: 'orb',
  code: 'L1',
  name: 'The Orb',
  family: 'assembly',
  tagline: 'Geodesic sphere, one lit panel per face, identical faces deduped into print counts.',
  description:
    'A hanging geodesic sphere. Every face is a printed light box with one 12 mm node, and the panels join from the outside with vertex caps, so the whole shell closes without reaching in. The crown hangs it on a 1/8 IPS nipple and brings power down the hoist chain.',
  params: [
    {
      key: 'freq',
      label: 'Frequency',
      type: 'select',
      default: '3',
      options: [
        { value: '2', label: '2V · 80 faces' },
        { value: '3', label: '3V · 180 faces' },
        { value: '4', label: '4V · 320 faces' },
      ],
      group: 'Shape',
    },
    { key: 'diameter', label: 'Diameter', type: 'number', default: 500, min: 300, max: 900, step: 10, unit: 'mm', group: 'Shape' },
    { key: 'pixel', label: 'Node', type: 'pixel', default: 'node-12-bullet', pixels: ['node-12-bullet', 'node-12-bullet-12v'], group: 'Pixels' },
    { key: 'tol', label: 'Node hole clearance', type: 'number', default: 0.1, min: 0, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit' },
    ...SPLIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const freq = Number(str(params, 'freq'));
    const D = num(params, 'diameter');
    const pixel = getPixel(str(params, 'pixel'));
    const tol = num(params, 'tol');
    const split = splitCfg(params);
    const plan = planOrb(freq, D);
    const { R, faces, verts, rc } = plan;
    const warnings: string[] = [];
    const parts: PartSpec<Manifold>[] = [];
    const nodeR = (pixel.shape.kind === 'round' ? pixel.shape.d : 12) / 2 + tol;
    const collarR = nodeR + 2.5;

    /* ---------- Panels ---------- */
    let funnelH = 0;
    let splitPieces = 0;
    let splitPins = 0;
    for (const cls of plan.faceClasses) {
      const f = faces[cls.rep];
      const M = faceFrame(f);
      const Mi = invert(M);
      const p = f.pts.map((q) => apply(Mi, q));
      const C = apply(Mi, [0, 0, 0]);
      const at = (q: Vec3, z: number): Vec3 => add(q, scale(sub(C, q), z / C[2]));
      const tri = (z: number) => p.map((q) => at(q, z));
      const tri2 = (z: number): P2[] => tri(z).map((q) => [q[0], q[1]]);
      const ringAt = (pts: P2[], inset: number, z: number): Vec3[] => {
        const cs = g.poly(pts).offset(-inset, 'Miter');
        const poly = (cs.toPolygons() as unknown as P2[][])[0] ?? [];
        return poly.map(([x, y]) => [x, y, z]);
      };
      // Face plate and skirts: the wedge toward the centre, hollowed above the face.
      const outer = g.M.hull([...tri(0), ...tri(SKIRT_D)]);
      const skirtVoid = g.M.hull([...ringAt(tri2(FACE_T), SKIRT_T, FACE_T), ...ringAt(tri2(SKIRT_D + 1), SKIRT_T, SKIRT_D + 1)]);
      // Corner regions: E points along each edge.
      const E = (i: number, j: number, d: number): Vec3 => add(p[i], scale(norm(sub(p[j], p[i])), d));
      const hexAt = (d: number): P2[] => [0, 1, 2].flatMap((i) => [E(i, (i + 2) % 3, d), E(i, (i + 1) % 3, d)]).map((q) => [q[0], q[1]] as P2);
      // Funnel from the corner-chopped face up to the node collar, 45° so it prints support-free.
      const hexIn = g.poly(hexAt(rc)).offset(-(SKIRT_T + 0.4), 'Miter');
      const cavBase = hexIn.offset(-FUNNEL_W, 'Miter');
      const cavPts = (cavBase.toPolygons() as unknown as P2[][])[0] ?? [];
      const reach = Math.max(...cavPts.map(([x, y]) => Math.hypot(x, y)));
      const hf = FACE_T + Math.max(18, reach - (nodeR + 1.2));
      funnelH = Math.max(funnelH, hf + COLLAR_T);
      const funnel = g.M.hull([g.extrude(hexIn, FACE_T - 0.3, FACE_T), g.cylZ(collarR, hf, hf + COLLAR_T)]);
      const cavity = g.M.hull([g.extrude(cavBase, FACE_T, FACE_T + 0.01), g.cylZ(nodeR + 1.2, hf - 0.01, hf)]);
      // A screw boss in each corner along the vertex axis, where the cap screw lands. The corners
      // outside the funnel stay dark; the cap covers them.
      const bosses: Manifold[] = [];
      const pilots: Manifold[] = [];
      for (let i = 0; i < 3; i++) {
        const q = apply(Mi, cornerPoint(f, i, rc));
        const dir = norm(sub(C, p[i]));
        const Fq = frameZ(dir, perp(dir), q);
        bosses.push(g.place(g.cylZ(3.8, -0.5, BOSS_H), Fq));
        pilots.push(g.place(g.cylZ(1.25, -1, BOSS_H + 2), Fq));
      }
      let panel = g.cut(g.union([g.cut(outer, [skirtVoid]), g.union(bosses).intersect(g.M.hull([...tri(0), ...tri(BOSS_H + 1)])), funnel]), [cavity, g.cylZ(nodeR, hf - 1, hf + COLLAR_T + 1)]);
      panel = g.cut(panel, pilots).intersect(g.extrude(g.poly(hexAt(CHOP)), -1, funnelH + 5));

      const members = cls.members.map((m) => faces[m]);
      const instances = members.map((m) => mul(T(...m.c), rotMat4(m.rot), T(...scale(f.c, -1)), M));
      const base = { id: `panel-${cls.id}`, name: `Panel ${cls.id}`, role: 'diffuser' as const, note: `Face down, natural or white PETG. One ${pixel.name} pushes into the collar from inside.` };
      if (split.on) {
        const sp = splitToBed(g, panel, split.printer, { ...split.opts, keepOut: [{ p: [0, 0, 0], r: collarR + 4 }] });
        parts.push(...splitParts(sp, base, instances));
        if (sp.pieces > 1) {
          splitPieces += sp.pieces * members.length;
          splitPins += sp.pins * members.length;
        }
      } else {
        parts.push({ ...base, solid: panel, instances });
      }
    }

    /* ---------- Vertex caps and the crown ---------- */
    const capFor = (v: OrbVertex): { solid: Manifold; frame: Mat4 } => {
      const F = capFrame(plan, v);
      const Fi = invert(F);
      const Vc = apply(Fi, v.p);
      const Es = v.nbrs.map((j) => apply(Fi, add(v.p, scale(norm(sub(plan.verts[j].p, v.p)), rc))));
      const zmax = Math.max(...Es.map((e) => e[2]));
      const poly: P2[] = Es.map((e) => [e[0], e[1]]);
      const body = g.extrude(g.poly(poly), 0, zmax + 0.01);
      const beyond = g.M.hull([Vc, ...Es, add(Vc, [0, 0, 60]), ...Es.map((e) => add(e, [0, 0, 60]))]);
      const holes: Manifold[] = [];
      v.faces.forEach((fi) => {
        const f = faces[fi];
        const q = apply(Fi, cornerPoint(f, f.v.indexOf(v.idx), rc));
        holes.push(g.cylZ(1.7, -1, zmax + 2, q[0], q[1]), g.coneZ(3.4, 1.7, -0.01, 1.7, q[0], q[1]));
      });
      return { solid: g.cut(body, [beyond, ...holes]), frame: F };
    };
    let crownMade = false;
    for (const cls of plan.vertexClasses) {
      const v = verts[cls.rep];
      const { solid, frame } = capFor(v);
      if (v.top) {
        // Crown: a 45° boss on the cap's outside for the nipple, printed boss-down.
        const Es = v.nbrs.map((j) => apply(invert(frame), add(v.p, scale(norm(sub(verts[j].p, v.p)), rc))));
        const prism = g.extrude(g.poly(Es.map((e) => [e[0], e[1]] as P2)), -22, 0.01);
        const boss = g.place(g.coneZ(31, 11, 0, 20), Rx(180)).intersect(prism);
        const crownSolid = g.cut(g.union([solid, boss]), [g.cylZ(PIPE_R, -30, 30)]);
        const lay = layFlat(g, crownSolid, Rx(180), frame);
        parts.push({
          id: 'crown',
          name: 'Crown',
          role: 'body',
          solid: lay.solid,
          instances: [lay.instance],
          explode: [0, 0, 1],
          note: '1/8 IPS nipple through the crown and the panel corners; lock nut and fender washer inside. Prints boss-down.',
        });
        crownMade = true;
        continue;
      }
      const instances = cls.members.map((m) => {
        const w = verts[m];
        return mul(T(...w.p), rotMat4(w.rot), T(...scale(v.p, -1)), frame);
      });
      parts.push({
        id: `cap-${cls.id}`,
        name: `Vertex cap ${cls.id} (${v.nbrs.length}-way)`,
        role: 'body',
        solid,
        instances,
        note: 'Flat top on the plate. Countersunk M3 self-tappers into the panel corner bosses.',
      });
    }
    if (!crownMade) warnings.push('No top vertex found for the crown.');

    /* ---------- Pixels: one node per face, latitude bands, serpentine ---------- */
    const pixels: PixelPlacement[] = [];
    const strand = pixel.strandLength ?? 50;
    const lines: ScheduleLine[] = [];
    plan.order.forEach((fi, k) => {
      const f = faces[fi];
      const unit = `L1-${Math.floor(k / strand) + 1}`;
      pixels.push({ pos: f.c, normal: f.n, unit });
    });
    const strands = Math.ceil(plan.order.length / strand);
    for (let s = 0; s < strands; s++) {
      const n = Math.min(strand, plan.order.length - s * strand);
      const first = s * strand + 1;
      lines.push({
        unit: `L1-${s + 1}`,
        position: `Faces ${first}–${first + n - 1}`,
        purpose: s === 0 ? 'Top bands first' : 'Continue down',
        pixelId: pixel.id,
        units: n,
        px: n,
        notes: `Inject ${pixel.volts} V at the start of this strand.`,
      });
    }

    /* ---------- Paperwork ---------- */
    const F = faces.length;
    const V = verts.length;
    const shellG = massG(parts);
    const totalKg = (shellG + F * 6) / 1000;
    const watts = F * pixel.wattsPerPx;
    const amps = watts / pixel.volts;
    const hardware: HardwareLine[] = [
      { item: 'M3×12 countersunk self-tapping screw (plastic)', qty: 3 * F, note: 'Vertex caps into panel corner bosses' },
      { item: '1/8 IPS threaded nipple, 40 mm', qty: 1, note: 'Through the crown and the top vertex' },
      { item: '1/8 IPS lock nut + Ø25 mm fender washer', qty: 1, note: 'Inside, against the five top corner bosses' },
      { item: '1/8 IPS screw-collar loop', qty: 1, note: 'Hangs the orb' },
      { item: 'Chandelier chain, rated ≥ 4× the orb weight', qty: 1, note: 'Power cable woven through the links down to the loop' },
      { item: `${pixel.volts === 5 ? '2-core 1.5 mm² (16 AWG)' : '2-core 0.75 mm² (18 AWG)'} + data pair`, qty: 1, note: 'Power down the hoist line, through the nipple' },
      { item: 'Nylon cord grip for 1/8 IPS', qty: 1, note: 'Strain relief at the nipple: the cable never carries the orb' },
    ];
    if (splitPins) hardware.push({ item: '1.75 mm filament pins', qty: splitPins, note: 'For split panels' });
    if (pixel.volts === 5 && amps > 8)
      warnings.push(`${amps.toFixed(1)} A at 5 V full white is a lot to send down a hoist line. Use the 12 V nodes (${(watts / 12).toFixed(1)} A) or put the 5 V supply inside the orb.`);
    if (plan.minEdge < 40) warnings.push(`Faces are small (${fmt(plan.minEdge)} mm edges) for 12 mm nodes. Go up in diameter or down a frequency.`);
    if (splitPieces) warnings.push(`${splitPieces} panel pieces: the ${freq}V faces are bigger than your bed at Ø${D} and were split with keyed joints. 3V or 4V keeps every panel whole.`);
    warnings.push(
      `Weight: about ${totalKg.toFixed(1)} kg printed in PETG with nodes. It hangs on the 1/8 IPS nipple, which bears on the five top corner bosses through the washer.${totalKg > 4 ? ' That is heavy for printed bosses: add a steel safety cable from the loop to a bottom washer.' : ''}`,
    );
    warnings.push(
      `${plan.faceClasses.length} panel shapes (${plan.faceClasses.map((c) => `${c.id} ×${c.members.length}`).join(', ')}) and ${plan.vertexClasses.length - 1} cap shapes for ${V - 1} vertices. Label the bags: mixing shapes up is the classic geodesic mistake.`,
    );

    return { parts, pixels, schedule: lines, hardware, warnings, enclosureCm3: (4 / 3) * Math.PI * (R / 10) ** 3 };
  },
};
