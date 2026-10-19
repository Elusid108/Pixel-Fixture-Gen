import { fmt, plural } from '../../shared/layout';
import { patchOf, PowerRoll, useBuiltReport } from '../../shared/ui';
import { anchorLabel } from '../model';
import { PC_ID, usePc, usePcPlan } from './usePc';

/**
 * Data & Power: garlands in data order with their patch (from the built schedule, so it
 * matches the CSV), the strand splices and the free wire runs between garlands.
 */
export function PcData() {
  const plan = usePcPlan();
  const report = useBuiltReport(PC_ID);
  const selection = usePc((s) => s.selection);
  const select = usePc((s) => s.select);
  const reorder = usePc((s) => s.reorder);
  const toggle = usePc((s) => s.toggle);
  const d = plan.dims;
  let start = 0;

  return (
    <div className="schedule">
      <p className="summary">
        <b>{plan.px}</b> nodes in <b>{plan.garlands.length}</b> garland{plan.garlands.length === 1 ? '' : 's'} · <b>{plan.strands}</b> strand{plan.strands === 1 ? '' : 's'} of {d.strand}
        {plan.splices.length > 0 && (
          <>
            {' '}
            · splice at {plan.splices.map((s) => `${s.gid} link ${s.link}`).join(', ')}
          </>
        )}
        {plan.jumps.length > 0 && (
          <>
            {' '}
            · {plural(plan.jumps.length, 'jump')} between garlands ({fmt(plan.jumps.reduce((s, j) => s + j.mm, 0) / 1000, 2)} m of extension)
          </>
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Garland</th>
              <th>Data</th>
              <th className="num">Px</th>
              <th className="num">Nodes</th>
              <th>Patch (U/Ch)</th>
              <th>Strand</th>
              <th>Order</th>
            </tr>
          </thead>
          <tbody>
            {plan.garlands.map((gp, i) => {
              const first = start + 1;
              start += gp.order.length;
              const s0 = Math.ceil(first / d.strand);
              const s1 = Math.max(s0, Math.ceil(start / d.strand));
              const sel = selection?.kind === 'garland' && selection.id === gp.id;
              const a = gp.order[0];
              const b = gp.order[gp.order.length - 1];
              const splices = plan.splices.filter((s) => s.gid === gp.id);
              return (
                <tr key={gp.id} className={`clickable${sel ? ' selected' : ''}`} onClick={() => select({ kind: 'garland', id: gp.id })}>
                  <td className="num">{i + 1}</td>
                  <td className="mono strong">{gp.id}</td>
                  <td className="mono">{a && b ? `${anchorLabel(a.anchor ?? 0)} → ${anchorLabel(b.anchor ?? 0)}` : '—'}</td>
                  <td className="num">{gp.order.length}</td>
                  <td className="num mono">{gp.order.length ? `${first}–${start}` : ''}</td>
                  <td className="mono">{patchOf(report, gp.id)}</td>
                  <td className="dim">
                    {gp.order.length ? (s0 === s1 ? `strand ${s0}` : `strands ${s0}–${s1}`) : ''}
                    {splices.map((s) => ` · splice at link ${s.link} (${s.where})`).join('')}
                  </td>
                  <td>
                    <div className="buttons" onClick={(e) => e.stopPropagation()}>
                      <button disabled={i === 0} onClick={() => reorder(gp.id, -1)} title="Earlier in data order">
                        ↑
                      </button>
                      <button disabled={i === plan.garlands.length - 1} onClick={() => reorder(gp.id, 1)} title="Later in data order">
                        ↓
                      </button>
                      <button onClick={() => toggle(gp.id, 'reverse')} title="Feed this garland from its other end">
                        ⇄
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {plan.jumps.length > 0 && (
        <ul className="checks">
          {plan.jumps.map((j) => (
            <li key={`${j.from}-${j.to}`} className={j.mm > d.lead ? 'warn' : 'ok'}>
              {j.from} → {j.to}: {fmt(j.mm / 1000, 2)} m {j.mm > d.lead ? '3-core extension lead' : 'within one node lead'}
            </li>
          ))}
        </ul>
      )}
      <PowerRoll report={report} />
    </div>
  );
}
