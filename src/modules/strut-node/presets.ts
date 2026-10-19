import type { Vec3 } from '../../types';
import { add, dist, len, norm, scale, type SnDesign } from './model';

/** Lowest hub sits this far above the bench so the hub clears the mat. */
const LIFT = 60;

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  make(): SnDesign;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function design(name: string, pts: Vec3[], edges: [number, number][], controller?: number): SnDesign {
  const minZ = Math.min(...pts.map((p) => p[2]));
  const nodes = pts.map((p, i) => ({ id: `H${String(i + 1).padStart(2, '0')}`, pos: [r1(p[0]), r1(p[1]), r1(p[2] - minZ + LIFT)] as Vec3 }));
  const struts = edges.map(([a, b], i) => ({ id: `S${String(i + 1).padStart(2, '0')}`, a: nodes[a].id, b: nodes[b].id }));
  // Power and data usually come up from the floor: default to the lowest hub.
  let ctl = controller ?? 0;
  if (controller === undefined) nodes.forEach((n, i) => n.pos[2] < nodes[ctl].pos[2] - 1e-6 && (ctl = i));
  return { name, nodes, struts, controller: nodes[ctl].id, order: [] };
}

/** All vertex pairs at the shortest separation: the edges of a regular solid. */
function edgesByLength(pts: Vec3[], tol = 1e-3): [number, number][] {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, dist(pts[i], pts[j]));
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (dist(pts[i], pts[j]) < min * (1 + tol)) out.push([i, j]);
  return out;
}

function tetra(edge: number): SnDesign {
  const R = edge / Math.sqrt(3); // base circumradius
  const h = edge * Math.sqrt(2 / 3);
  const pts: Vec3[] = [0, 1, 2].map((k) => [R * Math.cos((k * 2 * Math.PI) / 3 - Math.PI / 2), R * Math.sin((k * 2 * Math.PI) / 3 - Math.PI / 2), 0] as Vec3);
  pts.push([0, 0, h]);
  return design('Tetrahedron', pts, edgesByLength(pts));
}

function cube(edge: number): SnDesign {
  const s = edge / 2;
  const pts: Vec3[] = [];
  for (const z of [-s, s]) for (const y of [-s, s]) for (const x of [-s, s]) pts.push([x, y, z]);
  return design('Cube', pts, edgesByLength(pts));
}

function octa(radius: number): SnDesign {
  const r = radius;
  const pts: Vec3[] = [
    [0, 0, -r],
    [r, 0, 0],
    [0, r, 0],
    [-r, 0, 0],
    [0, -r, 0],
    [0, 0, r],
  ];
  return design('Octahedron', pts, edgesByLength(pts));
}

/** Vertex-up icosahedron on the unit sphere. */
function icosaUnit(): Vec3[] {
  const pts: Vec3[] = [[0, 0, 1]];
  const zr = 1 / Math.sqrt(5);
  const rr = 2 / Math.sqrt(5);
  for (let k = 0; k < 5; k++) pts.push([rr * Math.cos((k * 2 * Math.PI) / 5), rr * Math.sin((k * 2 * Math.PI) / 5), zr]);
  for (let k = 0; k < 5; k++) pts.push([rr * Math.cos(((k + 0.5) * 2 * Math.PI) / 5), rr * Math.sin(((k + 0.5) * 2 * Math.PI) / 5), -zr]);
  pts.push([0, 0, -1]);
  return pts;
}

function icosa(edge: number): SnDesign {
  const unit = icosaUnit();
  const R = edge / dist(unit[0], unit[1]);
  const pts = unit.map((p) => scale(p, R));
  return design('Icosahedron', pts, edgesByLength(pts));
}

