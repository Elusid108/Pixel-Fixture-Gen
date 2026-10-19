import type { ParamSpec, Vec3 } from '../../../types';
import { Field } from '../../../ui/Inspector';
import { fmt, plural } from '../../shared/layout';
import { NameInput, NumInput, ParamGroups, patchOf, Stat, useBuiltReport } from '../../shared/ui';
import { KIND_LIST, KINDS, SIDE_LABEL, SIDES, type InstrumentKind, type MountSide } from '../model';
import { RIG_PARAMS, SCALE } from '../params';
import { kindSummary, sectionLabel, type RigPlan } from '../plan';
import { useRigParams, useRigPlan } from './usePlan';
import { SYSTEM_ID, useRig } from './useRig';

const metres = (mm: number) => `${fmt((mm * SCALE) / 1000, 1)} m`;

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <fieldset>
      <legend>Check</legend>
      {list.slice(0, 6).map((w, k) => (
        <p key={k} className="dim">
          {w}
        </p>
      ))}
      {list.length > 6 && <p className="dim">…and {list.length - 6} more in the schedule.</p>}
    </fieldset>
  );
}

function DesignPanel({ plan }: { plan: RigPlan }) {
  const name = useRig((s) => s.design.name);
  const rename = useRig((s) => s.rename);
  const values = useRigParams();
  const truss = plan.spans.reduce((s, x) => s + x.length, 0);
  const sections = plan.sectionGroups.reduce((s, g) => s + g.count, 0);
  const blocks = plan.blockGroups.reduce((s, g) => s + g.count, 0);
  return (
    <>
      <header>
        <div className="eyebrow">M3 · Mini Rig</div>
        <NameInput name={name} onRename={rename} />
        <p>1:6 F34 box truss. Select a block, a span or an instrument to edit it. Identical sections, blocks and instrument parts print as one part with a count.</p>
      </header>
      <dl className="stats">
        <Stat k="Truss" v={`${plural(plan.spans.length, 'span')} · ${metres(truss)} at full scale`} />
        <Stat k="Sections" v={sections ? plan.sectionGroups.map((g) => `${g.count}× ${g.label}`).join(' · ') : 'none'} />
        <Stat k="Corner blocks" v={blocks ? plan.blockGroups.map((g) => `${g.count}× ${g.label}`).join(' · ') : 'none'} tone={plan.nodes.some((n) => n.bad) ? 'warn' : undefined} />
        <Stat k="Base plates · picks" v={`${plan.nodes.filter((n) => n.base && n.spans.length).length} · ${plan.nodes.filter((n) => n.pick && n.spans.length).length}`} />
        <Stat k="Instruments" v={kindSummary(plan)} />
        <Stat k="Pixels" v={`${plan.px} px · data from ${plan.controller || '—'}`} tone={plan.chain.jumps ? 'warn' : undefined} />
      </dl>
      <Warnings list={plan.warnings} />
      <ParamGroups specs={RIG_PARAMS} values={values} />
    </>
  );
}

function Toggle({ label, checked, onChange, disabled, title }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean; title?: string }) {
  return (
    <label className="field toggle" title={title}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="switch" aria-hidden />
    </label>
  );
}

function NodePanel({ plan, id }: { plan: RigPlan; id: string }) {
  const node = useRig((s) => s.design.nodes.find((n) => n.id === id));
  const select = useRig((s) => s.select);
  if (!node) return null;
  const ni = plan.nodes.find((n) => n.id === id);
  const st = useRig.getState;
  const setAxis = (k: number, v: number) => st().moveNode(id, node.pos.map((x, i) => (i === k ? v : x)) as Vec3);
  const isCtl = plan.controller === id;
  return (
    <>
      <header>
        <div className="eyebrow">Corner block{isCtl ? ' · data in' : ''}</div>
        <h2>
          {id} {ni && ni.spans.length > 0 && <span className="chip">{ni.label}</span>}
        </h2>
      </header>
      <fieldset>
        <legend>Block centre (mm, Z up)</legend>
        <div className="xyz-row">
          {['X', 'Y', 'Z'].map((l, k) => (
            <NumInput key={l} label={l} value={node.pos[k]} onCommit={(v) => setAxis(k, v)} />
          ))}
        </div>
      </fieldset>
      {ni && (
        <dl className="stats">
          <Stat k="Type" v={ni.spans.length ? `${ni.label} · ${ni.ways}-way` : 'no truss yet'} />
          <Stat k="Squareness" v={ni.spans.length ? `${fmt(ni.offDeg, 1)}° off the block axes` : '—'} tone={ni.bad ? 'bad' : ni.offDeg > 0.05 ? 'warn' : 'ok'} />
          <Stat k="Prints as" v={plan.blockGroups.find((g) => g.members.includes(id))?.label ?? '—'} />
        </dl>
      )}
      {ni && ni.spans.length > 0 && (
        <div className="buttons">
          {ni.spans.map((s) => (
            <button key={s} onClick={() => select({ kind: 'span', id: s })}>
              {s}
            </button>
          ))}
        </div>
      )}
      <fieldset>
        <legend>Fittings</legend>
        <Toggle label="Base plate" checked={node.base} onChange={() => st().setNode(id, { base: !node.base })} title="A 1:6 F34 base plate under the block, for towers." />
        <Toggle label="Pick-point eye" checked={node.pick} onChange={() => st().setNode(id, { pick: !node.pick })} title="An eye on top of the block, to fly the rig from a shelf." />
      </fieldset>
      <div className="buttons">
        <button disabled={isCtl} onClick={() => st().setController(id)}>
          Feed data here
        </button>
        <button onClick={() => st().remove({ kind: 'node', id })}>Delete block</button>
      </div>
    </>
  );
}

