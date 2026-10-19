import type { CrossSection, Manifold } from 'manifold-3d';
import { str } from '../../fixtures/util';
import { Geo } from '../../geom/geo';
import { mul, Rx, Rz, T } from '../../geom/mat';
import { basis, cross, norm, scale } from '../../geom/vec';
import { socketCutter } from '../../pixels/sockets';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import { fmt, plural } from '../shared/layout';
import { plateOutline, type P2, type PcDims } from './dims';
import { anchorLabel, parseDesign } from './model';
import { PC_PARAMS } from './params';
import { planChain, type PcLink } from './plan';

const SHAPE_NAME = { globe: 'globe', faceted: 'faceted bead', bell: 'bell' } as const;

/** Full symmetric XZ section of the body (profile plus its mirror), for revolving and offsetting. */
function bodySection(g: Geo, d: PcDims): CrossSection {
  const right = d.profile.slice(1, -1);
  const pts: P2[] = [[0, d.zb], ...right, [0, d.apex], ...right.map(([r, z]) => [-r, z] as P2).reverse()];
  return g.poly(pts);
}

/** A vertical plate from an XZ outline, |y| in [y0, y1]. */
function plate(g: Geo, outline: P2[], y0: number, y1: number): Manifold {
  // Extrude along local Z, then Rx(90) turns local Z into −Y and local Y into Z.
  return g.place(g.extrude(g.poly(outline), -y1, -y0), Rx(90));
}

/** Horizontal pin bore along Y with a 45° teardrop roof, so it prints without bridging. */
function pinHole(g: Geo, r: number, x: number, y0: number, y1: number): Manifold {
  const tip = g.rect(0.02, 0.02, x, r * Math.SQRT2 - 0.01);
  const cs = g.CS.hull([g.CS.circle(r, 24).translate([x, 0]), tip]);
  return g.place(g.extrude(cs, -y1, -y0), Rx(90));
}

interface LinkKit {
  outer: Manifold;
  cavity: Manifold;
  neck: Manifold;
  socket: Manifold;
}

function kit(g: Geo, d: PcDims): LinkKit {
  const section = bodySection(g, d);
  const outer = g.M.revolve(section, d.segs);
  const cavity = g.M.revolve(section.offset(-d.wall, 'Miter', 2), d.segs);
  const neck = g.cylZ(d.rNeck, d.zNeckBase - 1, d.zTop, 0, 0, 40);
  // The node drops in from the top, lens down: flip the cutter (face at z=0, body toward −Z).
  const socket = g.place(socketCutter(g, d.pixel, { tol: d.tol, over: 1 }), mul(T(0, 0, d.zFace), Rx(180)));
  return { outer, cavity, neck, socket };
}

/**
 * One link in its own frame (centre at the origin, chain along X, pins along Y at x = ±pitch/2).
 * Anchor links add a bail on top and turn their knuckle by `yaw` for corners.
 */
function linkSolid(g: Geo, d: PcDims, k: LinkKit, pitch: number, anchor: { yaw: number } | null): Manifold {
  const P = pitch / 2;
  const knuckleOutline = plateOutline(d, P);
  const cheekOutline = knuckleOutline.map(([x, z]) => [-x, z] as P2).reverse();
  const yaw = anchor ? Rz(anchor.yaw) : T(0, 0, 0);

  const solids: Manifold[] = [
    k.outer,
    k.neck,
    g.place(plate(g, knuckleOutline, -d.tK / 2, d.tK / 2), yaw),
    plate(g, cheekOutline, d.yc0, d.yc1),
    plate(g, cheekOutline, -d.yc1, -d.yc0),
  ];
  const cutters: Manifold[] = [
    k.cavity,
    k.socket,
    g.place(pinHole(g, d.holeK, P, -d.tK / 2 - 1, d.tK / 2 + 1), yaw),
    pinHole(g, d.holeC, -P, -d.yc1 - 1, d.yc1 + 1),
  ];
  if (anchor) {
    // Bail: a pointed arch over the neck, tall enough to slide the node in under it sideways.
    const { t, wi, wo, zIn, zOut } = d.bail;
    const cs = g
      .poly([
        [-wo, 0],
        [wo, 0],
        [wo, zOut],
        [0, zOut + wo],
        [-wo, zOut],
      ])
      .subtract(
        g.poly([
          [-wi, -1],
          [wi, -1],
          [wi, zIn],
          [0, zIn + wi],
          [-wi, zIn],
        ]),
      );
    solids.push(g.place(g.place(g.extrude(cs, -t / 2, t / 2), Rx(90)), Rz(anchor.yaw / 2)));
  }
  return g.cut(g.union(solids), cutters);
}

