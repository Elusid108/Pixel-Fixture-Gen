import type { Vec3 } from '../../../types';
import { fmt, plural } from '../../shared/layout';
import { NameInput, NumInput, ParamGroups, Stat } from '../../shared/ui';
import { anchorKey, anchorLabel, parseAnchorKey } from '../model';
import { PC_PARAMS } from '../params';
import type { PcGarlandPlan, PcPlan } from '../plan';
import { usePc, usePcParams, usePcPlan } from './usePc';

const SHAPE = { globe: 'globe', faceted: 'faceted bead', bell: 'bell' } as const;

/** Distinct printed link types: (pitch, plain or anchor turn). */
function partTypes(plan: PcPlan): number {
  const keys = new Set<string>();
  for (const gp of plan.garlands) if (!gp.incomplete) for (const l of gp.links) keys.add(`${l.pitch}|${l.kind === 'anchor' ? l.yaw : 'l'}`);
  return keys.size;
}

function chordTone(v: number, plan: PcPlan): 'ok' | 'bad' {
  return v <= plan.dims.lead ? 'ok' : 'bad';
}

function bendText(w: PcGarlandPlan['worst']): string {
  if (!w) return '—';
  return `${fmt(Math.abs(w.bend))}° ${w.bend >= 0 ? 'in the drape' : 'over an anchor'} of ${w.limit}° (${w.where})`;
}

