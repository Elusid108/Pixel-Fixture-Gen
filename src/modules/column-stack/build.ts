import type { Manifold } from 'manifold-3d';
import { str } from '../../fixtures/util';
import { Geo } from '../../geom/geo';
import { mul, T } from '../../geom/mat';
import { psuFor } from '../../schedule/schedule';
import type { FixtureDef, HardwareLine, Mat4, MaterialRole, PartSpec, PixelPlacement, ScheduleLine } from '../../types';
import { idsOf, mm, steps } from '../shared/assembly';
import { fmt } from '../shared/layout';
import { baySolid, bandCarrierSolid, canopySolid, capSolid, hangerSolid, jewelCarrierSolid, plateSolid, segmentSolid } from './geometry';
import { CAPS, KINDS, parseDesign } from './model';
import { CS_PARAMS } from './params';
import { planColumns, type SegPlan } from './plan';

const NOTES: Record<SegPlan['kind'], string> = {
  helix: 'Upright, no supports. Press the dots into the seats from inside, chain them along the helix.',
  band: 'Natural PETG, upright. The ring carrier drops in from below and is trapped by the spigot under it.',
  lattice: 'Upright, no supports: windows are steeper than 45° and the core hangs on 45° spokes. Strip runs on the core faces.',
  louver: 'Upright, no supports: louvers slope at 45° or steeper. Dots press into the core, one per cell.',
  ring: 'Upright, no supports. Nodes push through from outside; the strand runs inside the shell.',
};

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_');

/**
 * M6 Column Stack. Segments of one diameter stack on a base or hang from a canopy; identical
 * segments print as one part ×N. Pixels and schedule lines follow the data path: up each
 * stack from its base (or down from its canopy), segment by segment, stacks in order.
 */