/** Printed D-pin lying along X on the bed: flat underside, head at −X. */
function pinSolid(g: Geo, d: PcDims): Manifold {
  const { r, flat, length, headR, headT } = d.pin;
  const cy = r - flat;
  const clip = g.rect(4 * headR, 4 * headR, 0, 2 * headR);
  const shank = g.circle(r, 0, cy).intersect(clip);
  const head = g.circle(headR, 0, cy).intersect(clip);
  const along = basis([0, 1, 0], [0, 0, 1], [1, 0, 0]);
  return g.union([g.place(g.extrude(shank, -length / 2, length / 2), along), g.place(g.extrude(head, -length / 2 - headT, -length / 2 + 0.01), along)]);
}

const linkFrame = (l: PcLink): Mat4 => basis(l.x, l.y, l.z, l.pos);
const turnName = (yaw: number) => (yaw ? `turn ${yaw > 0 ? '+' : '−'}${Math.abs(yaw)}°` : 'straight');

export const pixelChain: FixtureDef = {
  id: 'pixel-chain',
  code: 'M7',
  name: 'Pixel Chain',
  family: 'modular',
  tagline: 'Hinged diffuser links, one node each, draped in catenary garlands.',
  description:
    'Hang anchors on the bench and the chain drapes between them on a true catenary. Every link is a diffuser bead holding one 12 mm node, joined to the next by a knuckle and clevis on a 1.75 mm filament pin. Link pitch is held under the strand lead length, and anchor links carry a bail and turn for corners. Links print upright without supports.',
  params: PC_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    const plan = planChain(design, params);
    const d = plan.dims;
    const warnings = [...plan.warnings];
    const parts: PartSpec<Manifold>[] = [];
    const k = kit(g, d);
    const lift = T(0, 0, -d.zb);
    const back = T(0, 0, d.zb);

    /* ---- Links: one part per (pitch, kind, turn), instanced at every link of that type ---- */
    const groups = new Map<string, { pitch: number; anchor: boolean; yaw: number; links: PcLink[] }>();
    for (const gp of plan.garlands) {
      for (const l of gp.links) {
        if (gp.incomplete) continue;
        const anchor = l.kind === 'anchor';
        const key = `${l.pitch}|${anchor ? `a${l.yaw}` : 'l'}`;
        if (!groups.has(key)) groups.set(key, { pitch: l.pitch, anchor, yaw: l.yaw, links: [] });
        groups.get(key)!.links.push(l);
      }
    }
    const pitches = new Set([...groups.values()].map((x) => x.pitch));
    const sorted = [...groups.values()].sort((a, b) => Number(a.anchor) - Number(b.anchor) || a.pitch - b.pitch || Math.abs(a.yaw) - Math.abs(b.yaw) || a.yaw - b.yaw);
    for (const grp of sorted) {
      const solid = g.place(linkSolid(g, d, k, grp.pitch, grp.anchor ? { yaw: grp.yaw } : null), lift);
      const pitchTag = pitches.size > 1 ? ` · ${fmt(grp.pitch)} mm` : '';
      parts.push({
        id: grp.anchor ? `anchor-${grp.pitch}-${grp.yaw}` : `link-${grp.pitch}`,
        name: grp.anchor ? `Anchor link · ${turnName(grp.yaw)}${pitchTag}` : `Link · ${SHAPE_NAME[d.shape]}${pitchTag}`,
        role: 'diffuser',
        solid,
        instances: grp.links.map((l) => mul(linkFrame(l), back)),
        note: grp.anchor
          ? `Hangs from a hook by its bail. Slide the node in sideways under the bail, then drop it in.${grp.yaw ? ` Knuckle turned ${grp.yaw > 0 ? 'left' : 'right'} ${Math.abs(grp.yaw)}° for the corner.` : ''} Upright, no supports.`
          : `${fmt(grp.pitch)} mm pin to pin. Upright, no supports. Node pushes in from the top, lens down. Translucent PETG, ${fmt(d.wall)} mm wall.`,
      });
    }

    /* ---- Pins ---- */
    const joints = plan.garlands.filter((gp) => !gp.incomplete).flatMap((gp) => gp.joints);
    const hardware: HardwareLine[] = [];
    if (d.hinge === 'printed' && joints.length) {
      const zAxis = d.pin.r - d.pin.flat;
      parts.push({
        id: 'pin',
        name: 'Hinge pin',
        role: 'body',
        solid: pinSolid(g, d),
        instances: joints.map((j) => {
          const up = norm(cross(cross(j.axis, [0, 0, 1]), j.axis));
          const e3: Vec3 = Number.isFinite(up[0]) ? up : [0, 0, 1];
          return mul(basis(j.axis, cross(e3, j.axis), e3, j.pos), T(0, 0, -zAxis));
        }),
        note: `Ø${fmt(2 * d.pin.r)} D-section, prints flat side down. Press through the clevis, head on either side.`,
      });
    } else if (joints.length) {
      const L = d.pin.length + 2;
      hardware.push({ item: `1.75 mm filament pin, ${fmt(L)} mm`, qty: joints.length, note: `${fmt((joints.length * L) / 1000, 2)} m of filament. Mushroom both ends with a hot nozzle.` });
    }

    /* ---- Pixels and schedule, in data order ---- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    let anchors = 0;
    for (const gp of plan.garlands) {
      if (gp.incomplete || !gp.order.length) continue;
      for (const l of gp.order) pixels.push({ pos: l.pos, normal: scale(l.z, -1), unit: gp.id });
      const g0 = design.garlands.find((x) => x.id === gp.id)!;
      anchors += g0.anchors.length;
      const first = gp.order[0];
      const last = gp.order[gp.order.length - 1];
      const ends = `${anchorLabel(first.anchor ?? 0)} → ${anchorLabel(last.anchor ?? 0)}`;
      const splices = plan.splices.filter((s) => s.gid === gp.id).map((s) => `strand ${s.strand} from link ${s.link}`);
      schedule.push({
        unit: gp.id,
        position: `${ends}${g0.closed ? ' (ring)' : ''} · ${plural(gp.spans.length, 'span')}`,
        purpose: `Garland · ${fmt(gp.pitch)} mm links, ${SHAPE_NAME[d.shape]}`,
        pixelId: d.pixel.id,
        units: gp.order.length,
        px: gp.order.length,
        notes: [`Data in at ${anchorLabel(first.anchor ?? 0)}.`, splices.length ? `Splice: ${splices.join(', ')}.` : ''].filter(Boolean).join(' '),
      });
    }

    const lit = schedule.length;
    if (plan.px) hardware.push({ item: `${d.pixel.name} strand, ${d.strand} nodes`, qty: plan.strands, note: plan.strands > 1 ? `Join at ${plan.splices.map((s) => `${s.gid} link ${s.link}`).join(', ')}` : 'One strand covers the design' });
    if (anchors) hardware.push({ item: 'Ceiling hook or S-hook', qty: anchors, note: 'One per anchor link bail' });
    if (lit) hardware.push({ item: 'JST-SM 3-pin pigtail pair', qty: lit, note: 'One per garland, so each unplugs' });
    const ext = plan.jumps.filter((j) => j.mm > d.lead);
    if (ext.length) hardware.push({ item: '3-core extension lead, 22 AWG', qty: Math.ceil((ext.reduce((s, j) => s + j.mm, 0) * 1.2) / 100) / 10, note: `Metres, for ${plural(ext.length, 'jump')} between garlands` });

    const enclosureCm3 = plan.px ? (k.cavity.volume() * plan.px) / 1000 : undefined;
    return { parts, pixels, schedule, hardware, warnings, enclosureCm3 };
  },
};
