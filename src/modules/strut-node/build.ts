import type { Manifold } from 'manifold-3d';
import { layFlat, str } from '../../fixtures/util';
import { Geo } from '../../geom/geo';
import { mul, T } from '../../geom/mat';
import type { FixtureDef, HardwareLine, PartSpec, PixelPlacement, ScheduleLine, Vec3 } from '../../types';
import type { HubClass } from './analyze';
import { add, basis, frameX, frameZ, perp, rotFromTo, rotMat4, scale, sub, parseDesign } from './model';
import { SN_PARAMS, type SnDims } from './params';
import { planDesign, strutPixels } from './plan';

const TEXT_STROKE = 0.6;
const ENGRAVE = 0.5;

/** Engraving slabs wrapped onto the collar cylinder, cached by text. Centred on +X, axial 0. */
function textOnCollar(g: Geo, cache: Map<string, Manifold>, text: string, r: number, h: number): Manifold | null {
  if (!text) return null;
  const hit = cache.get(text);
  if (hit) return hit;
  const flat = g.extrude(g.text(text, h, TEXT_STROKE), -ENGRAVE, 0.8).refineToLength(1);
  const wrapped = flat.warp((v) => {
    const th = v[0] / r;
    const rr = r + v[2];
    const ax = v[1];
    v[0] = rr * Math.cos(th);
    v[1] = rr * Math.sin(th);
    v[2] = ax;
  });
  cache.set(text, wrapped);
  return wrapped;
}

/**
 * One hub, in its representative's frame (centre at the origin, sockets along their real
 * strut vectors). Core sphere, a collar and spigot per socket, then the cutters: wire bores,
 * spine key slots, engraving, the splice cavity, the M3 bolt, dowel holes and the feed bore.
 */
function hubSolid(g: Geo, c: HubClass, dims: SnDims, cache: Map<string, Manifold>): Manifold {
  const R = dims.coreR;
  const off = c.offset;
  const tip = off + dims.insert;
  const { n, h, bolt, pins, feed } = c.split;
  const sp = dims.spine;

  const solids: Manifold[] = [g.M.sphere(R)];
  const cutters: Manifold[] = [];
  // Collar, spigot and lead-in chamfer as one revolved profile: one solid per socket keeps the
  // boolean count (and build time) down. It starts inside the core, clear of the centre.
  const t0 = Math.min(dims.tExit - 2, R * 0.5);
  const profile: [number, number][] = [
    [0, t0],
    [dims.collarR, t0],
    [dims.collarR, off],
    [dims.spigR, off],
    [dims.spigR, tip - 0.8],
    [dims.spigR - 0.8, tip],
    [0, tip],
  ];
  const socket = g.revolve(profile);
  const bore = g.cylZ(dims.wireR, 1.5, tip + 1);
  c.sockets.forEach((so, i) => {
    const F = frameZ(so.dir, c.labelUp[i]);
    solids.push(g.place(socket, F));
    cutters.push(g.place(bore, F));
    if (so.lit) {
      // Key slot: the spine end drops in here, so the strip's roll is fixed by the hub.
      const Fs = frameZ(so.dir, so.face);
      cutters.push(g.place(g.box([sp.fBottom - 0.2, -sp.w / 2 - 0.2, tip - dims.slotDepth], [sp.fBarTop + 0.2, sp.w / 2 + 0.2, tip + 1]), Fs));
    }
    const t1 = off - 1.5 - dims.labelH / 2;
    const t2 = t1 - dims.labelH - 1;
    for (const [text, t] of [
      [so.hubLabel, t1],
      [so.strutLabel, t2],
    ] as [string, number][]) {
      const slab = textOnCollar(g, cache, text, dims.collarR, dims.labelH);
      if (slab) cutters.push(g.place(slab, mul(F, T(0, 0, t))));
    }
  });

  const c0 = scale(n, h);
  const Fn = frameZ(n, perp(n), c0);
  // Splice cavity: a cone in each half, apex up, so its roof is a 45° self-supporting slope.
  cutters.push(g.place(g.coneZ(dims.cavR, 0, 0, dims.cavR), Fn), g.place(g.coneZ(0, dims.cavR, -dims.cavR, 0), Fn));
  if (Math.abs(h) > 0.5) cutters.push(g.place(g.cylZ(dims.wireR, Math.min(0, -h), Math.max(0, -h)), Fn));

  // M3 socket-head bolt along n: counterbore on the + half, captive nut on the − half.
  const Fb = frameZ(n, perp(n), sub(bolt.at, scale(n, h)));
  const half = bolt.span / 2;
  cutters.push(g.place(g.cylZ(1.7, -half - 2, half + 2), Fb));
  cutters.push(g.place(g.cylZ(3.2, half - bolt.counterbore, half + 6), Fb));
  cutters.push(g.place(g.cylZ(3.35, -half - 6, -half + 3.2, 0, 0, 6), Fb));
  for (const p of pins) cutters.push(g.place(g.cylZ(1.6, -6.2, 6.2), frameZ(n, perp(n), p)));
  if (feed) cutters.push(g.place(g.cylZ(4, 0, R + 2), frameZ(feed, perp(feed))));

  return g.cut(g.union(solids), cutters);
}