/** 2V geodesic dome: each icosahedron face split in four, pushed to the sphere, cut at the equator. */
function geodesic2v(radius: number): SnDesign {
  const unit = icosaUnit();
  const faces: [number, number, number][] = [];
  const e = edgesByLength(unit);
  const adj = new Set(e.map(([a, b]) => `${a}-${b}`));
  const has = (a: number, b: number) => adj.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) if (has(i, j) && has(j, k) && has(i, k)) faces.push([i, j, k]);

  const verts: Vec3[] = [];
  const key = (p: Vec3) => p.map((v) => Math.round(v * 1e5)).join(',');
  const index = new Map<string, number>();
  const vid = (p: Vec3) => {
    const q = norm(p);
    const k = key(q);
    if (!index.has(k)) {
      index.set(k, verts.length);
      verts.push(q);
    }
    return index.get(k)!;
  };
  const edges = new Set<string>();
  const link = (a: number, b: number) => edges.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
  for (const [a, b, c] of faces) {
    const [A, B, C] = [unit[a], unit[b], unit[c]];
    const va = vid(A);
    const vb = vid(B);
    const vc = vid(C);
    const ab = vid(scale(add(A, B), 0.5));
    const bc = vid(scale(add(B, C), 0.5));
    const ca = vid(scale(add(C, A), 0.5));
    for (const [p, q] of [
      [va, ab],
      [ab, vb],
      [vb, bc],
      [bc, vc],
      [vc, ca],
      [ca, va],
      [ab, bc],
      [bc, ca],
      [ca, ab],
    ])
      link(p, q);
  }
  const keep = verts.map((p) => p[2] > -1e-6);
  const remap = new Map<number, number>();
  const pts: Vec3[] = [];
  verts.forEach((p, i) => {
    if (!keep[i]) return;
    remap.set(i, pts.length);
    pts.push(scale(p, radius));
  });
  const out: [number, number][] = [];
  for (const k of edges) {
    const [a, b] = k.split('-').map(Number);
    if (keep[a] && keep[b]) out.push([remap.get(a)!, remap.get(b)!]);
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return design('2V geodesic dome', pts, out);
}

/** Trunk, three limbs, two twigs each. Every hub is different, so nothing dedupes. */
function tree(): SnDesign {
  const pts: Vec3[] = [
    [0, 0, 0],
    [0, 0, 300],
  ];
  const edges: [number, number][] = [[0, 1]];
  const dir = (azDeg: number, fromVertDeg: number): Vec3 => {
    const az = (azDeg * Math.PI) / 180;
    const t = (fromVertDeg * Math.PI) / 180;
    return [Math.sin(t) * Math.cos(az), Math.sin(t) * Math.sin(az), Math.cos(t)];
  };
  for (let k = 0; k < 3; k++) {
    const az = 90 + k * 120;
    const limb = add(pts[1], scale(dir(az, 40), 230));
    pts.push(limb);
    const li = pts.length - 1;
    edges.push([1, li]);
    for (const s of [-1, 1]) {
      pts.push(add(limb, scale(dir(az + s * 50, 45), 170)));
      edges.push([li, pts.length - 1]);
    }
  }
  return design('Branching tree', pts, edges, 0);
}

export const PRESETS: Preset[] = [
  { id: 'tetra', name: 'Tetrahedron', blurb: '4 hubs · 6 struts', make: () => tetra(300) },
  { id: 'cube', name: 'Cube', blurb: '8 hubs · 12 struts', make: () => cube(250) },
  { id: 'octa', name: 'Octahedron', blurb: '6 hubs · 12 struts', make: () => octa(200) },
  { id: 'icosa', name: 'Icosahedron', blurb: '12 hubs · 30 struts', make: () => icosa(250) },
  { id: 'geo2v', name: '2V geodesic dome', blurb: '26 hubs · 65 struts', make: () => geodesic2v(380) },
  { id: 'tree', name: 'Branching tree', blurb: '11 hubs · 10 struts', make: () => tree() },
];

export function getPreset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset "${id}"`);
  return p;
}

/** Bounding radius of a design around its centroid, for camera framing. */
export function designRadius(d: SnDesign): number {
  if (!d.nodes.length) return 200;
  const c = d.nodes.reduce<Vec3>((s, n) => add(s, scale(n.pos, 1 / d.nodes.length)), [0, 0, 0]);
  return Math.max(150, ...d.nodes.map((n) => len([n.pos[0] - c[0], n.pos[1] - c[1], n.pos[2] - c[2]])));
}
