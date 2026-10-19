import { fmt } from '../../shared/layout';
import { patchOf, PowerRoll, useBuiltReport } from '../../shared/ui';
import { lineaCore } from '../system';
import { useLinea, useLineaPlan } from './useLinea';

/**
 * Data & Power: bars in chain order with their pixels and patch, and the return runs between
 * them. Patch numbers come from the built schedule, so they match the CSV.
 */
export function LineaData() {
  const plan = useLineaPlan();
  const report = useBuiltReport(lineaCore.moduleId);
  const selection = useLinea((s) => s.selection);
  const select = useLinea((s) => s.select);
  const { chain } = plan;
  const edges = new Map(plan.edges.map((e) => [e.id, e]));
  let lit = 0;
  let prevTo = '';
  return (
    <div className="schedule">
      <p className="summary">
        <b>{chain.lit.length}</b> lit bars from <b>{plan.feedNode || '—'}</b> · <b>{plan.stats.px}</b> px · <b>{chain.darkSteps}</b> return run{chain.darkSteps === 1 ? '' : 's'} (
        {(chain.darkMm / 1000).toFixed(2)} m in the back groove)
        {chain.jumps > 0 && (
          <>
            {' '}
            · <b className="bad">{chain.jumps}</b> free jump{chain.jumps === 1 ? '' : 's'} between separate pieces
          </>
        )}
        . Change where data enters with <b>Feed here</b> and the direction with <b>Reverse run</b>.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Run</th>
              <th>Bar</th>
              <th>DIN → DOUT</th>
              <th className="num">Px</th>
              <th>Patch (U/Ch)</th>
              <th className="num">Wire mm</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {chain.steps.map((st, i) => {
              const e = st.strut ? edges.get(st.strut) : undefined;
              const n = st.lit ? ++lit : null;
              const sel = selection?.kind === 'bar' && selection.id === st.strut;
              const note = st.lit ? (n === 1 ? 'Data in' : prevTo === st.from ? 'Jumper through the joint' : 'After a return run') : e ? 'Return wire behind this bar' : 'Free wire between pieces';
              if (st.lit || !st.strut) prevTo = st.lit ? st.to : '';
              else prevTo = '';
              return (
                <tr key={i} className={`clickable${st.lit ? '' : ' dark-run'}${sel ? ' selected' : ''}`} onClick={() => st.strut && select({ kind: 'bar', id: st.strut })}>
                  <td className="num">{n ?? ''}</td>
                  <td>{st.lit ? <span className="chip role-diffuser">{e?.run}</span> : st.strut ? <span className="chip">return</span> : <span className="chip bad">jump</span>}</td>
                  <td className="mono strong">{st.strut ?? '—'}</td>
                  <td className="mono">
                    {st.from} → {st.to}
                  </td>
                  <td className="num">{st.lit ? e?.k : ''}</td>
                  <td className="mono">{st.lit && st.strut ? patchOf(report, st.strut) : ''}</td>
                  <td className="num">{!st.lit && e ? fmt(e.length, 0) : ''}</td>
                  <td className="dim">{note}</td>
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
