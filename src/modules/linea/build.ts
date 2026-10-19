import type { CrossSection, Manifold } from 'manifold-3d';
import { layFlat, str } from '../../fixtures/util';
import { Geo } from '../../geom/geo';
import { mul, Rx, Rz, T } from '../../geom/mat';
import { add, basis, cross, frameX, scale } from '../../geom/vec';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { idsOf, mm, steps } from '../shared/assembly';
import { parseDesign } from './model';
import { bedAngle, LINEA_PARAMS, type LinDims } from './params';
import { edgePixels, planLinea, straightOffsets, type LineaPlan, type PNode } from './plan';
import {
  apertureCut,
  backGroove,
  bladeSection,
  bodyOuter,
  chamberCut,
  clipGrooves,
  combRails,
  coverPieces,
  domeArch,
  hubCavityHalf,
  hubSolidHalf,
  keyOutline,
  keyPocket,
  lidHubHalf,
  pcbChannel,
  type P2,
} from './profile';

/** Extrusions along Z turned to run along X: section (y, z) → bar frame. */
const ALONG_X: Mat4 = basis([0, 1, 0], [0, 0, 1], [1, 0, 0]);

const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

class Kit {
  readonly g: Geo;
  readonly D: LinDims;
  private cs = new Map<string, CrossSection>();
  constructor(g: Geo, D: LinDims) {
    this.g = g;
    this.D = D;
  }
  section(key: string, polys: () => P2[][]): CrossSection {
    let c = this.cs.get(key);
    if (!c) {
      const list = polys().map((p) => this.g.poly(p));
      c = list.length === 1 ? list[0] : this.g.CS.union(list);
      this.cs.set(key, c);
    }
    return c;
  }
  prism(cs: CrossSection, x0: number, x1: number): Manifold {
    return this.g.place(this.g.extrude(cs, x0, x1), ALONG_X);
  }
  /** Channel section: outer minus chamber, grooves (and the PCB wire channel). Seats are cut by socketCutter. */
  get channel(): CrossSection {
    const D = this.D;
    return this.section('channel', () => [bodyOuter(D)]).subtract(this.section('channelCut', () => [...chamberCut(D), backGroove(D), ...clipGrooves(D), ...(D.strip ? [] : [pcbChannel(D)])]));
  }
  get chamber(): CrossSection {
    const D = this.D;
    return this.section('chamber', () => [...chamberCut(D), ...(D.strip ? [] : [pcbChannel(D)])]);
  }
  /** Strip seat along X from x0 to x1 (socketCutter, so the fit coupon proves it). */
  stripSeat(x0: number, x1: number): Manifold | null {
    const D = this.D;
    if (!D.strip) return null;
    return this.g.place(socketCutter(this.g, D.pixel, { tol: D.tol, length: x1 - x0, over: 0.5 }), T((x0 + x1) / 2, 0, D.zSh));
  }
  /** Key pockets at an end face x0, the part extending toward sgn. */
  pockets(x0: number, sgn: 1 | -1): Manifold[] {
    const D = this.D;
    return [D.key.y, -D.key.y].map((y) => this.g.extrude(this.g.poly(keyPocket(D, x0, sgn, y)), -1, D.key.pocket));
  }
  /** Transverse blades at every pixel boundary of a c-pixel straight, half blades at the ends. */
  blades(section: CrossSection, c: number, x0: number, x1: number): Manifold[] {
    const { pitch, blade } = this.D;
    const full = this.prism(section, -blade / 2, blade / 2);
    const out: Manifold[] = [this.prism(section, x0, x0 + blade / 2), this.prism(section, x1 - blade / 2, x1)];
    for (let j = 1; j < c; j++) out.push(this.g.place(full, T(j * pitch, 0, 0)));
    return out;
  }
}

/* ---------------- Straights ---------------- */

/**
 * Every part that meets another at a seam (straights, joint arms, covers, lids, combs) stops
 * half the fit gap short of it, so neighbours have the full fit gap between them. Pixel
 * positions don't move: the gap comes out of the parts, not the pitch.
 */
