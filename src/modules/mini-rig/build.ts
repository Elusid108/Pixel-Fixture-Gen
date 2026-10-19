import type { Manifold } from 'manifold-3d';
import { str } from '../../fixtures/util';
import { Geo } from '../../geom/geo';
import { mul, T } from '../../geom/mat';
import { add, basis, cross, dist, rotMat4, scale } from '../../geom/vec';
import type { FixtureDef, HardwareLine, Mat4, PartSpec, PixelPlacement, ScheduleLine } from '../../types';
import { idsOf, mm, steps } from '../shared/assembly';
import { fmt, plural } from '../shared/layout';
import { bodyPoint, CLAMP, YOKE, type Frame, type InstDims } from './instruments';
import { KINDS, parseDesign, SIDE_LABEL, type InstrumentKind } from './model';
import { RIG_PARAMS } from './params';
import { baseSolid, blockSolid, hoistSolid, HOIST, blinderBody, battenBody, battenDiffuser, clampSolid, couplerSolid, lensSolid, moverBase, moverHead, parBody, pickSolid, sectionSolid, yokeSolid } from './parts';
import { planRig, type InstInfo } from './plan';

const M = (f: Frame): Mat4 => basis(f.x, f.y, f.z, f.o);

export const miniRig: FixtureDef = {
  id: 'mini-rig',
  code: 'M3',
  name: 'Mini Rig',
  family: 'modular',
  tagline: '1:6 F34 box truss with clip-on instruments. Build your rig on your desk.',
  description:
    'Draw truss runs on the bench. Each span is cut into 1:6 F34 sections that print standing, support-free, and join at 48 mm corner blocks with hollow couplers and M3 bolts. Clip PARs, blinders, movers and battens onto the chords; the wiring runs inside the chords and the instruments patch in order along the rig.',
  params: RIG_PARAMS,
  build(ctx, params) {
    const g = new Geo(ctx);
    const design = parseDesign(str(params, 'design'));
    const plan = planRig(design, params);
    const d = plan.dims;
    const W = d.W;
    const parts: PartSpec<Manifold>[] = [];
    const hardware: HardwareLine[] = [];
    const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));

    /* ---- Truss sections, by length ---- */
    for (const grp of plan.sectionGroups) {
      const instances: Mat4[] = [];
      for (const s of plan.spans)
        for (const sec of s.sections) if (sec.len.toFixed(1) === grp.key) instances.push(basis(s.frame.up, s.frame.front, s.frame.d, add(s.A, scale(s.frame.d, sec.start))));
      parts.push({
        id: `section-${grp.key}`,
        name: `Truss section · ${grp.label}`,
        role: 'body',
        solid: sectionSolid(g, d, grp.len),
        instances,
        note: `Print standing on an end frame, no supports: the lacing rises at 45° or steeper and the top frame bridges between the chords. Chords Ø${fmt(d.chordD)} with a Ø${fmt(2 * d.boreR)} wire bore.`,
      });
    }
    const { sectionSection, sectionBlock } = plan.joints;
    if (sectionSection) {
      const inst: Mat4[] = [];
      const h = d.c / 2;
      for (const s of plan.spans)
        for (const sec of s.sections.slice(1))
          for (const [x, y] of [
            [h, -h],
            [h, h],
            [-h, h],
            [-h, -h],
          ])
            inst.push(basis(s.frame.up, s.frame.front, s.frame.d, add(add(add(s.A, scale(s.frame.d, sec.start - d.couplerLen / 2)), scale(s.frame.up, x)), scale(s.frame.front, y))));
      parts.push({ id: 'coupler', name: 'Chord coupler', role: 'body', solid: couplerSolid(g, d), instances: inst, note: `Four per section joint, half in each chord, ${mm(d.fit)} mm under the socket Ø and ${mm(d.side)} mm short of each socket floor. Hollow: the wiring runs through. Print standing.` });
    }

    /* ---- Corner blocks, by face set up to rotation ---- */
    for (const grp of plan.blockGroups) {
      const members = grp.members.map((id) => nodeById.get(id)!);
      const first = members[0];
      parts.push({
        id: `block-${grp.classKey}`,
        name: `Corner block · ${grp.label}`,
        role: 'body',
        solid: blockSolid(g, d, grp.classKey).translate([0, 0, W / 2]),
        instances: members.map((n) => mul(basis(n.axes[0], n.axes[1], n.axes[2], n.pos), rotMat4(n.classRot), T(0, 0, -W / 2))),
        note: `${first.label}. Print on a plain face if it has one; the wire chamber is self-supporting on any face. Press 2 M3 heat-set inserts per used face (opposite holes).`,
      });
    }
    const bases = plan.nodes.filter((n) => n.base && n.spans.length);
    if (bases.length)
      parts.push({
        id: 'base-plate',
        name: 'Base plate',
        role: 'body',
        solid: baseSolid(g, d),
        instances: bases.map((n) => basis(n.axes[0], n.axes[1], n.axes[2], add(n.pos, [0, 0, -W / 2 - d.baseT]))),
        note: `1:6 of a 600 mm F34 base. Print flat. Countersunk M3 from below into the block; the feed cable comes up the centre from the channel underneath.`,
      });
    const picks = plan.nodes.filter((n) => n.pick && n.spans.length);
    if (picks.length)
      parts.push({
        id: 'pick-eye',
        name: 'Pick-point eye',
        role: 'body',
        solid: pickSolid(g, d),
        instances: picks.map((n) => basis(n.axes[0], n.axes[1], n.axes[2], add(n.pos, [0, 0, W / 2]))),
        note: 'Print flat, eye up: the teardrop eye needs no support. Two M3×8 into the block top. Hang it from a shelf with cord or a mini chain.',
      });
    if (picks.length && d.hoists) {
      // Pick eye: 3 mm plate, eye centre 11 mm up, 7 mm radius tab.
      const eyeTop = W / 2 + 3 - 0.5 + 11;
      parts.push({
        id: 'hoist',
        name: 'Mini chain hoist',
        role: 'body',
        solid: hoistSolid(g),
        instances: picks.map((n) => {
          const z = eyeTop + HOIST.gap - HOIST.bottomEye;
          const x = n.axes[0];
          const up: [number, number, number] = [0, 0, 1];
          return mul(basis(x, up, cross(x, up), add(n.pos, [0, 0, z])), T(0, 0, -HOIST.t / 2));
        }),
        note: 'Display piece. Print lying on its side. Cord through the top eye to the shelf; ball chain from the bottom eye to the pick eye.',
      });
    }

    /* ---- Instruments: identical pieces print once ×N ---- */
    const byKind = new Map<InstrumentKind, InstInfo[]>();
    for (const i of plan.instruments) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
    if (plan.instruments.length) {
      const id0 = plan.instruments[0].dims;
      parts.push({
        id: 'clamp',
        name: 'Snap clamp',
        role: 'body',
        solid: clampSolid(g, id0, d.chordD),
        instances: plan.instruments.map((i) => mul(M(i.pose.clamp), T(0, 0, -CLAMP.h / 2))),
        note: `Snaps over a Ø${fmt(d.chordD)} chord between the lacing; the opening faces into the truss so the load hangs on the closed side. Bore is the chord plus the ${mm(d.fit)} mm fit gap; the narrow opening is the snap. Print flat.`,
      });
    }
    const label = (k: InstrumentKind) => KINDS[k].label;
    for (const [kind, list] of byKind) {
      const id: InstDims = list[0].dims;
      parts.push({
        id: `yoke-${kind}`,
        name: `${label(kind)} yoke`,
        role: 'body',
        solid: yokeSolid(g, id),
        instances: list.map((i) => mul(M(i.pose.yoke), T(0, 0, -YOKE.h / 2))),
        note: `Print flat. M3×${id.panScrew} pan screw through the bar${kind === 'mover' ? ' and the base' : ''} into the clamp stem; M3×${id.tiltScrew} tilt screws through the arms.`,
      });
      const bodyAt = (i: InstInfo) => mul(M(i.pose.body), T(0, 0, -id.zT));
      if (kind === 'par') {
        parts.push({ id: 'par-can', name: 'PAR can', role: 'body', solid: parBody(g, id, d), instances: list.map(bodyAt), note: 'Print standing on its back. The jewel seats in the back cap; its tail leaves through the centre hole.' });
        const lz = id.par!.L - 1.2;
        parts.push({ id: 'par-lens', name: 'PAR lens', role: 'diffuser', solid: lensSolid(g, id.par!.lensR, d.fit), instances: list.map((i) => mul(bodyAt(i), T(0, 0, lz))), note: `Natural PETG, 1 mm, ${mm(d.fit)} mm under the mouth Ø. Drop into the mouth of the can and fix with a dot of clear glue.` });
      } else if (kind === 'mover') {
        parts.push({ id: 'mover-base', name: 'Mover base', role: 'body', solid: moverBase(g, id), instances: list.map((i) => M(i.pose.base!)), note: 'Print flat. Sits between the clamp and the yoke; the pan screw passes through.' });
        parts.push({ id: 'mover-head', name: 'Mover head', role: 'body', solid: moverHead(g, id, d), instances: list.map(bodyAt), note: 'Print standing on its back. Jewel under the lens; tail out of the back.' });
        const lz = id.mover!.H - 1.2;
        parts.push({ id: 'mover-lens', name: 'Mover lens', role: 'diffuser', solid: lensSolid(g, id.mover!.lensR, d.fit), instances: list.map((i) => mul(bodyAt(i), T(0, 0, lz))), note: `Natural PETG, 1 mm, ${mm(d.fit)} mm under the mouth Ø. Drop into the front of the head and fix with a dot of clear glue.` });
      } else if (kind === 'blinder2' || kind === 'blinder4') {
        parts.push({
          id: `${kind}-body`,
          name: `${label(kind)} housing`,
          role: 'body',
          solid: blinderBody(g, id, d),
          instances: list.map(bodyAt),
          note: `Print face up: the reflector cups open upward. ${plural(id.units, 'lamp')} (${d.cell.name}); wires run in the grooves on the back.`,
        });
      } else {
        const b = id.batten!;
        parts.push({ id: 'batten-body', name: `Batten · ${id.px} px`, role: 'body', solid: battenBody(g, id, d), instances: list.map(bodyAt), note: `Print lying down, channel up. ${fmt(id.units)} mm of ${d.strip.name} in the channel; tilt screws thread into the pilot at each end.` });
        parts.push({
          id: 'batten-diffuser',
          name: 'Batten diffuser',
          role: 'diffuser',
          solid: battenDiffuser(g, id),
          instances: list.map((i) => mul(bodyAt(i), T(0, 0, b.hB - 2.2))),
          note: 'Natural PETG, 1 mm. Slides into the grooves from one end.',
        });
      }
    }

    /* ---- Pixels and schedule in data order ---- */
    const pixels: PixelPlacement[] = [];
    const schedule: ScheduleLine[] = [];
    const spanById = new Map(plan.spans.map((s) => [s.id, s]));
    for (const i of plan.instruments) {
      for (const p of i.dims.pixels) pixels.push({ pos: bodyPoint(i.pose, i.dims, p), normal: i.pose.beam, unit: i.id });
      const sp = spanById.get(i.span)!;
      const fromA = i.from === sp.a;
      schedule.push({
        unit: i.id,
        position: `${i.span} · ${fmt(fromA ? i.along : sp.length - i.along, 0)} mm from ${i.from} · ${SIDE_LABEL[i.side].toLowerCase()}`,
        purpose: label(i.kind),
        pixelId: i.dims.pixel.id,
        units: i.dims.units,
        px: i.dims.px,
        notes: `Pan ${fmt(i.pan, 0)}°, tilt ${fmt(i.tilt, 0)}°`,
      });
    }

    /* ---- Hardware ---- */
    const blockFaces = plan.nodes.filter((n) => n.spans.length).reduce((s, n) => s + [0, 1, 2, 3, 4, 5].filter((f) => n.mask & (1 << f)).length, 0);
    if (sectionSection) hardware.push({ item: 'M3×10 socket head screw + M3 nut', qty: 2 * sectionSection, note: 'Two per section-to-section joint, opposite holes' });
    const m3x8 = 2 * sectionBlock + 2 * picks.length;
    if (m3x8) hardware.push({ item: 'M3×8 socket head screw', qty: m3x8, note: 'Two per section end into a block, two per pick eye' });
    if (blockFaces) hardware.push({ item: 'M3 heat-set insert (Ø4 × 5.7 mm)', qty: 2 * blockFaces, note: 'Two per used block face' });
    if (bases.length) hardware.push({ item: 'M3×10 countersunk screw', qty: 2 * bases.length, note: 'Base plate into the block' });
    if (bases.length) hardware.push({ item: 'Rubber bumper foot, 8 mm', qty: 4 * bases.length, note: 'Under the base plate corners' });
    if (picks.length && d.hoists) hardware.push({ item: 'Ball chain Ø2.4 mm (or cord)', qty: Math.ceil(picks.length * (HOIST.gap + 40)) / 1000, note: 'Metres. Hoist to pick eye; cord from each hoist to the shelf' });
    const pan = new Map<number, number>();
    let tilt = 0;
    for (const i of plan.instruments) {
      pan.set(i.dims.panScrew, (pan.get(i.dims.panScrew) ?? 0) + 1);
      tilt += 2;
    }
    for (const [L, q] of [...pan.entries()].sort((a, b) => a[0] - b[0])) hardware.push({ item: `M3×${L} screw (pan)`, qty: q, note: 'Threads into the clamp stem pilot; snug, not tight, so the yoke still pans' });
    if (tilt) hardware.push({ item: 'M3×6 screw (tilt)', qty: tilt, note: 'Two per instrument, through the yoke arms' });
    if (plan.instruments.length) {
      hardware.push({ item: 'JST-SM 3-pin pigtail pair', qty: plan.instruments.length, note: 'One per instrument, so instruments unplug from the rig' });
      const pos = new Map(plan.nodes.map((n) => [n.id, n.pos]));
      const runMm = plan.chain.steps.reduce((s, st) => s + (st.strut ? (spanById.get(st.strut)?.length ?? 0) : dist(pos.get(st.from) ?? [0, 0, 0], pos.get(st.to) ?? [0, 0, 0])), 0);
      const m = (runMm + plan.instruments.length * 150) / 1000;
      hardware.push({ item: '3-core silicone wire, 30 AWG', qty: Math.ceil(m * 1.1 * 10) / 10, note: `Metres. Runs inside the chords (Ø${fmt(2 * d.boreR)} bore) and through the couplers.` });
    }

    const lenses = idsOf(parts, 'par-lens', 'mover-lens', 'batten-diffuser');
    const bodies = idsOf(parts, 'par-can', 'mover-head', 'blinder2-body', 'blinder4-body', 'batten-body');
    const assembly = steps(parts, [
      {
        title: 'Set the inserts',
        parts: idsOf(parts, 'block-'),
        hardware: blockFaces ? `${2 * blockFaces}× M3 heat-set insert` : undefined,
        note: 'Two inserts per used face, in opposite holes of the pinwheel.',
      },
      sectionSection > 0 && {
        title: 'Couple the sections',
        parts: [...idsOf(parts, 'section-'), 'coupler'],
        hardware: `${2 * sectionSection}× M3×10 + nut`,
        note: `Push a coupler halfway into each chord socket, close the next section onto it and bolt the end frames. Couplers are ${mm(d.fit)} mm under the socket Ø.`,
      },
      {
        title: 'Bolt the runs to the corner blocks',
        parts: [...idsOf(parts, 'section-'), ...idsOf(parts, 'block-')],
        hardware: sectionBlock ? `${2 * sectionBlock}× M3×8` : undefined,
        note: 'Feed the wiring through the chord bores and the block chambers as you go.',
      },
      {
        title: 'Base plates and pick points',
        parts: idsOf(parts, 'base-plate', 'pick-eye', 'hoist'),
        hardware: [bases.length && `${2 * bases.length}× M3×10 countersunk`, picks.length && `${2 * picks.length}× M3×8`].filter(Boolean).join(', ') || undefined,
        note: `Blocks drop into the base plate rim (${mm(d.fit)} mm fit gap) and bolt from below; pick eyes bolt to block tops.`,
      },
      {
        title: 'Build the instruments',
        parts: [...bodies, ...lenses],
        note: `Seat the jewels, lamps and strips (${mm(d.tol)} mm seat clearance), then the lenses and diffusers: the batten diffuser slides into its grooves, ${mm(d.fit)} mm wider and taller than it is.`,
      },
      {
        title: 'Yokes',
        parts: [...idsOf(parts, 'yoke-'), ...bodies, ...idsOf(parts, 'mover-base')],
        hardware: tilt ? `${tilt}× M3×6` : undefined,
        note: `Tilt screws through the yoke arms into the body; the arms clear the trunnions by ${mm(d.side)} mm a side.`,
      },
      {
        title: 'Clip on and patch',
        parts: ['clamp', ...idsOf(parts, 'yoke-')],
        hardware: [...pan.entries()].map(([L, q]) => `${q}× M3×${L}`).join(', ') || undefined,
        note: 'Snap each clamp over its chord, opening into the truss, and fix the yoke with the pan screw. Plug the instruments in data order.',
      },
    ]);

    return { parts, pixels, schedule, hardware, warnings: [...plan.warnings], assembly };
  },
};