export const columnStack: FixtureDef = {
  id: 'column-stack',
  code: 'M6',
  name: 'Column Stack',
  family: 'modular',
  tagline: 'Stackable lit column segments on a PSU base, or hung as chandelier drops.',
  description:
    'Every segment shares one diameter and one keyed joint: a spigot with a key rib slides into the socket above and two M3 self-tappers lock it, so segments stack in any order and pixel rows line up. A central wire chase runs from the base (PSU and controller bay) or the ceiling canopy through every segment to the cap.',
  params: CS_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    const plan = planColumns(design, params);
    const d = plan.dims;
    const warnings = [...plan.warnings];

    /* ---- Parts, built once per distinct shape, instanced per use ---- */
    const parts = new Map<string, PartSpec<Manifold>>();
    const use = (id: string, make: () => { solid: Manifold; name: string; role: MaterialRole; note?: string; local?: Mat4 }, at: Mat4) => {
      let p = parts.get(id) as (PartSpec<Manifold> & { local?: Mat4 }) | undefined;
      if (!p) {
        const m = make();
        p = { id, name: m.name, role: m.role, solid: m.solid, instances: [], note: m.note, local: m.local };
        parts.set(id, p);
      }
      p.instances.push(p.local ? mul(at, p.local) : at);
    };

    let plate: ReturnType<typeof plateSolid> | null = null;
    for (const st of plan.stacks) {
      const [x, y, z] = st.pos;
      if (st.mount === 'floor') {
        use('base-bay', () => ({ solid: baySolid(g, d), name: `Base bay · Ø${fmt(2 * d.baseR)}`, role: 'body', note: 'Upright, open side down. 45° shoulder, teardrop gland hole: no supports. Melt 4 M3 inserts into the bosses.' }), T(x, y, z + d.bayZ));
        plate ??= plateSolid(g, d);
        const pl = plate;
        use('base-plate', () => ({ solid: pl.solid, name: 'Base bottom plate', role: 'body', note: 'Prints feet up. Cable-tie the PSU and controller to it, then screw it on with 4 M3 countersunk screws.', local: pl.instance }), T(x, y, z));
      } else {
        use('canopy', () => ({ solid: canopySolid(g, d), name: `Ceiling canopy · Ø${fmt(2 * d.canopyR)}`, role: 'body', note: 'Upright. Holds the controller; two M4 screws through the tubes into a ceiling crossbar.' }), T(x, y, z - d.canopyH));
        use('hanger', () => ({ solid: hangerSolid(g, d), name: 'Drop hanger', role: 'body', note: 'Spigot up on the bed. An M10×1 lamp nipple through the centre carries the column and its cable.' }), mul(st.frame, T(0, 0, -d.hangerT)));
      }
      for (const s of st.segs) {
        const k = KINDS[s.kind];
        use(
          `seg-${safeId(s.key)}`,
          () => ({ solid: segmentSolid(g, d, s), name: `${k.name} · ${fmt(s.h)} mm · ${s.detail}`, role: s.kind === 'band' ? 'diffuser' : 'body', note: NOTES[s.kind] }),
          mul(st.frame, T(0, 0, s.z0)),
        );
        if (s.layout.kind === 'band') {
          const sb = s as SegPlan & { layout: { kind: 'band' } };
          use('band-carrier', () => ({ solid: bandCarrierSolid(g, d, sb), name: `Ring carrier · ${d.ring.name}`, role: 'body', note: 'Flat on the bed, funnel up (45°). White PLA reflects best.' }), mul(st.frame, T(0, 0, s.z0 + d.J)));
        }
      }
      const c = st.cap;
      use(
        `cap-${c.kind}`,
        () => {
          const cs = capSolid(g, d, c);
          return { solid: cs.solid, name: `${CAPS[c.kind].name} cap`, role: c.kind === 'finial' ? 'body' : 'diffuser', note: cs.note, local: cs.local };
        },
        mul(st.frame, T(0, 0, c.z0)),
      );
      if (c.px) use('jewel-carrier', () => ({ solid: jewelCarrierSolid(g, d), name: `Jewel carrier · ${d.jewel.name}`, role: 'body', note: 'Flat on the bed. Rests on the last spigot inside the cap.' }), mul(st.frame, T(0, 0, c.z0 + d.J)));
    }

    /* ---- Pixels and schedule, in data order ---- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const byStack = new Map(plan.stacks.map((s) => [s.id, s]));
    let prevStack = '';
    for (const u of plan.units) {
      const st = byStack.get(u.stackId)!;
      for (const s of u.spots) pixels.push({ pos: s.pos, normal: s.normal, unit: u.unit });
      const seg = u.segId ? st.segs.find((s) => s.id === u.segId) : null;
      const where = st.mount === 'floor' ? 'up from the base' : 'down from the canopy';
      const notes: string[] = [];
      if (u.stackId !== prevStack && prevStack) notes.push(`Data in from ${byStack.get(prevStack)!.label} on a 3-core link.`);
      if (seg?.kind === 'lattice') notes.push(`${seg.n} runs, serpentine; jumpers through the core.`);
      if (seg?.kind === 'ring') notes.push('Rows alternate direction.');
      prevStack = u.stackId;
      schedule.push({
        unit: u.unit,
        position: seg ? `${st.label} · segment ${seg.index + 1} of ${st.segs.length}, ${where}` : `${st.label} · cap`,
        purpose: seg ? `${KINDS[seg.kind].name} · ${u.detail}` : `${CAPS[st.cap.kind].name} · ${u.detail}`,
        pixelId: u.pixel.id,
        units: u.units,
        px: u.px,
        notes: notes.join(' '),
      });
    }

    /* ---- Hardware ---- */
    const hardware: HardwareLine[] = [];
    const floors = plan.stacks.filter((s) => s.mount === 'floor');
    const hangs = plan.stacks.filter((s) => s.mount === 'hang');
    const joints = plan.stacks.reduce((n, s) => n + s.segs.length + 1, 0);
    if (joints) hardware.push({ item: 'M3×8 pan-head self-tapping screw', qty: 2 * joints, note: 'Two per joint, through the socket into the spigot' });
    if (plan.stacks.length) hardware.push({ item: 'WLED controller (ESP32)', qty: 1, note: `In ${plan.stacks[0].label}'s ${plan.stacks[0].mount === 'floor' ? 'base' : 'canopy'}${plan.stacks.length > 1 ? '; data chains on to the other stacks' : ''}` });
    if (floors.length) {
      hardware.push({ item: 'M3 heat-set insert', qty: 4 * floors.length, note: 'Bay bosses, for the bottom plate' });
      hardware.push({ item: 'M3×8 countersunk screw', qty: 4 * floors.length, note: 'Bottom plate' });
      hardware.push({ item: 'PG7 cable gland', qty: floors.length, note: 'Mains or DC lead into the bay' });
      const psus = new Map<string, number>();
      for (const s of floors) {
        const byVolts = new Map<number, number>();
        for (const u of plan.units) if (u.stackId === s.id) byVolts.set(u.pixel.volts, (byVolts.get(u.pixel.volts) ?? 0) + u.px * u.pixel.wattsPerPx);
        if (!byVolts.size) byVolts.set(5, 0);
        for (const [v, w] of byVolts) {
          const key = `${v} V PSU, ${psuFor(Math.max(5, w))} W`;
          psus.set(key, (psus.get(key) ?? 0) + 1);
        }
      }
      for (const [item, qty] of psus) hardware.push({ item, qty, note: 'In the bay, sized for the stack at full white' });
    }
    if (hangs.length) {
      hardware.push({ item: 'M10×1 hollow lamp nipple, 20 mm, with nut', qty: hangs.length, note: 'Through the hanger; the cable runs inside' });
      hardware.push({ item: 'M10×1 loop nut', qty: hangs.length, note: 'On the nipple, takes the suspension cable' });
      const cable = hangs.reduce((m, s) => m + s.drop + 150, 0) / 1000;
      hardware.push({ item: 'Ø1.5 mm aircraft cable with gripper', qty: Math.ceil(cable * 10) / 10, note: `Metres. Drops of ${hangs.map((s) => fmt(s.drop)).join(' / ')} mm plus loops` });
      hardware.push({ item: 'PG7 cord grip', qty: hangs.length, note: 'Canopy centre hole' });
      hardware.push({ item: 'Ceiling hook + crossbar', qty: hangs.length, note: 'Rated for the drop; the canopy covers it' });
      hardware.push({ item: 'M4×40 screw', qty: 2 * hangs.length, note: 'Canopy to crossbar' });
    }
    if (plan.units.length) hardware.push({ item: 'JST-SM 3-pin pigtail pair', qty: plan.units.length, note: 'One per lit segment and cap, so the column comes apart' });
    const wire = plan.stacks.reduce((m, s) => m + s.colTop + (s.mount === 'hang' ? s.drop : 0) + 300, 0);
    let link = 0;
    for (let i = 1; i < plan.stacks.length; i++) link += Math.hypot(plan.stacks[i].pos[0] - plan.stacks[i - 1].pos[0], plan.stacks[i].pos[1] - plan.stacks[i - 1].pos[1]) + 500;
    if (wire) hardware.push({ item: '3-core hookup wire, 22 AWG', qty: Math.ceil(((wire + link) / 1000) * 1.2 * 10) / 10, note: `Metres: up the chase of each stack${link ? ' plus links between stacks' : ''}` });

    if (!plan.stacks.length) warnings.push('The bench is empty. Use the Stack tool (T) or a preset.');

    // Enclosed air around the emitters: closed shells and the lit caps.
    const closed = plan.stacks.reduce(
      (v, s) => v + s.segs.filter((x) => x.kind !== 'lattice' && x.kind !== 'louver').reduce((a, x) => a + Math.PI * d.Ri * d.Ri * x.h, 0) + (s.cap.px ? Math.PI * d.Ri * d.Ri * s.cap.h * 0.6 : 0),
      0,
    );

    const built = [...parts.values()].map(({ local: _l, ...p }: PartSpec<Manifold> & { local?: Mat4 }) => p);
    const segs = idsOf(built, 'seg-');
    const assembly = steps(built, [
      floors.length > 0 && {
        title: 'Fit out the base',
        parts: ['base-bay', 'base-plate'],
        hardware: `${4 * floors.length}× M3 heat-set insert, ${4 * floors.length}× M3×8 countersunk, PG7 gland, PSU, controller`,
        note: 'Melt the inserts into the bay bosses, cable-tie the PSU and controller to the plate, fit the gland, then screw the plate on.',
      },
      hangs.length > 0 && {
        title: 'Hang the canopy and hanger',
        parts: ['canopy', 'hanger'],
        hardware: `${hangs.length}× M10×1 lamp nipple + loop nut, PG7 cord grip, ${2 * hangs.length}× M4×40`,
        note: 'Screw the canopy to the ceiling crossbar and hang each drop on its cable through the hanger.',
      },
      {
        title: 'Load the segments',
        parts: [...segs, 'band-carrier', 'jewel-carrier'],
        note: `Seat the pixels (${mm(d.tol)} mm seat clearance) and fit a pigtail pair to each lit segment. Ring and jewel carriers drop into the bore with ${mm(d.fit)} mm across, tab in the key slot.`,
      },
      {
        title: 'Stack the column',
        parts: [...idsOf(built, 'base-bay', 'hanger'), ...segs],
        hardware: joints ? `${2 * joints}× M3×8 self-tapper` : undefined,
        note: `Each spigot is ${mm(d.fit)} mm under the socket bore and the key slot ${mm(d.fit)} mm wider than its rib: slide the next segment on rib to slot, plug the pigtails through the chase and drive two self-tappers through the socket into the spigot.`,
      },
      {
        title: 'Cap it',
        parts: [...idsOf(built, 'cap-'), 'jewel-carrier'],
        hardware: '2× M3×8 self-tapper per cap',
        note: 'Lit caps: rest the jewel carrier on the last spigot first; the cap ridge traps it.',
      },
    ]);

    return {
      parts: built,
      assembly,
      pixels,
      schedule,
      hardware,
      warnings,
      enclosureCm3: closed ? closed / 1000 : undefined,
    };
  },
};
