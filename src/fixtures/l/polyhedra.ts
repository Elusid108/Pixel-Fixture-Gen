import { FIT_PARAMS } from '../../fit';
import { Geo } from '../../geom/geo';
import { add, applyRot, cross, dot, norm, perp, rotFromTo, scale, sub } from '../../geom/vec';
import { getPixel } from '../../pixels/library';
import type { FixtureDef, HardwareLine, ScheduleLine, Vec3 } from '../../types';
import { num, str } from '../util';
import { fmt, geodesic, massG, SPLIT_PARAMS, splitCfg } from './common';
import {
  ACCENT_PCBS,
  accentParam,
  buildCappedShell,
  capHardware,
  crownAssembly,
  crownHardware,
  faceLine,
  facePixels,
  fmtGap,
  leadWarning,
  optPixel,
  planShell,
  starLine,
  starPixels,
  type ShellPlan,
} from './shell';

/**
 * L9 Polyhedra: a Platonic or Archimedean solid as a panel shell, hung from a crown like the Orb.
 *
 * - Icosahedron: 20 triangles, 12 five-way vertices.
 * - Dodecahedron: 12 pentagons, 20 three-way vertices.
 * - Truncated icosahedron (the football): 12 pentagons and 20 hexagons, 60 three-way vertices.
 *   Two panel shapes, one cap shape.
 *
 * Every face is a light box with a node or a 7-px jewel; every vertex cap carries a Ø9.5 mm PCB
 * behind a lens (see shell.ts for the joints). One vertex is turned to the top for the crown.
 */

export type Solid = 'trunc-ico' | 'dodeca' | 'ico';

export interface Polyhedron {
  /** Unit circumradius. */
  verts: Vec3[];
  faces: number[][];
}

function adjacency(faces: number[][]): Map<number, number[]> {
  const nb = new Map<number, Set<number>>();
  for (const f of faces)
    f.forEach((a, k) => {
      const b = f[(k + 1) % f.length];
      nb.set(a, (nb.get(a) ?? new Set()).add(b));
      nb.set(b, (nb.get(b) ?? new Set()).add(a));
    });
  return new Map([...nb.entries()].map(([k, s]) => [k, [...s]]));
}

/** Sort points CCW around an outward axis. */
function aroundAxis(axis: Vec3, pts: { id: number; p: Vec3 }[]): number[] {
  const x = perp(axis);
  const y = cross(axis, x);
  return pts
    .map((q) => ({ id: q.id, a: Math.atan2(dot(q.p, y), dot(q.p, x)) }))
    .sort((u, v) => u.a - v.a)
    .map((q) => q.id);
}

/** Turn the solid so its highest vertex points straight up (it carries the crown). */
function vertexUp(P: Polyhedron): Polyhedron {
  const top = P.verts.reduce((b, v, i) => (v[2] > P.verts[b][2] ? i : b), 0);
  const R = rotFromTo(norm(P.verts[top]), [0, 0, 1]);
  return { verts: P.verts.map((v) => applyRot(R, v)), faces: P.faces };
}

export function polyhedron(kind: Solid): Polyhedron {
  const ico = geodesic(1);
  if (kind === 'ico') return { verts: ico.verts, faces: ico.faces.map((f) => [...f]) };
  if (kind === 'dodeca') {
    const verts = ico.faces.map((f) => norm(f.reduce<Vec3>((s, i) => add(s, ico.verts[i]), [0, 0, 0])));
    const faces = ico.verts.map((a, i) =>
      aroundAxis(
        a,
        ico.faces.flatMap((f, k) => (f.includes(i) ? [{ id: k, p: verts[k] }] : [])),
      ),
    );
    return vertexUp({ verts, faces });
  }
  // Truncated icosahedron: cut every icosahedron corner a third of the way along its edges.
  const adj = adjacency(ico.faces);
  const verts: Vec3[] = [];
  const at = new Map<string, number>();
  const third = (a: number, b: number): number => {
    const key = `${a}>${b}`;
    let i = at.get(key);
    if (i === undefined) {
      i = verts.length;
      at.set(key, i);
      verts.push(norm(add(ico.verts[a], scale(sub(ico.verts[b], ico.verts[a]), 1 / 3))));
    }
    return i;
  };
  const faces: number[][] = [];
  ico.verts.forEach((a, i) => {
    const ring = adj.get(i)!.map((j) => ({ id: third(i, j), p: sub(ico.verts[j], a) }));
    faces.push(aroundAxis(a, ring));
  });
  for (const [a, b, c] of ico.faces) faces.push([third(a, b), third(b, a), third(b, c), third(c, b), third(c, a), third(a, c)]);
  return vertexUp({ verts, faces });
}

export function planPolyhedron(kind: Solid, diameter: number): ShellPlan & { R: number } {
  const R = diameter / 2;
  const P = polyhedron(kind);
  return { ...planShell({ points: P.verts.map((v) => scale(v, R)), faces: P.faces, spoke: (p) => scale(norm(p), -1), crown: true, size: R }), R };
}

/** Solid volume over its circumscribed sphere. */
const FILL: Record<Solid, number> = { 'trunc-ico': 0.87, dodeca: 0.665, ico: 0.605 };

const SOLID_NAME: Record<Solid, string> = { 'trunc-ico': 'truncated icosahedron', dodeca: 'dodecahedron', ico: 'icosahedron' };