function SpanPanel({ plan, id }: { plan: RigPlan; id: string }) {
  const span = useRig((s) => s.design.spans.find((x) => x.id === id));
  const select = useRig((s) => s.select);
  if (!span) return null;
  const sp = plan.spans.find((x) => x.id === id);
  const hung = plan.instruments.filter((i) => i.span === id);
  return (
    <>
      <header>
        <div className="eyebrow">Truss span</div>
        <h2>
          {id} {sp && <span className="chip">{metres(sp.length)}</span>}
        </h2>
      </header>
      <div className="buttons">
        <button onClick={() => select({ kind: 'node', id: span.a })}>{span.a}</button>
        <span className="dim">↔</span>
        <button onClick={() => select({ kind: 'node', id: span.b })}>{span.b}</button>
      </div>
      {sp ? (
        <dl className="stats">
          <Stat k="Block to block" v={`${fmt(sp.length)} mm centre to centre`} />
          <Stat k="Clear run" v={`${fmt(sp.clear)} mm = ${fmt(sp.length)} − 2 × ${fmt(plan.dims.W / 2)} (half blocks)`} tone={sp.ok ? undefined : 'bad'} />
          <Stat k="Sections" v={sp.ok ? sp.sections.map((s) => sectionLabel(s.len, plan.dims)).join(' + ') : 'too short to build'} tone={sp.sections.some((s) => s.custom) ? 'warn' : sp.ok ? 'ok' : 'bad'} />
          <Stat k="Joints" v={sp.ok ? `${sp.sections.length - 1} section joint${sp.sections.length === 2 ? '' : 's'} + 2 block joints` : '—'} />
          <Stat k="Instruments" v={hung.length ? hung.map((i) => i.id).join(' · ') : 'none (dark: wiring passes through)'} />
        </dl>
      ) : (
        <p className="dim">This span doesn't join two blocks and is skipped.</p>
      )}
      <div className="buttons">
        <button onClick={() => useRig.getState().remove({ kind: 'span', id })}>Delete span</button>
      </div>
    </>
  );
}

const slider = (key: string, label: string, min: number, max: number, step: number, unit: string, help?: string): ParamSpec => ({ key, label, type: 'number', default: 0, min, max, step, unit, help });
const POS = slider('pos', 'Position along the span', 0, 100, 1, '%', 'Measured along the clear run between the two blocks.');
const PAN = slider('pan', 'Pan', -180, 180, 5, '°');
const TILT = slider('tilt', 'Tilt', -90, 90, 5, '°', 'Positive tilts the beam toward the front (the audience).');

function InstrumentPanel({ plan, id }: { plan: RigPlan; id: string }) {
  const inst = useRig((s) => s.design.instruments.find((i) => i.id === id));
  const select = useRig((s) => s.select);
  const report = useBuiltReport(SYSTEM_ID);
  if (!inst) return null;
  const info = plan.instruments.find((i) => i.id === id);
  const st = useRig.getState;
  const up = (patch: Parameters<ReturnType<typeof st>['updateInstrument']>[1]) => st().updateInstrument(id, patch);
  const patch = patchOf(report, id);
  return (
    <>
      <header>
        <div className="eyebrow">Instrument</div>
        <h2>
          {id} <span className="chip">{KINDS[inst.kind].label}</span>
        </h2>
      </header>
      <fieldset>
        <legend>Rigging</legend>
        <label className="field">
          <span>Kind</span>
          <select value={inst.kind} onChange={(e) => st().setKind(id, e.target.value as InstrumentKind)}>
            {KIND_LIST.map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Clamped to</span>
          <select value={inst.side} onChange={(e) => up({ side: e.target.value as MountSide })}>
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <Field spec={POS} value={Math.round(inst.t * 100)} onChange={(v) => up({ t: Number(v) / 100 })} />
        <Field spec={PAN} value={inst.pan} onChange={(v) => up({ pan: Number(v) })} />
        <Field spec={TILT} value={inst.tilt} onChange={(v) => up({ tilt: Number(v) })} />
      </fieldset>
      {info ? (
        <dl className="stats">
          <Stat k="On" v={`${inst.span} · ${fmt(info.along, 0)} mm from ${plan.spans.find((s) => s.id === inst.span)?.a ?? ''}`} />
          <Stat k="Pixels" v={`${info.dims.px} px · ${info.dims.pixel.name}`} />
          <Stat k="Data" v={`#${info.seq + 1} of ${plan.instruments.length}${patch ? ` · ${patch}` : ''}`} />
          <Stat k="Hardware" v={`snap clamp · M3×${info.dims.panScrew} pan · 2× M3×${info.dims.tiltScrew} tilt`} />
        </dl>
      ) : (
        <p className="dim">Its span isn't buildable, so this instrument is skipped.</p>
      )}
      <div className="buttons">
        <button onClick={() => select({ kind: 'span', id: inst.span })}>Go to {inst.span}</button>
        <button onClick={() => st().remove({ kind: 'instrument', id })}>Delete instrument</button>
      </div>
    </>
  );
}

export function RigInspector() {
  const selection = useRig((s) => s.selection);
  const plan = useRigPlan();
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {selection?.kind === 'node' ? (
        <NodePanel plan={plan} id={selection.id} />
      ) : selection?.kind === 'span' ? (
        <SpanPanel plan={plan} id={selection.id} />
      ) : selection?.kind === 'instrument' ? (
        <InstrumentPanel plan={plan} id={selection.id} />
      ) : (
        <DesignPanel plan={plan} />
      )}
      {selection && (
        <button className="ghost" onClick={() => useRig.getState().select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