function straightBody(k: Kit, c: number): Manifold {
  const { g, D } = k;
  const L = c * D.pitch;
  const body = k.prism(k.channel, D.clr, L - D.clr);
  const cutters: (Manifold | null)[] = [k.stripSeat(-1, L + 1), ...k.pockets(0, 1), ...k.pockets(L, -1)];
  if (!D.strip) {
    const pocket = socketCutter(g, D.pixel, { tol: D.tol, wire: 0 });
    for (let i = 0; i < c; i++) cutters.push(g.place(pocket, T((i + 0.5) * D.pitch, 0, D.zSh)));
  }
  return g.cut(body, cutters);
}

function diffuser(k: Kit, c: number): Manifold {
  const { g, D } = k;
  const L = c * D.pitch;
  const x0 = D.clr;
  const x1 = L - D.clr;
  const cover = k.section('cover', () => coverPieces(D));
  if (D.profile === 'flat') return k.prism(cover, x0, x1);
  const open = k.section('coverOpen', () => coverPieces(D)).subtract(k.section('aperture', () => [apertureCut(D)]));
  if (D.profile === 'dome') {
    const { arch, hollow } = domeArch(D);
    const cs = open.add(k.section('arch', () => [arch]));
    const ends = k.section('hollow', () => [hollow]);
    return g.union([k.prism(cs, x0, x1), k.prism(ends, x0, x0 + 0.8), k.prism(ends, x1 - 0.8, x1)]);
  }
  // Louvered: an open grille, one transverse louver per pixel boundary.
  const blade = k.section('louver', () => [bladeSection(D, D.H + D.td)]);
  return g.union([k.prism(open, x0, x1), ...k.blades(blade, c, x0, x1)]);
}

function comb(k: Kit, c: number): Manifold {
  const { g, D } = k;
  const L = c * D.pitch;
  const rails = k.prism(k.section('rails', () => combRails(D)), D.clr, L - D.clr);
  const blade = k.section('cell', () => [bladeSection(D, D.H - 0.3)]);
  return g.union([rails, ...k.blades(blade, c, D.clr, L - D.clr)]);
}

/* ---------------- Joints ---------------- */

interface ArmGeo {
  /** Placement of the arm frame in the joint frame (x along the arm, z along its face). */
  F: Mat4;
  len: number;
}

/** Arms of a joint in its class frame: planar joints by their gaps, others by their real directions. */
function jointFrame(n: PNode): { frame: Mat4; arms: ArmGeo[] } {
  if (n.planar) {
    const ordered = [...n.order.slice(n.rot), ...n.order.slice(0, n.rot)];
    const gaps = [...n.gaps.slice(n.rot), ...n.gaps.slice(0, n.rot)];
    const x = n.arms[ordered[0]].dir;
    let th = 0;
    const arms = ordered.map((ai, k) => {
      const F = Rz(th);
      th += gaps[k] ?? 0;
      return { F, len: n.arms[ai].len };
    });
    return { frame: frameX(x, n.face, n.pos), arms };
  }
  const x = n.arms[0].dir;
  const z = n.arms[0].face;
  const y = cross(z, x);
  const toLocal = (v: Vec3): Vec3 => [v[0] * x[0] + v[1] * x[1] + v[2] * x[2], v[0] * y[0] + v[1] * y[1] + v[2] * y[2], v[0] * z[0] + v[1] * z[1] + v[2] * z[2]];
  return { frame: frameX(x, z, n.pos), arms: n.arms.map((a) => ({ F: frameX(toLocal(a.dir), toLocal(a.face)), len: a.len })) };
}

