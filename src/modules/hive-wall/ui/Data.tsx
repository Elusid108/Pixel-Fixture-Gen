import { plural } from '../../shared/layout';
import { patchOf, PowerRoll, useBuiltReport } from '../../shared/ui';
import { START_LABEL } from '../model';
import { HW_ID, useHw, useHwLayout } from './useHw';

/**
 * Data & Power: tiles in data order with their patch (from the built schedule, so it matches
 * the CSV), where the strand enters each tile and where an extension lead is needed.
 */
export function HwData() {
  const layout = useHwLayout();
  const report = useBuiltReport(HW_ID);
  const selection = useHw((s) => s.selection);
  const start = useHw((s) => s.design.start);
  const select = useHw((s) => s.select);
  const breaks = layout.tiles.filter((t, k) => k > 0 && !t.linked).length;
  let first = 1;

  return (
    <div className="schedule">
      <p className="summary">
        <b>{layout.tiles.length}</b> tiles · <b>{layout.px}</b> px · {layout.order} serpentine from the {START_LABEL[start].toLowerCase()}, each tile serpentine by cell rows
        {breaks > 0 && (
          <>
            {' '}
            · <b className="bad">{plural(breaks, 'extension lead')}</b> where the next tile shares no notch
          </>
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Unit</th>
              <th>Position</th>
              <th>Tile</th>
              <th className="num">Px</th>
              <th className="num">Cells</th>
              <th>Patch (U/Ch)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {layout.tiles.map((t, k) => {
              const from = first;
              first += t.cells.length;
              const sel = selection?.kind === 'tile' && selection.id === t.slot.key;
              return (
                <tr key={t.unit} className={`clickable${sel ? ' selected' : ''}`} onClick={() => select({ kind: 'tile', id: t.slot.key })}>
                  <td className="num">{k + 1}</td>
                  <td className="mono strong">{t.unit}</td>
                  <td>{t.position}</td>
                  <td>{t.kind === 'full' ? <span className="chip">whole</span> : <span className="chip role-diffuser">{t.piece}</span>}</td>
                  <td className="num">{t.cells.length}</td>
                  <td className="num mono">{t.cells.length ? `${from}–${from + t.cells.length - 1}` : ''}</td>
                  <td className="mono">{patchOf(report, t.unit)}</td>
                  <td className="dim">
                    Enters {t.enters}
                    {k > 0 && !t.linked ? ` · extension lead (${Math.round(t.jumpIn)} mm)` : ''}
                  </td>
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