function DesignPanel({ plan }: { plan: PcPlan }) {
  const name = usePc((s) => s.design.name);
  const rename = usePc((s) => s.rename);
  const values = usePcParams();
  const d = plan.dims;
  const lit = plan.garlands.filter((g) => !g.incomplete);
  const anchors = lit.reduce((s, g) => s + g.links.filter((l) => l.kind === 'anchor').length, 0);
  const pitches = [...new Set(lit.map((g) => g.pitch))];
  return (
    <>
      <header>
        <div className="eyebrow">M7 · Pixel Chain</div>
        <NameInput name={name} onRename={rename} />
        <p>Select a garland or an anchor to edit it. Links hang on the true catenary; identical links print as one part with a count.</p>
      </header>
      <dl className="stats">
        <Stat k="Garlands" v={`${lit.length}${plan.garlands.length > lit.length ? ` (+${plan.garlands.length - lit.length} unfinished)` : ''}`} />
        <Stat k="Links" v={`${plan.px} (${plural(anchors, 'anchor link')}) → ${plural(partTypes(plan), 'part type')}`} />
        <Stat k="Pixels" v={`${plan.px} × ${d.pixel.name}`} />
        <Stat k="Strands" v={`${plan.strands} of ${d.strand}${plan.splices.length ? ` · ${plural(plan.splices.length, 'splice')}` : ''}`} tone={plan.strands > 1 ? 'warn' : undefined} />
        <Stat k="Pitch" v={`${pitches.map((p) => `${fmt(p)} mm`).join(', ') || '—'} (max ${fmt(d.leadMax)}, min ${fmt(d.pitchMin)})`} />
        <Stat k="Max node gap" v={plan.px > 1 ? `${fmt(plan.maxChord)} of ${d.lead} mm lead` : '—'} tone={plan.px > 1 ? chordTone(plan.maxChord, plan) : undefined} />
        <Stat k="Worst hinge" v={bendText(plan.worst)} tone={plan.worst ? (plan.worst.ok ? 'ok' : 'bad') : undefined} />
      </dl>
      {plan.warnings.length > 0 && (
        <ul className="checks">
          {plan.warnings.map((w, i) => (
            <li key={i} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      <ParamGroups specs={PC_PARAMS} values={values} />
    </>
  );
}

function GarlandPanel({ plan, id }: { plan: PcPlan; id: string }) {
  const garland = usePc((s) => s.design.garlands.find((g) => g.id === id));
  const a = usePc.getState;
  const gp = plan.garlands.find((g) => g.id === id);
  if (!garland || !gp) return null;
  const d = plan.dims;
  const index = plan.garlands.findIndex((g) => g.id === id);
  const sagMm = (k: number) => gp.spans[k]?.sagMm ?? 0;
  const setAxis = (i: number, k: number, v: number) => a().moveAnchor(id, i, garland.anchors[i].map((x, j) => (j === k ? v : x)) as Vec3);
  const own = garland.pitch !== undefined;
  const warns = plan.warnings.filter((w) => w.startsWith(`${id}:`) || w.startsWith(`${id} `));

  return (
    <>
      <header>
        <div className="eyebrow">Garland{garland.closed ? ' · ring' : ''} · {index + 1} of {plan.garlands.length} in data order</div>
        <h2>
          {id} <span className="chip">{plural(gp.links.length, 'link')}</span>
        </h2>
      </header>
      {gp.incomplete ? (
        <p className="dim">One anchor so far. Pick the garland tool (G) and keep clicking, or add one with Extend.</p>
      ) : (
        <dl className="stats">
          <Stat k="Chain" v={`${fmt(gp.arc / 1000, 2)} m · ${plural(gp.spans.length, 'span')}`} />
          <Stat k="Pitch" v={`${fmt(gp.pitch)} mm${gp.capped ? ` (asked ${fmt(gp.pitchReq)}: over the lead)` : gp.raised ? ` (asked ${fmt(gp.pitchReq)}: beads would touch)` : ''}`} tone={gp.capped || gp.raised ? 'warn' : undefined} />
          <Stat k="Max node gap" v={`${fmt(gp.maxChord)} of ${d.lead} mm lead`} tone={chordTone(gp.maxChord, plan)} />
          <Stat k="Hinge range" v={`${gp.hinge.up}° drape · ${gp.hinge.down}° over anchors`} />
          <Stat k="Worst bend" v={bendText(gp.worst)} tone={gp.worst ? (gp.worst.ok ? 'ok' : 'bad') : undefined} />
          <Stat k="Lowest bead" v={`${fmt(gp.minZ)} mm`} tone={gp.minZ < 0 ? 'bad' : undefined} />
          <Stat k="Data" v={`in at ${anchorLabel(gp.order[0]?.anchor ?? 0)}`} />
        </dl>
      )}
      {warns.length > 0 && (
        <ul className="checks">
          {warns.map((w, i) => (
            <li key={i} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      <fieldset>
        <legend>Link pitch (mm)</legend>
        <div className="xyz-row">
          <NumInput label="Pitch" value={garland.pitch ?? d.pitchParam} step={1} onCommit={(v) => a().setPitch(id, v)} />
        </div>
        <label className="field toggle">
          <span>Own pitch (off: system setting)</span>
          <input type="checkbox" checked={own} onChange={() => a().setPitch(id, own ? null : d.pitchParam)} />
          <span className="switch" aria-hidden />
        </label>
      </fieldset>
      {gp.spans.length > 0 && (
        <fieldset>
          <legend>Sag per span (% of chord)</legend>
          <div className="table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>Span</th>
                  <th>Sag %</th>
                  <th className="num">Hangs</th>
                  <th className="num">Links</th>
                </tr>
              </thead>
              <tbody>
                {gp.spans.map((sp) => (
                  <tr key={sp.index}>
                    <td className="mono">
                      {anchorLabel(sp.from)}–{anchorLabel(sp.to)}
                    </td>
                    <td>
                      <NumInput label="" value={garland.sags[sp.index]} step={1} onCommit={(v) => a().setSag(id, sp.index, v)} />
                    </td>
                    <td className={`num${sp.tooClose ? ' bad' : ''}`} title="Sag of the drape whole links make, vertically below the pin-to-pin chord">
                      {fmt(sp.actualPct)}% · {fmt(sagMm(sp.index), 0)} mm
                    </td>
                    <td className="num">{sp.links}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="buttons">
            <button onClick={() => a().setAllSags(id, garland.sags[0] ?? 18)}>Match all to {anchorLabel(0)}–{anchorLabel(1)}</button>
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend>Anchors (mm, Z up)</legend>
        {garland.anchors.map((p, i) => (
          <div className="xyz-row" key={i}>
            <button className="ghost" onClick={() => a().select({ kind: 'anchor', id: anchorKey(id, i) })} title="Select this anchor">
              {anchorLabel(i)}
            </button>
            {['X', 'Y', 'Z'].map((l, k) => (
              <NumInput key={l} label={l} value={p[k]} onCommit={(v) => setAxis(i, k, v)} />
            ))}
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>Options</legend>
        <label className="field toggle">
          <span>Closed ring</span>
          <input type="checkbox" checked={!!garland.closed} disabled={garland.anchors.length < 3} onChange={() => a().toggle(id, 'closed')} />
          <span className="switch" aria-hidden />
        </label>
        <label className="field toggle">
          <span>Feed data from the last anchor</span>
          <input type="checkbox" checked={!!garland.reverse} onChange={() => a().toggle(id, 'reverse')} />
          <span className="switch" aria-hidden />
        </label>
      </fieldset>
      <div className="buttons">
        <button disabled={!!garland.closed} onClick={() => a().extend(id)}>
          Add an anchor
        </button>
        <button disabled={index <= 0} onClick={() => a().reorder(id, -1)}>
          Earlier in data
        </button>
        <button disabled={index >= plan.garlands.length - 1} onClick={() => a().reorder(id, 1)}>
          Later in data
        </button>
        <button onClick={() => a().remove({ kind: 'garland', id })}>Delete garland</button>
      </div>
    </>
  );
}

function AnchorPanel({ plan, id }: { plan: PcPlan; id: string }) {
  const k = parseAnchorKey(id);
  const garland = usePc((s) => (k ? s.design.garlands.find((g) => g.id === k.gid) : undefined));
  const a = usePc.getState;
  if (!k || !garland || k.index >= garland.anchors.length) return null;
  const gp = plan.garlands.find((g) => g.id === k.gid);
  const pos = garland.anchors[k.index];
  const link = gp?.links.find((l) => l.kind === 'anchor' && l.anchor === k.index);
  const turn = gp?.turns.find((t) => t.anchor === k.index);
  const dataIndex = gp && link ? gp.order.indexOf(link) + 1 : 0;
  const setAxis = (ax: number, v: number) => a().moveAnchor(k.gid, k.index, pos.map((x, j) => (j === ax ? v : x)) as Vec3);

  return (
    <>
      <header>
        <div className="eyebrow">Anchor link · {k.gid}</div>
        <h2>
          {anchorLabel(k.index)} {dataIndex === 1 && <span className="chip">data in</span>}
        </h2>
      </header>
      <fieldset>
        <legend>Bead centre (mm, Z up)</legend>
        <div className="xyz-row">
          {['X', 'Y', 'Z'].map((l, ax) => (
            <NumInput key={l} label={l} value={pos[ax]} onCommit={(v) => setAxis(ax, v)} />
          ))}
        </div>
      </fieldset>
      <dl className="stats">
        <Stat k="Hangs from" v={`a hook through the bail, resting ${fmt(plan.dims.bail.zIn + plan.dims.bail.wi, 0)} mm above the bead centre`} />
        <Stat k="Turn" v={turn ? `${fmt(Math.abs(turn.yaw))}° ${turn.yaw > 0 ? 'left' : 'right'} → anchor link turned ${turn.yawQ}°` : 'straight through'} tone={turn && Math.abs(turn.yaw - turn.yawQ) > 8 ? 'warn' : undefined} />
        {dataIndex > 0 && <Stat k="Data" v={`node ${dataIndex} of ${gp!.order.length} in ${k.gid}`} />}
        <Stat k="Diffuser" v={`${SHAPE[plan.dims.shape]}, Ø${fmt(plan.dims.R * 2)} mm`} />
      </dl>
      <div className="buttons">
        <button onClick={() => a().select({ kind: 'garland', id: k.gid })}>Garland {k.gid}</button>
        <button onClick={() => a().remove({ kind: 'anchor', id })}>Delete anchor</button>
      </div>
    </>
  );
}

export function PcInspector() {
  const selection = usePc((s) => s.selection);
  const plan = usePcPlan();
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {selection?.kind === 'garland' ? <GarlandPanel plan={plan} id={selection.id} /> : selection?.kind === 'anchor' ? <AnchorPanel plan={plan} id={selection.id} /> : <DesignPanel plan={plan} />}
      {selection && (
        <button className="ghost" onClick={() => usePc.getState().select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
