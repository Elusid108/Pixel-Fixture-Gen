import { FORM_LABEL } from '../../../pixels/library';
import { patchOf, PowerRoll, useBuiltReport } from '../../shared/ui';
import { columnStackCore } from '../system';
import { useColumn, useCsPlan } from './useColumn';

/**
 * Data & Power: every lit unit in data order (up each stack from its base, or down from its
 * canopy, stacks chained in order) with its pixel form and patch from the built schedule.
 */
export function CsData() {
  const plan = useCsPlan();
  const report = useBuiltReport(columnStackCore.moduleId);
  const selection = useColumn((s) => s.selection);
  const select = useColumn((s) => s.select);
  const byStack = new Map(plan.stacks.map((s) => [s.id, s]));
  let prev = '';
  return (
    <div className="schedule">
      <p className="summary">
        <b>{plan.px}</b> px in <b>{plan.units.length}</b> units over <b>{plan.stacks.length}</b> stack{plan.stacks.length === 1 ? '' : 's'}. Data runs from the controller in{' '}
        {plan.stacks[0] ? `${plan.stacks[0].label}'s ${plan.stacks[0].mount === 'floor' ? 'base' : 'canopy'}` : 'the first stack'} along each column, then on to the next stack by a 3-core link.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Unit</th>
              <th>Stack</th>
              <th>Segment</th>
              <th>Pixel form</th>
              <th className="num">Px</th>
              <th>Patch (U/Ch)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {plan.units.map((u, i) => {
              const st = byStack.get(u.stackId)!;
              const seg = u.segId ? st.segs.find((s) => s.id === u.segId) : null;
              const sel = seg ? selection?.kind === 'segment' && selection.id === seg.id : selection?.kind === 'stack' && selection.id === st.id;
              const link = prev && prev !== u.stackId ? `Link from ${byStack.get(prev)?.label}` : '';
              prev = u.stackId;
              return (
                <tr key={u.unit} className={`clickable${sel ? ' selected' : ''}`} onClick={() => select(seg ? { kind: 'segment', id: seg.id } : { kind: 'stack', id: st.id })}>
                  <td className="num">{i + 1}</td>
                  <td className="mono strong">{u.unit}</td>
                  <td>
                    {st.label} <span className="dim">{st.mount === 'floor' ? '↑ base' : '↓ canopy'}</span>
                  </td>
                  <td>{seg ? u.name.split(' · ')[0] : u.name}</td>
                  <td>
                    {FORM_LABEL[u.pixel.form]} <span className="dim">{u.pixel.name}</span>
                  </td>
                  <td className="num">{u.px}</td>
                  <td className="mono">{patchOf(report, u.unit)}</td>
                  <td className="dim">{[link, u.detail].filter(Boolean).join(' · ')}</td>
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
