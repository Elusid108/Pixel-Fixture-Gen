import { useEffect, useState, type ReactNode } from 'react';
import { angleDeg } from '../model';
import { SN_PARAMS } from '../params';
import type { SnPlan } from '../plan';
import type { ParamSpec, Vec3 } from '../../../types';
import { Field } from '../../../ui/Inspector';
import { useSnParams, useSnPlan } from './usePlan';
import { useWorkbench } from './useSn';

const fmt = (v: number, d = 1) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(d));

function NumInput({ value, onCommit, label, step = 1 }: { value: number; onCommit: (v: number) => void; label: string; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="xyz">
      <span>{label}</span>
      <input type="number" step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

function Stat({ k, v, tone }: { k: string; v: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={tone}>{v}</dd>
    </>
  );
}

function DesignPanel({ plan }: { plan: SnPlan }) {
  const design = useWorkbench((s) => s.design);
  const rename = useWorkbench((s) => s.rename);
  const setParam = useWorkbench((s) => s.setParam);
  const reset = useWorkbench((s) => s.resetParams);
  const values = useSnParams();
  const [name, setName] = useState(design.name);
  useEffect(() => setName(design.name), [design.name]);
  const { an, chain } = plan;
  const px = an.struts.reduce((s, x) => s + x.px, 0);
  const prints = an.classes.reduce((s, c) => s + 2 * c.members.length, 0);

  const groups = new Map<string, ParamSpec[]>();
  for (const p of SN_PARAMS) {
    if (p.hidden || p.type === 'json') continue;
    groups.set(p.group ?? 'Settings', [...(groups.get(p.group ?? 'Settings') ?? []), p]);
  }

  return (
    <>
      <header>
        <div className="eyebrow">M4 · Strut & Node</div>
        <input className="title-input" value={name} aria-label="Design name" onChange={(e) => setName(e.target.value)} onBlur={() => name !== design.name && rename(name)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <p>Select a hub or a strut to inspect it. Identical hubs and struts print as one part with a count.</p>
      </header>
      <dl className="stats">
        <Stat k="Hubs" v={`${an.hubs.length} → ${an.classes.length} part type${an.classes.length === 1 ? '' : 's'} (${prints} halves)`} />
        <Stat k="Struts" v={`${an.struts.length} → ${an.types.length} length${an.types.length === 1 ? '' : 's'}`} />
        <Stat k="Pixels" v={px} />
        <Stat k="Data path" v={`${chain.lit.length} lit runs · ${chain.darkSteps} dark · ${(chain.darkMm / 1000).toFixed(2)} m return wire`} tone={chain.jumps ? 'bad' : undefined} />
        <Stat k="Min socket angle" v={`${fmt(an.requiredAngle)}° for Ø${fmt(an.dims.tubeR * 2)} tubes`} />
      </dl>
      {[...groups.entries()].map(([g, specs]) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {specs.map((s) => (
            <Field key={s.key} spec={s} value={values[s.key]} onChange={(v) => setParam(s.key, v)} />
          ))}
        </fieldset>
      ))}
      <button className="ghost" onClick={reset}>
        Reset system settings
      </button>
    </>
  );
}

function NodePanel({ plan, id }: { plan: SnPlan; id: string }) {
  const design = useWorkbench((s) => s.design);
  const moveNode = useWorkbench((s) => s.moveNode);
  const setController = useWorkbench((s) => s.setController);
  const remove = useWorkbench((s) => s.remove);
  const select = useWorkbench((s) => s.select);
  const node = design.nodes.find((n) => n.id === id);
  if (!node) return null;
  const hub = plan.an.hubs.find((h) => h.id === id);
  const cls = hub ? plan.an.classes.find((c) => c.id === hub.classId) : undefined;
  const setAxis = (k: number, v: number) => moveNode(id, node.pos.map((x, i) => (i === k ? v : x)) as Vec3);
  const req = plan.an.requiredAngle;

  return (
    <>
      <header>
        <div className="eyebrow">Hub{id === design.controller ? ' · controller (data in)' : ''}</div>
        <h2>
          {id} {cls && <span className="chip">{cls.id === id ? 'unique part' : `${cls.id} ×${cls.members.length}`}</span>}
        </h2>
      </header>
      <fieldset>
        <legend>Position (mm, Z up)</legend>
        <div className="xyz-row">
          {['X', 'Y', 'Z'].map((l, k) => (
            <NumInput key={l} label={l} value={node.pos[k]} onCommit={(v) => setAxis(k, v)} />
          ))}
        </div>
      </fieldset>
      {hub ? (
        <>
          <dl className="stats">
            <Stat k="Sockets" v={hub.sockets.length} />
            <Stat
              k="Min angle"
              v={hub.minAngle === null ? '—' : `${fmt(hub.minAngle)}° (${hub.minPair?.join(' / ')})`}
              tone={hub.minAngle === null ? undefined : hub.collide ? 'bad' : hub.minAngle < req + 5 ? 'warn' : 'ok'}
            />
            <Stat k="Socket offset" v={`${fmt(hub.offset)} mm${hub.collide ? ' (at the max: tubes touch)' : ''}`} tone={hub.collide ? 'bad' : undefined} />
            {cls && (
              <>
                <Stat k="Split" v={`${cls.split.supportFree ? 'support-free' : 'needs supports'} · worst overhang ${fmt(cls.split.overhangDeg, 0)}°`} tone={cls.split.supportFree ? 'ok' : 'warn'} />
                <Stat k="Hardware" v={`M3×${cls.split.bolt.length} + nut, ${cls.split.pins.length}× Ø3 dowel`} />
              </>
            )}
          </dl>
          <div className="table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>Socket</th>
                  <th>To</th>
                  <th className="num">Nearest</th>
                  <th>Engraved</th>
                </tr>
              </thead>
              <tbody>
                {hub.sockets.map((s) => {
                  const near = Math.min(...hub.sockets.filter((o) => o !== s).map((o) => angleDeg(o.dir, s.dir)));
                  return (
                    <tr key={s.strut} onClick={() => select({ kind: 'strut', id: s.strut })} className="clickable">
                      <td className="mono strong">
                        {s.strut}
                        {!s.lit && <span className="chip">dark</span>}
                      </td>
                      <td className="mono">{s.other}</td>
                      <td className="num">{Number.isFinite(near) ? `${fmt(near)}°` : '—'}</td>
                      <td className="mono dim">{s.hubLabel ? `${s.hubLabel} · ${s.strutLabel}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="dim">No struts yet. Use the strut tool (C) to connect this hub.</p>
      )}
      <div className="buttons">
        <button disabled={id === design.controller} onClick={() => setController(id)}>
          Make controller hub
        </button>
        <button onClick={() => remove({ kind: 'node', id })}>Delete hub</button>
      </div>
    </>
  );
}

function StrutPanel({ plan, id }: { plan: SnPlan; id: string }) {
  const design = useWorkbench((s) => s.design);
  const toggle = useWorkbench((s) => s.toggleStrut);
  const remove = useWorkbench((s) => s.remove);
  const select = useWorkbench((s) => s.select);
  const strut = design.struts.find((s) => s.id === id);
  if (!strut) return null;
  const s = plan.an.struts.find((x) => x.id === id);
  const t = s ? plan.an.types.find((x) => x.id === s.typeId) : undefined;
  const runIdx = plan.chain.lit.findIndex((r) => r.strut === id);
  const run = plan.chain.lit[runIdx];

  return (
    <>
      <header>
        <div className="eyebrow">Strut{strut.dark ? ' · dark (wire only)' : ''}</div>
        <h2>
          {id} {t && <span className="chip">{`Type ${t.id} ×${t.members.length}`}</span>}
        </h2>
      </header>
      <div className="buttons">
        <button onClick={() => select({ kind: 'node', id: strut.a })}>{strut.a}</button>
        <span className="dim">↔</span>
        <button onClick={() => select({ kind: 'node', id: strut.b })}>{strut.b}</button>
      </div>
      {s ? (
        <dl className="stats">
          <Stat k="Hub to hub" v={`${fmt(s.length)} mm`} />
          <Stat k="Tube cut length" v={`${fmt(s.cut)} mm = ${fmt(s.length)} − ${fmt(s.offA)} − ${fmt(s.offB)}`} tone={s.tooShort ? 'bad' : undefined} />
          {t && t.tubeSegs > 1 && <Stat k="Printed as" v={`${t.tubeSegs} × ${fmt(t.tubeSegLen)} mm + ${t.tubeSegs - 1} coupler${t.tubeSegs > 2 ? 's' : ''}`} tone="warn" />}
          <Stat k="Pixels" v={strut.dark ? 'none (dark)' : `${s.px} over ${fmt(s.litLength)} mm`} />
          <Stat k="Data" v={run ? `run ${runIdx + 1} of ${plan.chain.lit.length} · DIN at ${run.from} → ${run.to}` : strut.dark ? 'passes through' : '—'} />
        </dl>
      ) : (
        <p className="dim">This strut doesn't connect two distinct hubs and is skipped.</p>
      )}
      <fieldset>
        <legend>Options</legend>
        <label className="field toggle">
          <span>Dark (wire only)</span>
          <input type="checkbox" checked={!!strut.dark} onChange={() => toggle(id, 'dark')} />
          <span className="switch" aria-hidden />
        </label>
        <label className="field toggle" title="Reverse the strip. Data enters from the far end through a return wire in the spine.">
          <span>Flip strip direction</span>
          <input type="checkbox" checked={!!strut.flip} disabled={!!strut.dark} onChange={() => toggle(id, 'flip')} />
          <span className="switch" aria-hidden />
        </label>
      </fieldset>
      <div className="buttons">
        <button onClick={() => remove({ kind: 'strut', id })}>Delete strut</button>
      </div>
    </>
  );
}

export function SnInspector() {
  const selection = useWorkbench((s) => s.selection);
  const plan = useSnPlan();
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {selection?.kind === 'node' ? <NodePanel plan={plan} id={selection.id} /> : selection?.kind === 'strut' ? <StrutPanel plan={plan} id={selection.id} /> : <DesignPanel plan={plan} />}
      {selection && (
        <button className="ghost" onClick={() => useWorkbench.getState().select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