export const polyhedra: FixtureDef = {
  id: 'polyhedra',
  code: 'L9',
  name: 'Polyhedra',
  family: 'assembly',
  tagline: 'Platonic and Archimedean panel shells: a lit panel per face and a star at every vertex.',
  description:
    'A hanging polyhedron built the Orb way. Pick the icosahedron, the dodecahedron or the truncated icosahedron (the football: 12 pentagons and 20 hexagons, two panel shapes). Every face is a printed light box with a node or a 7-px jewel; every vertex cap holds a Ø9.5 mm PCB behind a lens. A crown on the top vertex hangs it on a 1/8 IPS nipple.',
  params: [
    {
      key: 'solid',
      label: 'Solid',
      type: 'select',
      default: 'trunc-ico',
      options: [
        { value: 'trunc-ico', label: 'Truncated icosahedron · 32 faces' },
        { value: 'dodeca', label: 'Dodecahedron · 12 faces' },
        { value: 'ico', label: 'Icosahedron · 20 faces' },
      ],
      group: 'Shape',
    },
    { key: 'diameter', label: 'Diameter', type: 'number', default: 450, min: 300, max: 800, step: 10, unit: 'mm', group: 'Shape', help: 'Across the vertices.' },
    {
      key: 'pixel',
      label: 'Face pixel',
      type: 'pixel',
      default: 'node-12-bullet',
      pixels: ['node-12-bullet', 'node-12-bullet-12v', 'jewel-7-ws2812b', 'jewel-7-sk6812-rgbw'],
      group: 'Pixels',
      help: 'A node per face, or a 7-px jewel for big faces.',
    },
    accentParam('accent', 'Vertex star', ACCENT_PCBS, 'pcb-9-ws2812b', 'Second pixel type: a PCB in every vertex cap behind a printed lens. None leaves plain caps.'),
    ...FIT_PARAMS,
    ...SPLIT_PARAMS,
  ],
  build(ctx, params) {
    const g = new Geo(ctx);
    const kind = str(params, 'solid') as Solid;
    const D = num(params, 'diameter');
    const pixel = getPixel(str(params, 'pixel'));
    const accent = optPixel(params, 'accent');
    const plan = planPolyhedron(kind, D);
    const warnings: string[] = [];

    const sh = buildCappedShell(g, plan, { params, split: splitCfg(params), facePixel: pixel, accent, crown: true });
    const { parts, j } = sh;

    const pixels = [...facePixels(plan, pixel, 'L9-F'), ...starPixels(plan, accent, 'L9-V')];
    const schedule: ScheduleLine[] = [faceLine(plan, pixel, 'L9-F', 'Face panels, top band first')];
    if (accent) schedule.push(starLine(plan, accent, 'L9-V', true));

    const hardware: HardwareLine[] = [...capHardware(plan, accent), ...crownHardware(pixel)];
    if (sh.splitPins) hardware.push({ item: '1.75 mm filament pins', qty: sh.splitPins, note: 'For split panels' });

    const F = plan.faces.length;
    const stars = plan.vertOrder.length;
    const faceW = F * pixel.pxPerUnit * pixel.wattsPerPx;
    const starW = accent ? stars * accent.pxPerUnit * accent.wattsPerPx : 0;
    const amps5 = (pixel.volts === 5 ? faceW : 0) / 5 + starW / 5;
    if (amps5 > 8) warnings.push(`${amps5.toFixed(1)} A at 5 V full white is a lot to send down a hoist line. Cap the brightness in WLED or put the 5 V supply inside the shell.`);
    if (accent && pixel.volts === 12) warnings.push(`The stars are 5 V PCBs and the faces 12 V nodes: two supplies, or a 12→5 V buck inside for ${fmt(starW)} W of stars.`);
    const lead = leadWarning(plan, pixel);
    if (lead) warnings.push(`${lead} Or use jewels and wire them yourself.`);
    if (sh.tight) warnings.push(`Vertex caps are crowded at Ø${D}: go up in diameter.`);
    if (sh.splitPieces) warnings.push(`${sh.splitPieces} panel pieces: the ${SOLID_NAME[kind]} faces are bigger than your bed at Ø${D} and were split with keyed joints.`);
    const totalKg = (massG(parts) + F * 6 + stars * 2) / 1000;
    warnings.push(`Weight: about ${totalKg.toFixed(1)} kg printed in PETG with pixels, hung on the 1/8 IPS nipple through the crown.${totalKg > 4 ? ' Add a steel safety cable from the loop to a bottom washer.' : ''}`);
    warnings.push(
      `${SOLID_NAME[kind]}: ${plan.faceClasses.length} panel shape${plan.faceClasses.length === 1 ? '' : 's'} (${plan.faceClasses.map((c) => `${c.id} ×${c.members.length} ${plan.faces[c.rep].pts.length}-gon`).join(', ')}) and ${plan.vertexClasses.length - 1} cap shape${plan.vertexClasses.length === 2 ? '' : 's'} for ${plan.verts.length - 1} vertices.`,
    );
    warnings.push(`Fit gap ${fmtGap(j.fit)}: cap spigots Ø${fmt(2 * j.spigR, 1)} into Ø${fmt(2 * j.holeR, 1)} corner holes; panel skirts stand ${fmtGap(j.side)} back from every seam.`);

    return { parts, pixels, schedule, hardware, warnings, assembly: crownAssembly(plan, parts, j, pixel, accent), enclosureCm3: (4 / 3) * Math.PI * (plan.R / 10) ** 3 * FILL[kind] };
  },
};