function tubeSolid(g: Geo, dims: SnDims, length: number): Manifold {
  return g.tubeZ(dims.tubeR, dims.tubeIR, 0, length);
}

/** Spine lying along X on the bed: bar with the strip recess (or node trough) up, wire channel down. */
function spineSolid(g: Geo, dims: SnDims, length: number): Manifold {
  const sp = dims.spine;
  const barH = sp.fBarTop - sp.fBottom;
  let cs = g.rect(sp.w, barH, 0, barH / 2);
  if (sp.kind === 'strip') cs = cs.subtract(g.rect(sp.recessW, sp.recessD + 1, 0, barH - sp.recessD + 0.5));
  else cs = cs.subtract(g.circle(sp.troughR, 0, sp.troughF - sp.fBottom));
  cs = cs.subtract(g.rect(sp.grooveW, sp.grooveD + 1, 0, sp.grooveD / 2 - 0.5));
  // Profile is in (side, up); extrude along Z then turn so the extrusion runs along X.
  return g.place(g.extrude(cs, -length / 2, length / 2), basis([0, 1, 0], [0, 0, 1], [1, 0, 0]));
}

/** Joins tube segments: a plug for both tube ends with a stop ridge flush with the tube. */
function couplerSolid(g: Geo, dims: SnDims): Manifold {
  const { ins, ridge, plugR, boreR } = dims.coupler;
  const step = dims.tubeR - plugR;
  const body = g.union([g.cylZ(plugR, 0, 2 * ins + ridge), g.coneZ(plugR, dims.tubeR, ins - step, ins), g.cylZ(dims.tubeR, ins, ins + ridge)]);
  return body.subtract(g.cylZ(boreR, -1, 2 * ins + ridge + 1));
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toFixed(Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1);

export const strutNode: FixtureDef = {
  id: 'strut-node',
  code: 'M4',
  name: 'Strut & Node',
  family: 'modular',
  tagline: 'Draw a wireframe. Every hub is generated at its exact socket angles.',
  description:
    'Place hubs and connect them with struts on the bench. Each hub gets one spigot per strut, aimed down the real strut vector, then splits in two so both halves print without supports. Struts are diffuser tubes over a strip spine, cut to length and split at couplers when taller than your printer.',
  params: SN_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    const { dims, an, chain } = planDesign(design, params);
    const warnings = [...an.warnings];
    const parts: PartSpec<Manifold>[] = [];
    const hubPos = new Map(an.hubs.map((h) => [h.id, h]));
    const cache = new Map<string, Manifold>();

    /* ---- Hubs: one solid per class, two halves, an instance per member ---- */
    const hardware: HardwareLine[] = [];
    const bolts = new Map<number, number>();
    let pinCount = 0;
    for (const c of an.classes) {
      const solid = hubSolid(g, c, dims, cache);
      const [upper, lower] = solid.splitByPlane(c.split.n, c.split.h);
      const halves: [Manifold, Vec3, string][] = [
        [upper, c.split.n, 'A'],
        [lower, scale(c.split.n, -1), 'B'],
      ];
      for (const [half, up, tag] of halves) {
        const flat = layFlat(g, half, rotMat4(rotFromTo(up, [0, 0, 1])));
        parts.push({
          id: `hub-${c.id}-${tag}`,
          name: `Hub ${c.id} · half ${tag}`,
          role: 'body',
          solid: flat.solid,
          instances: c.members.map((m) => {
            const hub = hubPos.get(m)!;
            return mul(T(...hub.pos), rotMat4(hub.rot), flat.instance);
          }),
          note:
            tag === 'A'
              ? `${c.sockets.length} socket${c.sockets.length === 1 ? '' : 's'}, offset ${fmt(c.offset)} mm. Cut face down. M3×${c.split.bolt.length} from this side.${c.controller ? ' Controller hub: feed bore.' : ''}`
              : `Cut face down. Nut trap side.${c.split.supportFree ? '' : ` Overhang ${c.split.overhangDeg.toFixed(0)}°: use supports.`}`,
        });
      }
      bolts.set(c.split.bolt.length, (bolts.get(c.split.bolt.length) ?? 0) + c.members.length);
      pinCount += c.split.pins.length * c.members.length;
    }

    /* ---- Struts: tube segments, spine segments, couplers ---- */
    let couplers = 0;
    const strutById = new Map(an.struts.map((s) => [s.id, s]));
    for (const t of an.types) {
      const members = t.members.map((id) => strutById.get(id)!);
      const tube = tubeSolid(g, dims, t.tubeSegLen);
      parts.push({
        id: `tube-${t.id}`,
        name: `${t.dark ? 'Dark tube' : 'Tube'} ${t.id} · ${fmt(t.tubeSegLen)} mm${t.tubeSegs > 1 ? ` (1 of ${t.tubeSegs})` : ''}`,
        role: t.dark ? 'body' : 'diffuser',
        solid: tube,
        instances: members.flatMap((s) => {
          const A = hubPos.get(s.a)!.pos;
          return Array.from({ length: t.tubeSegs }, (_, k) => frameZ(s.dir, s.face, add(A, scale(s.dir, s.offA + k * (t.tubeSegLen + dims.coupler.ridge)))));
        }),
        note: `${t.dark ? 'Opaque, wire only.' : 'Spiral vase mode,'} ${fmt(dims.wall)} mm wall, no top or bottom. Cut length ${fmt(t.cut)} mm.`,
      });
      if (t.tubeSegs > 1) {
        couplers += (t.tubeSegs - 1) * members.length;
      }
      if (!t.dark) {
        const segLen = t.spineSegLen - (t.spineSegs > 1 ? 0.3 : 0);
        parts.push({
          id: `spine-${t.id}`,
          name: `Spine ${t.id} · ${fmt(segLen)} mm${t.spineSegs > 1 ? ` (1 of ${t.spineSegs})` : ''}`,
          role: 'body',
          solid: spineSolid(g, dims, segLen),
          instances: members.flatMap((s) => {
            const A = hubPos.get(s.a)!.pos;
            const start = s.offA + dims.insert - dims.slotDepth + 0.5;
            return Array.from({ length: t.spineSegs }, (_, k) =>
              frameX(s.dir, s.face, add(add(A, scale(s.dir, start + k * t.spineSegLen + segLen / 2)), scale(s.face, dims.spine.fBottom))),
            );
          }),
          note: `${t.px} px. ${dims.spine.kind === 'strip' ? 'Strip in the top recess' : 'Nodes in the trough'}, return wire in the channel underneath. Ends key into the spigots.`,
        });
      }
    }
    if (couplers) {
      const { ins, ridge } = dims.coupler;
      const inst: number[][] = [];
      for (const t of an.types) {
        if (t.tubeSegs < 2) continue;
        for (const id of t.members) {
          const s = strutById.get(id)!;
          const A = hubPos.get(s.a)!.pos;
          for (let k = 0; k < t.tubeSegs - 1; k++) {
            const ridgeAt = s.offA + (k + 1) * t.tubeSegLen + k * ridge;
            inst.push(frameZ(s.dir, s.face, add(A, scale(s.dir, ridgeAt - ins))));
          }
        }
      }
      parts.push({ id: 'coupler', name: 'Spigot coupler', role: 'diffuser', solid: couplerSolid(g, dims), instances: inst, note: 'Joins split tubes. Prints standing; the ridge is chamfered underneath.' });
    }

    /* ---- Pixels and schedule follow the data path ---- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const pitch = dims.pixel.shape.kind === 'strip' ? dims.pixel.shape.pitch : 0;
    for (const run of chain.lit) {
      const s = strutById.get(run.strut)!;
      const pts = strutPixels(dims, s, hubPos.get(run.from)!.pos, hubPos.get(run.to)!.pos, run.from === s.a);
      if (!pts.length) continue;
      for (const p of pts) pixels.push({ pos: p, normal: s.face, unit: s.id });
      schedule.push({
        unit: s.id,
        position: `${run.from} → ${run.to}`,
        purpose: `Strut ${s.typeId} · ${fmt(s.cut)} mm`,
        pixelId: dims.pixel.id,
        units: pitch ? Math.round(pts.length * pitch) : pts.length,
        px: pts.length,
        notes: s.flip ? `Flipped: DIN at ${run.from}, return wire through the spine.` : '',
      });
    }

    const hubs = an.hubs.length;
    for (const [L, q] of [...bolts.entries()].sort((a, b) => a[0] - b[0])) hardware.push({ item: `M3×${L} socket head screw`, qty: q, note: 'One per hub, through both halves' });
    if (hubs) hardware.push({ item: 'M3 hex nut', qty: hubs, note: 'Captive in half B' });
    if (pinCount) hardware.push({ item: 'Ø3×10 mm dowel pin', qty: pinCount, note: 'Two per hub. A 3 mm filament offcut works.' });
    const litStruts = an.struts.filter((s) => !s.dark && s.px > 0).length;
    if (litStruts) hardware.push({ item: 'JST-SM 3-pin pigtail pair', qty: litStruts, note: 'One per lit strut, so struts unplug for service' });
    const wireM = (chain.darkMm + an.struts.reduce((sum, s) => sum + s.length, 0) * 0.15) / 1000;
    if (chain.darkSteps || chain.jumps) hardware.push({ item: '3-core hookup wire, 22 AWG', qty: Math.ceil(wireM * 1.1 * 10) / 10, note: `Metres. Covers ${chain.darkSteps} dark run${chain.darkSteps === 1 ? '' : 's'} plus splices.` });
    if (an.classes.some((c) => c.controller)) hardware.push({ item: 'Cable grommet Ø8 mm', qty: 1, note: 'Feed into the controller hub' });

    if (chain.jumps) warnings.push(`The design is in ${chain.jumps + 1} separate pieces. The data path jumps between them on a free wire.`);
    const enclosure = an.struts.filter((s) => !s.dark).reduce((v, s) => v + Math.PI * dims.tubeIR ** 2 * s.litLength, 0) / 1000;

    return { parts, pixels, schedule, hardware, warnings, enclosureCm3: enclosure || undefined };
  },
};
