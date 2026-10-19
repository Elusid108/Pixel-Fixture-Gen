import { useMemo } from 'react';
import { packPlates } from '../export/plates';
import { boundsFit, getPrinter } from '../printers';
import { useStore } from './store';

export function usePlates() {
  const parts = useStore((s) => s.result?.parts);
  const printerId = useStore((s) => s.printerId);
  return useMemo(() => {
    const printer = getPrinter(printerId ?? '');
    const plates = parts ? packPlates(parts.map((p) => ({ id: p.id, bounds: p.bounds, count: p.instances.length })), printer) : [];
    return { printer, plates };
  }, [parts, printerId]);
}

export function PartsPanel() {
  const parts = useStore((s) => s.result?.parts ?? []);
  const selected = useStore((s) => s.selectedPart);
  const set = useStore((s) => s.set);
  const { printer, plates } = usePlates();
  const copies = parts.reduce((s, p) => s + p.instances.length, 0);
  const grams = parts.reduce((s, p) => s + p.volumeCm3 * p.instances.length, 0) * 1.24;

  return (
    <div className="parts">
      <p className="summary">
        <b>{parts.length}</b> unique parts · <b>{copies}</b> printed copies · about <b>{grams.toFixed(0)} g</b> of filament (solid PLA basis) ·{' '}
        <b>{plates.length}</b> plate{plates.length === 1 ? '' : 's'} on a {printer.name}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>Role</th>
              <th className="num">Qty</th>
              <th className="num">Size (mm)</th>
              <th className="num">cm³</th>
              <th>Bed</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const s = p.bounds.max.map((v, i) => v - p.bounds.min[i]);
              const fits = boundsFit(p.bounds, printer);
              return (
                <tr
                  key={p.id}
                  className={p.id === selected ? 'selected' : ''}
                  onClick={() => set('selectedPart', p.id === selected ? null : p.id)}
                >
                  <td className="strong">{p.name}</td>
                  <td>
                    <span className={`chip role-${p.role}`}>{p.role}</span>
                  </td>
                  <td className="num">×{p.instances.length}</td>
                  <td className="num mono">{s.map((v) => v.toFixed(0)).join(' × ')}</td>
                  <td className="num">{p.volumeCm3.toFixed(1)}</td>
                  <td className={fits ? 'ok' : 'bad'}>{fits ? 'fits' : 'too big'}</td>
                  <td className="dim">{p.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Click a part to highlight it in the view. Switch the view to Plates to see the bed layout.</p>
    </div>
  );
}
