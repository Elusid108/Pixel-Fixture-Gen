import { FORM_LABEL } from '../../../pixels/library';
import type { Vec3 } from '../../../types';
import { fmt, plural } from '../../shared/layout';
import { NameInput, NumInput, ParamGroups, Stat } from '../../shared/ui';
import { CAP_KINDS, CAPS, KINDS, SEG_KINDS, type SegKind } from '../model';
import { CS_PARAMS } from '../params';
import type { CsPlan, StackPlan } from '../plan';
import { useColumn, useCsParams, useCsPlan } from './useColumn';

function DesignPanel({ plan }: { plan: CsPlan }) {
  const name = useColumn((s) => s.design.name);
  const values = useCsParams();
  const segs = plan.stacks.flatMap((s) => s.segs);
  const byKind = SEG_KINDS.map((k) => [k, segs.filter((s) => s.kind === k).length] as [SegKind, number]).filter(([, n]) => n);
  const shapes = new Set(segs.map((s) => s.key)).size;
  return (
    <>
      <header>
        <div className="eyebrow">M6 · Column Stack</div>
        <NameInput name={name} onRename={(n) => useColumn.getState().rename(n)} />
        <p>Click a segment to edit it, or a cap to edit its stack. Segments of the same kind and size print once ×N.</p>
      </header>
      <dl className="stats">
        <Stat k="Stacks" v={plan.stacks.length ? plan.stacks.map((s) => `${s.label} ${s.mount === 'floor' ? 'base' : 'drop'}`).join(' · ') : 'none'} />
        <Stat k="Segments" v={byKind.length ? `${byKind.map(([k, n]) => `${KINDS[k].name} ×${n}`).join(' · ')} → ${plural(shapes, 'print shape')}` : 'none'} />
        <Stat k="Pixels" v={`${plan.px} px in ${plural(plan.units.length, 'unit')}`} />
        <Stat k="Height" v={plan.stacks.length ? plan.stacks.map((s) => `${s.label} ${fmt(s.height, 0)} mm`).join(' · ') : '—'} />
        <Stat k="Power" v={`${fmt(plan.watts)} W at full white${plan.volts.length ? ` · ${plan.volts.join(' + ')} V` : ''}`} tone={plan.volts.length > 1 ? 'warn' : undefined} />
      </dl>
      {plan.warnings.length > 0 && (
        <ul className="checks">
          {plan.warnings.map((w) => (
            <li key={w} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      <ParamGroups specs={CS_PARAMS} values={values} />
    </>
  );
}

function StackPanel({ plan, st }: { plan: CsPlan; st: StackPlan }) {
  const stack = useColumn((s) => s.design.stacks.find((x) => x.id === st.id));
  const act = useColumn.getState;
  if (!stack) return null;
  const setAxis = (k: number, v: number) => act().moveStack(st.id, stack.pos.map((x, i) => (i === k ? v : x)) as Vec3);
  const where = st.mount === 'floor' ? 'up from the base' : 'down from the canopy';
  return (
    <>
      <header>
        <div className="eyebrow">Stack · {st.mount === 'floor' ? 'on a base' : 'hanging drop'}</div>
        <h2>
          {st.label} <span className="chip">{plural(st.segs.length, 'segment')}</span>
        </h2>
      </header>
      <div className="buttons">
        <button className={st.mount === 'floor' ? 'primary' : ''} onClick={() => act().setMount(st.id, 'floor')}>
          On a base
        </button>
        <button className={st.mount === 'hang' ? 'primary' : ''} onClick={() => act().setMount(st.id, 'hang')}>
          From a canopy
        </button>
      </div>
      <fieldset>
        <legend>{st.mount === 'floor' ? 'Base position (mm, Z up)' : 'Ceiling point (mm, Z up)'}</legend>
        <div className="xyz-row">
          {['X', 'Y', 'Z'].map((l, k) => (
            <NumInput key={l} label={l} value={stack.pos[k]} onCommit={(v) => setAxis(k, v)} />
          ))}
        </div>
        {st.mount === 'hang' && (
          <div className="xyz-row">
            <NumInput label="Drop" value={st.drop} step={10} onCommit={(v) => act().setDrop(st.id, v)} />
          </div>
        )}
      </fieldset>
      <dl className="stats">
        <Stat k="Height" v={`${fmt(st.height, 0)} mm (Z ${fmt(st.zMin, 0)} to ${fmt(st.zMax, 0)})`} />
        <Stat k="Pixels" v={`${st.px} px · ${fmt(st.watts)} W`} />
        <Stat k="Data" v={`${st.index === 0 ? 'Controller here' : `In from ${plan.stacks[st.index - 1].label}`}, ${where}`} />
      </dl>
      <div className="table-wrap">
        <table className="mini">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Segment</th>
              <th className="num">Px</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {st.segs.map((s, i) => (
              <tr key={s.id} className="clickable" onClick={() => act().select({ kind: 'segment', id: s.id })}>
                <td className="mono strong">{s.unit}</td>
                <td>
                  {KINDS[s.kind].name} <span className="dim">{fmt(s.h)} mm</span>
                </td>
                <td className="num">{s.px}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}>
                  <button className="ghost small" disabled={i === 0} title={st.mount === 'floor' ? 'Move down' : 'Move up'} onClick={() => act().moveSegment(s.id, -1)}>
                    {st.mount === 'floor' ? '↓' : '↑'}
                  </button>
                  <button className="ghost small" disabled={i === st.segs.length - 1} title={st.mount === 'floor' ? 'Move up' : 'Move down'} onClick={() => act().moveSegment(s.id, 1)}>
                    {st.mount === 'floor' ? '↑' : '↓'}
                  </button>
                  <button className="ghost small" title="Remove" onClick={() => act().remove({ kind: 'segment', id: s.id })}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="mono strong">{st.cap.unit}</td>
              <td>
                {CAPS[st.cap.kind].name} cap <span className="dim">{fmt(st.cap.h)} mm</span>
              </td>
              <td className="num">{st.cap.px || '—'}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <fieldset>
        <legend>Cap</legend>
        <div className="buttons">
          {CAP_KINDS.map((c) => (
            <button key={c} className={st.cap.kind === c ? 'primary' : ''} onClick={() => act().setCap(st.id, c)} title={CAPS[c].blurb}>
              {CAPS[c].name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Add a segment</legend>
        <div className="buttons">
          {SEG_KINDS.map((k) => (
            <button key={k} onClick={() => act().appendSegment(st.id, k)} title={KINDS[k].blurb}>
              {KINDS[k].name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="buttons">
        <button onClick={() => act().remove({ kind: 'stack', id: st.id })}>Delete stack</button>
      </div>
    </>
  );
}

function SegmentPanel({ plan, id }: { plan: CsPlan; id: string }) {
  const seg = useColumn((s) => s.design.stacks.flatMap((x) => x.segments).find((g) => g.id === id));
  const act = useColumn.getState;
  const st = plan.stacks.find((s) => s.segs.some((g) => g.id === id));
  const sp = st?.segs.find((g) => g.id === id);
  if (!seg || !st || !sp) return null;
  const k = KINDS[sp.kind];
  const where = st.mount === 'floor' ? 'up from the base' : 'down from the canopy';
  const raised = seg.h !== undefined && Math.abs(sp.h - seg.h) > 0.05;
  return (
    <>
      <header>
        <div className="eyebrow">
          Segment · {st.label}, {sp.index + 1} of {st.segs.length} {where}
        </div>
        <h2>
          {sp.unit} <span className="chip">{k.name}</span>
        </h2>
      </header>
      <fieldset>
        <legend>Kind</legend>
        <label className="field">
          <span>Segment kind</span>
          <select value={sp.kind} onChange={(e) => act().setSegment(id, { kind: e.target.value as SegKind })}>
            {SEG_KINDS.map((x) => (
              <option key={x} value={x}>
                {KINDS[x].name}
              </option>
            ))}
          </select>
          <small>{k.blurb}</small>
        </label>
      </fieldset>
      <fieldset>
        <legend>Options</legend>
        <div className="xyz-row">
          <NumInput label="Height" value={sp.h} step={2} onCommit={(v) => act().setSegment(id, { h: v })} />
          {k.n && <NumInput label={k.n.label} value={sp.n} onCommit={(v) => act().setSegment(id, { n: v })} />}
          {k.twist && <NumInput label="Twist °" value={sp.twist} step={15} onCommit={(v) => act().setSegment(id, { twist: v })} />}
        </div>
        <small className="dim">
          Height {fmt(k.minH)}–{fmt(plan.dims.maxSegH)} mm{k.n ? ` · ${k.n.label.toLowerCase()} ${k.n.min}–${k.n.max}` : ''}
          {k.twist ? ' · 360° twist continues into the next helix' : ''}
          {raised ? ` · raised to ${fmt(sp.h)} mm to fit its parts` : ''}
        </small>
      </fieldset>
      <dl className="stats">
        <Stat k="Pixels" v={`${sp.px} px · ${sp.detail}`} />
        <Stat k="Pixel form" v={`${FORM_LABEL[sp.pixel.form]} · ${sp.pixel.name}`} />
        <Stat k="Power" v={`${fmt(sp.px * sp.pixel.wattsPerPx)} W at ${sp.pixel.volts} V`} />
        <Stat k="Prints as" v={`${plural(plan.stacks.flatMap((x) => x.segs).filter((g) => g.key === sp.key).length, 'copy', 'copies')} of one part`} />
      </dl>
      <div className="buttons">
        <button disabled={sp.index === 0} onClick={() => act().moveSegment(id, -1)}>
          Toward the {st.mount === 'floor' ? 'base' : 'canopy'}
        </button>
        <button disabled={sp.index === st.segs.length - 1} onClick={() => act().moveSegment(id, 1)}>
          Toward the cap
        </button>
        <button onClick={() => act().remove({ kind: 'segment', id })}>Remove</button>
      </div>
      <div className="buttons">
        <button className="ghost" onClick={() => act().select({ kind: 'stack', id: st.id })}>
          Back to {st.label}
        </button>
      </div>
    </>
  );
}

export function CsInspector() {
  const selection = useColumn((s) => s.selection);
  const plan = useCsPlan();
  const st = selection?.kind === 'stack' ? plan.stacks.find((s) => s.id === selection.id) : undefined;
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {st ? <StackPanel plan={plan} st={st} /> : selection?.kind === 'segment' ? <SegmentPanel plan={plan} id={selection.id} /> : <DesignPanel plan={plan} />}
      {selection && (
        <button className="ghost" onClick={() => useColumn.getState().select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
