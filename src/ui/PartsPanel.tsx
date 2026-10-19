import { useMemo } from 'react';
import { packPlates } from '../export/plates';
import { boundsFit, getPrinter } from '../printers';
import type { AssemblyStep, BuiltPart } from '../types';
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

// Stable empties: a fresh `[]` from a store selector re-renders forever.
const NO_PARTS: BuiltPart[] = [];
const NO_STEPS: AssemblyStep[] = [];

export function PartsPanel() {
  const parts = useStore((s) => s.result?.parts ?? NO_PARTS);
  const assembly = useStore((s) => s.result?.assembly ?? NO_STEPS);
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
      {assembly.length > 0 && (
        <section className="assembly">
          <h4>Assembly</h4>
          <ol>
            {assembly.map((st, i) => (
              <li key={i}>
                <b>{st.title}</b>
                {st.parts && st.parts.length > 0 && (
                  <span className="dim"> · {st.parts.map((id) => parts.find((p) => p.id === id)?.name ?? id).join(', ')}</span>
                )}
                {st.hardware && <span className="hw"> · {st.hardware}</span>}
                {st.note && <div className="dim">{st.note}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
