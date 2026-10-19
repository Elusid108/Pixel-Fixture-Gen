import { plural } from '../../shared/layout';
import { patchOf, PowerRoll, useBuiltReport } from '../../shared/ui';
import { tileOfSel, tileSelId } from '../system';
import { useFw, useFwLayout } from './useFw';

/**
 * Data & Power: backer tiles in data order (serpentine across the wall, tile by tile), with
 * the patch each tile gets from the built schedule and any lead the strand can't reach.
 */
export function FwData() {
  const L = useFwLayout();
  const report = useBuiltReport('facet-wall');
  const selection = useFw((s) => s.selection);
  const select = useFw((s) => s.select);
  const selTile = selection?.kind === 'tile' ? tileOfSel(selection.id) : selection?.kind === 'facet' ? L.byKey.get(selection.id)?.tile : undefined;
  const gapInto = new Map(L.longGaps.map((g) => [g.to, g.mm]));

  return (
    <div className="schedule">
      <p className="summary">
        <b>{L.chain.length}</b> nodes on <b>{plural(L.tiles.length, 'tile')}</b>, serpentine tile by tile from <b>{L.tiles[0]?.id ?? '—'}</b> · neighbours {Math.round(L.spacing)} mm apart on a {L.dims.lead} mm lead
        {L.longGaps.length > 0 && (
          <>
            {' '}
            · <b className="bad">{L.longGaps.length}</b> run{L.longGaps.length === 1 ? '' : 's'} need an extension lead
          </>
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Tile</th>
              <th>Backer</th>
              <th className="num">Px</th>
              <th>D1 · D2 · D3</th>
              <th>Patch (U/Ch)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {L.tiles.map((t, i) => {
              const cls = L.classes.find((c) => c.id === t.cls);
              const entry = gapInto.get(t.facets[0]);
              const inner = t.facets.slice(1).filter((k) => gapInto.has(k)).length;
              return (
                <tr key={t.id} className={`clickable${t.id === selTile ? ' selected' : ''}`} onClick={() => select({ kind: 'tile', id: tileSelId(t.id, t.facets) })}>
                  <td className="num">{i + 1}</td>
                  <td className="mono strong">{t.id}</td>
                  <td className="mono">
                    {t.cls}
                    {cls && !cls.full && <span className="chip">edge</span>}
                  </td>
                  <td className="num">{t.facets.length}</td>
                  <td className="mono">{t.depths.join(' · ')}</td>
                  <td className="mono">{patchOf(report, t.id)}</td>
                  <td className={entry || inner ? 'bad' : 'dim'}>
                    {i === 0 ? 'Data in' : `From ${L.tiles[i - 1].id}`}
                    {entry ? ` · entry run ${Math.round(entry)} mm: extension lead` : ''}
                    {inner ? ` · ${inner} long run${inner === 1 ? '' : 's'} inside` : ''}
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
