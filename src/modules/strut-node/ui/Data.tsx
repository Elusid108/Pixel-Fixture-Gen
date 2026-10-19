import { formatAddress } from '../../../schedule/schedule';
import { useStore } from '../../../ui/store';
import { useSnPlan } from './usePlan';
import { useWorkbench } from './useSn';

/**
 * Data & Power: the chain in order, with the patch each lit run gets and the dark runs
 * between them. Patch numbers come from the built schedule, so they match the CSV.
 */
export function SnData() {
  const plan = useSnPlan();
  const report = useStore((s) => (s.result?.fixtureId === 'strut-node' ? s.result.report : null));
  const selection = useWorkbench((s) => s.selection);
  const select = useWorkbench((s) => s.select);
  const setTool = useWorkbench((s) => s.setTool);
  const resetOrder = useWorkbench((s) => s.resetOrder);
  const orderLen = useWorkbench((s) => s.design.order.length);
  const { chain, an } = plan;
  const rows = new Map(report?.rows.map((r) => [r.unit, r]) ?? []);
  const info = new Map(an.struts.map((s) => [s.id, s]));
  let lit = 0;

  return (
    <div className="schedule">
      <p className="summary">
        <b>{chain.lit.length}</b> lit runs from <b>{an.hubs.find((h) => h.controller)?.id ?? '—'}</b> · <b>{chain.darkSteps}</b> dark run{chain.darkSteps === 1 ? '' : 's'} (
        {(chain.darkMm / 1000).toFixed(2)} m of wire through the spines)
        {chain.jumps > 0 && (
          <>
            {' '}
            · <b className="bad">{chain.jumps}</b> free jump{chain.jumps === 1 ? '' : 's'} between separate pieces
          </>
        )}{' '}
        · {chain.userCount ? `first ${chain.userCount} picked by you, the rest suggested` : 'order suggested by greedy DFS'}
      </p>
      <div className="buttons">
        <button onClick={() => setTool('order')}>Pick the order on the bench</button>
        <button disabled={!orderLen} onClick={resetOrder}>
          Back to the suggested order
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Run</th>
              <th>Strut</th>
              <th>DIN → DOUT</th>
              <th className="num">Px</th>
              <th>Patch (U/Ch)</th>
              <th className="num">Wire mm</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {chain.steps.map((st, i) => {
              const s = st.strut ? info.get(st.strut) : undefined;
              const row = st.lit && st.strut ? rows.get(st.strut) : undefined;
              const n = st.lit ? ++lit : null;
              const sel = selection?.kind === 'strut' && selection.id === st.strut;
              return (
                <tr key={i} className={`clickable${st.lit ? '' : ' dark-run'}${sel ? ' selected' : ''}`} onClick={() => st.strut && select({ kind: 'strut', id: st.strut })}>
                  <td className="num">{n ?? ''}</td>
                  <td>{st.lit ? <span className="chip role-diffuser">lit</span> : st.strut ? <span className="chip">dark</span> : <span className="chip bad">jump</span>}</td>
                  <td className="mono strong">{st.strut ?? '—'}</td>
                  <td className="mono">
                    {st.from} → {st.to}
                  </td>
                  <td className="num">{st.lit ? (s?.px ?? '') : ''}</td>
                  <td className="mono">{row ? `${formatAddress(row.start)}–${formatAddress(row.end)}` : ''}</td>
                  <td className="num">{st.lit ? '' : s ? Math.round(s.length) : ''}</td>
                  <td className="dim">
                    {st.lit && s?.flip ? 'Flipped: fed from this end through a return wire' : ''}
                    {!st.lit && s && !s.dark ? 'Return wire through a lit strut' : ''}
                    {!st.lit && s?.dark ? 'Wire-only strut' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {report && (
        <div className="roll">
          {report.power.map((g) => (
            <div className="power" key={g.volts}>
              <div className="big">
                {g.volts} V<span>{g.px} px</span>
              </div>
              <dl>
                <dt>Universes</dt>
                <dd>{report.totals.universes}</dd>
                <dt>Max draw</dt>
                <dd>
                  {g.watts.toFixed(1)} W · {g.amps.toFixed(2)} A
                </dd>
                <dt>Inject every</dt>
                <dd>{g.injections > 1 ? `${Math.ceil(g.px / g.injections)} px (${g.injections} points)` : 'one feed at the controller'}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