function jointBody(k: Kit, n: PNode, arms: ArmGeo[]): Manifold {
  const { g, D } = k;
  const live = arms.filter((a) => a.len > 0.01);
  const deg = n.arms.length;
  const solids: Manifold[] = [g.revolve(hubSolidHalf(D))];
  const cutters: (Manifold | null)[] = [];
  if (deg >= 2) cutters.push(g.revolve(hubCavityHalf(D)), g.cylZ(D.back.w / 2, -1, D.back.d, 0, 0, 24));
  const outer = k.section('outer', () => [bodyOuter(D)]);
  const back = k.section('back', () => [backGroove(D)]);
  // Everything above each arm's wall-top chamfer goes, so where arms overlap the wall tops
  // follow the lower slope and the lid (a union of the same slopes) seats without clashing.
  const vCut = k.section('vcut', () => [
    [
      [-(D.W / 2 + 2), D.H + 2],
      [-D.wc / 2, D.H - D.t],
      [D.wc / 2, D.H - D.t],
      [D.W / 2 + 2, D.H + 2],
      [D.W / 2 + 2, D.H + 20],
      [-(D.W / 2 + 2), D.H + 20],
    ],
  ]);
  for (const a of live) {
    solids.push(g.place(k.prism(outer, 0, a.len - D.clr), a.F));
    const local: (Manifold | null)[] = [k.prism(k.chamber, 0, a.len + 1), k.prism(back, 0, a.len + 1), k.prism(vCut, 0, a.len + 1), k.stripSeat(0, a.len + 1), ...k.pockets(a.len, -1)];
    for (const m of local) if (m) cutters.push(g.place(m, a.F));
  }
  if (n.feed) {
    const at = deg === 1 && live[0] ? g.place(g.cylZ(3.2, -1, D.zSh + 0.5, live[0].len / 2, 0, 24), live[0].F) : g.cylZ(3.2, -1, D.zSh + 0.5, 0, 0, 24);
    cutters.push(at);
  }
  return g.cut(g.union(solids), cutters);
}

function jointLid(k: Kit, arms: ArmGeo[]): Manifold {
  const { g, D } = k;
  const cs = k.section('lid', () => coverPieces(D));
  const parts: Manifold[] = [g.revolve(lidHubHalf(D))];
  for (const a of arms) if (a.len > D.clr + 0.5) parts.push(g.place(k.prism(cs, 0, a.len - D.clr), a.F));
  return g.union(parts);
}

/* ---------------- Clips and keys ---------------- */

function clipSolid(k: Kit): Manifold {
  const { g, D } = k;
  const cable = D.mount === 'cable';
  const cl = 12;
  const ct = 2;
  const cb = cable ? 3 : 2.4;
  // The clip's arms clear the channel by half the fit gap each side. Its lips snap into the
  // clip grooves and stop half a gap short of the groove floor and faces.
  const yIn = D.W / 2 + D.clr;
  const cg = D.clipGroove;
  const zm = (cg.z0 + cg.z1) / 2;
  const lh = (cg.z1 - cg.z0) / 2 - D.clr;
  const top = cg.z1 + 0.8;
  const lip: P2[] = [
    [yIn + 0.01, zm - lh],
    [D.W / 2 - cg.d + D.clr, zm],
    [yIn + 0.01, zm + lh],
  ];
  const lips = k.section('lips', () => [lip, lip.map(([y, z]) => [-y, z] as P2).reverse()]);
  const solid = g.union([
    g.box([-cl / 2, -(yIn + ct), -cb], [cl / 2, yIn + ct, 0]),
    g.box([-cl / 2, yIn, -cb + 0.01], [cl / 2, yIn + ct, top]),
    g.box([-cl / 2, -(yIn + ct), -cb + 0.01], [cl / 2, -yIn, top]),
    k.prism(lips, -cl / 2, cl / 2),
    cable ? g.cylZ(5, -cb - 8, -cb + 0.01, 0, 0, 32) : null,
  ]);
  if (cable) return g.cut(solid, [g.cylZ(2.8, -cb - 9, -cb + 0.2, 0, 0, 24)]);
  return g.cut(solid, [g.cylZ(1.9, -cb - 1, 1, 0, 0, 20), g.coneZ(1.9, 3.9, -2, 0.01)]);
}

/* ---------------- Build ---------------- */

