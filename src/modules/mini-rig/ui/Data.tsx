import { fmt } from '../../shared/layout';
import { patchOf, PowerRoll, useBuiltReport } from '../../shared/ui';
import { KINDS, SIDE_LABEL } from '../model';
import { useRigPlan } from './usePlan';
import { SYSTEM_ID, useRig } from './useRig';

/**
 * Data & Power: instruments in the order the data line reaches them, walking the truss from
 * the feed block. Patch ranges come from the built schedule, so they match the CSV.
 */
export function RigData() {
  const plan = useRigPlan();
  const report = useBuiltReport(SYSTEM_ID);
  const selection = useRig((s) => s.selection);
  const select = useRig((s) => s.select);
  const spanLen = new Map(plan.spans.map((s) => [s.id, s]));
  return (
    <div className="schedule">
      <p className="summary">
        <b>{plan.instruments.length}</b> instruments · <b>{plan.px}</b> px from <b>{plan.controller || '—'}</b> · the line walks <b>{plan.chain.lit.length}</b> lit span
        {plan.chain.lit.length === 1 ? '' : 's'} and <b>{plan.chain.darkSteps}</b> dark one{plan.chain.darkSteps === 1 ? '' : 's'} inside the chords
        {plan.chain.jumps > 0 && (
          <>
            {' '}
            · <b className="bad">{plan.chain.jumps}</b> free jump{plan.chain.jumps === 1 ? '' : 's'} between separate pieces
          </>
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Unit</th>
              <th>Instrument</th>
              <th>Span</th>
              <th className="num">From DIN end</th>
              <th>Chord</th>
              <th className="num">Px</th>
              <th>Patch (U/Ch)</th>
            </tr>
          </thead>
          <tbody>
            {plan.instruments.map((i, k) => {
              const sp = spanLen.get(i.span);
              const fromA = sp ? i.from === sp.a : true;
              const sel = selection?.kind === 'instrument' && selection.id === i.id;
              return (
                <tr key={i.id} className={`clickable${sel ? ' selected' : ''}`} onClick={() => select({ kind: 'instrument', id: i.id })}>
                  <td className="num">{k + 1}</td>
                  <td className="mono strong">{i.id}</td>
                  <td>{KINDS[i.kind].label}</td>
                  <td className="mono">
                    {i.span} <span className="dim">from {i.from}</span>
                  </td>
                  <td className="num">{sp ? `${fmt(fromA ? i.along : sp.length - i.along, 0)} mm` : ''}</td>
                  <td className="dim">{SIDE_LABEL[i.side]}</td>
                  <td className="num">{i.dims.px}</td>
                  <td className="mono">{patchOf(report, i.id)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PowerRoll report={report} />
    </div>
  );
}