/** Print rotation for a long part: diagonal on the bed when it has to be. */
function bedRot(D: LinDims, length: number): { rot: Mat4; angle: number; fits: boolean } {
  const a = bedAngle(D.bed, length, D.W + 1);
  return { rot: Rz(a ?? 0), angle: a ?? 0, fits: a !== null };
}

export function buildLinea(g: Geo, plan: LineaPlan) {
  const { D } = plan;
  const k = new Kit(g, D);
  const parts: PartSpec<Manifold>[] = [];
  const warnings = [...plan.warnings];
  const face0: Vec3 = plan.edges[0]?.face ?? [0, 0, 1];
  const edgeById = new Map(plan.edges.map((e) => [e.id, e]));

  /* Straights, grouped by pixel count. */
  const byCount = new Map<number, Mat4[]>();
  for (const e of plan.edges) {
    for (const s of straightOffsets(plan, e)) {
      const F = frameX(e.dir, e.face, add(e.A, scale(e.dir, s.at)));
      if (!byCount.has(s.count)) byCount.set(s.count, []);
      byCount.get(s.count)!.push(F);
    }
  }
  const snapNote = `Snaps into the channel: legs ${mm(D.clr)} mm off each wall, barbs ${mm(D.snap)} mm past it.`;
  const coverName = D.profile === 'flat' ? 'Flat diffuser' : D.profile === 'dome' ? 'Dome diffuser' : 'Louver grille';
  for (const [c, frames] of [...byCount.entries()].sort((a, b) => b[0] - a[0])) {
    const L = c * D.pitch;
    const { rot, angle, fits } = bedRot(D, L);
    if (!fits) warnings.push(`A ${fmt(L)} mm straight is longer than the ${D.bed.name} bed; pick a shorter "Longest straight".`);
    const diag = angle > 0 ? ` Laid ${fmt(angle)}° across the bed.` : '';
    const place = (solid: Manifold, printRot: Mat4) => {
      const f = layFlat(g, solid, mul(rot, printRot));
      return { solid: f.solid, instances: frames.map((F) => mul(F, f.instance)) };
    };
    parts.push({
      id: `straight-${c}`,
      name: `Straight ${c} px · ${fmt(L)} mm`,
      role: 'body',
      ...place(straightBody(k, c), T(0, 0, 0)),
      note: `Black. Channel up, no supports.${diag} ${D.strip ? `Strip cut to ${c} px.` : `${c} pixel PCBs in the pockets.`} Bowtie pockets under both ends.`,
    });
    const flip = D.profile === 'dome' ? T(0, 0, 0) : Rx(180);
    parts.push({
      id: `cover-${c}`,
      name: `${coverName} · ${fmt(L - 2 * D.clr)} mm`,
      role: D.profile === 'louvered' ? 'baffle' : 'diffuser',
      ...place(diffuser(k, c), flip),
      explode: face0,
      note:
        D.profile === 'dome'
          ? `Opal PETG, legs down; the crown bridges ${fmt(2 * (D.wc / 2 - D.clr - D.legT))} mm. ${snapNote}${diag}`
          : D.profile === 'flat'
            ? `Opal PETG, face down. ${snapNote}${diag}`
            : `Black, face down: one louver per pixel. ${snapNote}${diag}`,
    });
    if (D.cells) {
      parts.push({
        id: `cells-${c}`,
        name: `Cell comb ${c} px`,
        role: 'baffle',
        ...place(comb(k, c), T(0, 0, 0)),
        explode: scale(face0, 0.5),
        note: `Black. Drops in over the strip: a divider at every pixel boundary.${diag}`,
      });
    }
  }

  /* Joints, one part per class. */
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  for (const c of plan.classes) {
    const rep = nodeById.get(c.rep)!;
    const { arms } = jointFrame(rep);
    const frames = c.members.map((m) => jointFrame(nodeById.get(m)!).frame);
    const armList = arms.map((a) => fmt(a.len)).join('/');
    const body = layFlat(g, jointBody(k, rep, arms), T(0, 0, 0));
    const bb = body.solid.boundingBox();
    const [bx, by] = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]];
    if (!((bx <= D.bed.x && by <= D.bed.y) || (bx <= D.bed.y && by <= D.bed.x))) warnings.push(`${c.label} (${c.members.join(', ')}) is ${fmt(bx)} × ${fmt(by)} mm, too big for the ${D.bed.name}. Open up its sharpest angle.`);
    parts.push({
      id: `joint-${c.id}`,
      name: `${c.label} · ${c.id}`,
      role: 'body',
      solid: body.solid,
      instances: frames.map((F) => mul(F, body.instance)),
      note: `${rep.planar ? 'Black. Channel up, no supports.' : 'Bars from different planes: print with supports.'} Arms ${armList} mm.${rep.feed ? ' Feed hole for the controller cable.' : ''}${rep.angle !== null && rep.kind === 'corner' ? ` Exact ${rep.angle.toFixed(2)}° (catalogue ${rep.nearest}°).` : ''}`,
    });
    if (rep.planar) {
      const lid = layFlat(g, jointLid(k, arms), Rx(180));
      parts.push({
        id: `lid-${c.id}`,
        name: `${c.label} lid · ${c.id}`,
        role: 'body',
        solid: lid.solid,
        instances: frames.map((F) => mul(F, lid.instance)),
        explode: face0,
        note: `Black, face down. Snaps on over the strip jumpers, like the covers.`,
      });
    }
  }

  /* Bowtie keys: two per seam. */
  if (plan.seams.length) {
    const key = g.extrude(g.poly(keyOutline(D)), 0, D.key.thick);
    parts.push({
      id: 'key',
      name: 'Bowtie key',
      role: 'body',
      solid: key,
      instances: plan.seams.flatMap((s) => {
        const side = cross(s.face, s.dir);
        return [D.key.y, -D.key.y].map((y) => frameX(s.dir, s.face, add(s.pos, scale(side, y))));
      }),
      explode: scale(face0, -0.6),
      note: 'Two per seam, from behind. Glue optional.',
    });
  }

  /* Clips. */
  if (plan.clips.length) {
    const cable = D.mount === 'cable';
    const f = layFlat(g, clipSolid(k), cable ? Rx(180) : T(0, 0, 0));
    parts.push({
      id: 'clip',
      name: cable ? 'Aircraft-cable clip' : 'Wall clip',
      role: 'body',
      solid: f.solid,
      instances: plan.clips.map((c) => mul(frameX(c.dir, c.face, c.pos), f.instance)),
      explode: scale(face0, -1),
      note: cable ? 'Arms down; the plate bridges. M4 heat-set insert in the boss for the cable gripper.' : 'Base down. Screw it up first, then press the bar in.',
    });
  }

  /* Pixels and schedule in data order. */
  const pixels: PixelPlacement[] = [];
  const schedule: ScheduleLine[] = [];
  let jumpers = 0;
  let prevTo = '';
  plan.chain.steps.forEach((st) => {
    if (!st.lit || !st.strut) {
      prevTo = '';
      return;
    }
    const e = edgeById.get(st.strut)!;
    for (const p of edgePixels(plan, e, st.from)) pixels.push({ pos: p, normal: e.face, unit: e.id });
    const node = nodeById.get(st.from);
    const through = prevTo === st.from && node && node.arms.some((a) => a.len > 0.01);
    if (through) jumpers++;
    schedule.push({
      unit: e.id,
      position: `${st.from} → ${st.to}`,
      purpose: `Bar ${e.run} · ${e.straights.map((c) => fmt(c * D.pitch)).join(' + ')} mm`,
      pixelId: D.pixel.id,
      units: D.strip ? Math.round(e.k * D.pitch) : e.k,
      px: e.k,
      notes: schedule.length === 0 ? `Data in at ${st.from}.` : through ? `Jumper through ${st.from}.` : prevTo === st.from ? 'Strip runs straight on.' : 'Fed by a return wire.',
    });
    prevTo = st.to;
  });

  const hardware: HardwareLine[] = [];
  if (pixels.length) {
    hardware.push({ item: 'JST-SM 3-pin pigtail', qty: 1, note: `Controller feed at ${plan.feedNode}` });
    hardware.push({ item: 'Rubber grommet Ø6 mm', qty: 1, note: 'Feed hole in the back of the feed joint' });
  }
  if (jumpers) hardware.push({ item: '3-core jumper, 22 AWG, 60 mm', qty: jumpers, note: 'Solder strip end to strip start through each joint' });
  if (plan.chain.darkMm > 0) hardware.push({ item: '3-core flat wire, 22 AWG', qty: Math.ceil((plan.chain.darkMm / 1000) * 1.15 * 10) / 10, note: `Metres. ${plan.chain.darkSteps} return run${plan.chain.darkSteps === 1 ? '' : 's'}, pressed into the back groove.` });
  if (plan.clips.length) {
    if (D.mount === 'cable') {
      hardware.push({ item: 'M4 heat-set insert', qty: plan.clips.length, note: 'In each cable clip boss' });
      hardware.push({ item: 'Aircraft-cable gripper, M4 thread, 1.5 mm cable', qty: plan.clips.length, note: 'One per clip' });
    } else hardware.push({ item: 'Screw #6 / M3.5 × 25 + wall plug', qty: plan.clips.length, note: 'Countersunk into each wall clip' });
  }

  const bodies = idsOf(parts, 'straight-', 'joint-');
  const assembly = steps(parts, [
    plan.clips.length > 0 && {
      title: 'Fix the clips',
      parts: ['clip'],
      hardware: D.mount === 'cable' ? `${plan.clips.length}× M4 heat-set insert + cable gripper` : `${plan.clips.length}× #6 / M3.5 screw + plug`,
      note: D.mount === 'cable' ? 'Set an insert in each clip boss and thread on the gripper.' : 'Screw the clips up along the drawn lines first; the bars press in last.',
    },
    plan.seams.length > 0 && {
      title: 'Key the bars together',
      parts: ['key', ...bodies],
      note: `Lay the straights and joints face down in order and press two bowtie keys across every seam. Each part stops ${mm(D.clr)} mm short of the seam, so neighbours sit ${mm(D.fit)} mm apart and the keys have ${mm(D.fit)} mm across in their pockets.`,
    },
    {
      title: D.strip ? 'Lay the strip' : 'Seat the pixels',
      parts: bodies,
      hardware: jumpers ? `${jumpers}× 60 mm 3-core jumper` : undefined,
      note: `${D.strip ? 'Peel and press the strip into the seat' : 'Press a pixel PCB into each pocket'} (${mm(D.tol)} mm seat clearance), solder jumpers through the joints and press return wires into the back groove.`,
    },
    D.cells && { title: 'Drop in the cell combs', parts: idsOf(parts, 'cells-'), note: 'One divider sits on every pixel boundary.' },
    {
      title: 'Snap on the covers and lids',
      parts: idsOf(parts, 'cover-', 'lid-'),
      note: `Press each cover straight down until the barbs click into the wall grooves. ${mm(D.fit)} mm between covers at each seam.`,
    },
    plan.clips.length > 0 && { title: 'Hang the bars', parts: [...bodies, 'clip'], note: 'Press the finished bars into the clips: the lips snap into the grooves on the outside of the channel.' },
  ]);

  const enclosureCm3 = (plan.stats.px * D.pitch * D.wc * D.depth) / 1000;
  return { parts, pixels, schedule, hardware, warnings, assembly, enclosureCm3: enclosureCm3 || undefined };
}

export const linea: FixtureDef = {
  id: 'linea',
  code: 'M2',
  name: 'Linea',
  family: 'modular',
  tagline: 'Pixel bars drawn as lines: pitch-locked straights, exact-angle corners, T and X joints.',
  description:
    'Draw lines on the bench and they become pixel bars: a black U-channel with a flat, dome or louvered diffuser snapped on top. Every straight is a whole number of pixels; corners, T and X joints are generated at the exact drawn angles and splice to the straights with bowtie keys. Long spans split into catalogue straights that fit your bed.',
  params: LINEA_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    return buildLinea(g, planLinea(design, params));
  },
};
