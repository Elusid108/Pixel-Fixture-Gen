import { useEffect, useRef } from 'react';
import { requestBuild } from '../build/client';
import { getFixture } from '../fixtures/registry';
import { resolveParams } from '../fixtures/util';
import { PRINTERS } from '../printers';
import { Catalog } from './Catalog';
import { ExportPanel } from './ExportPanel';
import { Inspector } from './Inspector';
import { PartsPanel, usePlates } from './PartsPanel';
import { SchedulePanel } from './SchedulePanel';
import { useStore, type Effect, type Tab } from './store';
import { Viewer } from './Viewer';

/** Rebuild on any fixture/param change, debounced, latest request wins. */
function useAutoBuild() {
  const fixtureId = useStore((s) => s.fixtureId);
  const stored = useStore((s) => s.params[fixtureId]);
  const setResult = useStore((s) => s.setResult);
  const setBuilding = useStore((s) => s.setBuilding);
  const latest = useRef(0);
  useEffect(() => {
    const ticket = ++latest.current;
    const params = resolveParams(getFixture(fixtureId), stored);
    const timer = setTimeout(() => {
      setBuilding(true);
      requestBuild(fixtureId, params)
        .then((r) => ticket === latest.current && setResult(r))
        .catch((e: Error) => ticket === latest.current && setResult(null, e.message))
        .finally(() => ticket === latest.current && setBuilding(false));
    }, 120);
    return () => clearTimeout(timer);
  }, [fixtureId, stored, setResult, setBuilding]);
}

function PrinterPrompt() {
  const setPrinter = useStore((s) => s.setPrinter);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="printer-title">
      <div className="sheet">
        <h2 id="printer-title">What do you print on?</h2>
        <p>Sets the bed for fit checks, part splitting and plate layout. You can change it any time from the header.</p>
        <div className="printer-grid">
          {PRINTERS.map((p) => (
            <button key={p.id} onClick={() => setPrinter(p.id)}>
              <b>{p.name}</b>
              <span>
                {p.x} × {p.y} × {p.z} mm
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'chase', label: 'Chase' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'ripple', label: 'Ripple' },
  { value: 'warm', label: 'Warm flicker' },
  { value: 'off', label: 'Off (dark)' },
];

function ViewBar() {
  const view = useStore((s) => s.view);
  const explode = useStore((s) => s.explode);
  const effect = useStore((s) => s.effect);
  const plateIndex = useStore((s) => s.plateIndex);
  const set = useStore((s) => s.set);
  const { plates } = usePlates();
  return (
    <div className="viewbar">
      <div className="seg" role="tablist" aria-label="View">
        {(['assembled', 'plates'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => set('view', v)}>
            {v === 'assembled' ? 'Assembled' : `Plates (${plates.length})`}
          </button>
        ))}
      </div>
      {view === 'assembled' ? (
        <>
          <label className="inline">
            Explode
            <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => set('explode', Number(e.target.value))} />
          </label>
          <label className="inline">
            Preview
            <select value={effect} onChange={(e) => set('effect', e.target.value as Effect)}>
              {EFFECTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="seg">
          {plates.map((_, i) => (
            <button key={i} className={plateIndex === i ? 'on' : ''} onClick={() => set('plateIndex', i)}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'schedule', label: 'Instrument schedule' },
  { id: 'parts', label: 'Parts & plates' },
  { id: 'export', label: 'Export' },
];

export function App() {
  useAutoBuild();
  const printerId = useStore((s) => s.printerId);
  const setPrinter = useStore((s) => s.setPrinter);
  const result = useStore((s) => s.result);
  const building = useStore((s) => s.building);
  const error = useStore((s) => s.error);
  const tab = useStore((s) => s.tab);
  const set = useStore((s) => s.set);
  const notes = [...(result?.errors ?? []), ...(result?.warnings ?? [])];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Pixel Fixture <b>Gen</b>
        </div>
        <div className="top-right">
          <span className={`status ${building ? 'busy' : error ? 'err' : ''}`}>
            {building ? 'Building…' : error ? 'Build failed' : result ? `Built in ${result.ms.toFixed(0)} ms` : ''}
          </span>
          <label className="inline">
            Printer
            <select value={printerId ?? ''} onChange={(e) => setPrinter(e.target.value)}>
              {!printerId && <option value="">Choose…</option>}
              {PRINTERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.x}×{p.y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <Catalog />

      <main className="stage">
        <ViewBar />
        <div className="canvas-wrap">
          <Viewer />
          {(notes.length > 0 || error) && (
            <ul className="notes">
              {error && <li className="err">{error}</li>}
              {result?.errors.map((e) => (
                <li key={e} className="err">
                  {e}
                </li>
              ))}
              {result?.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
        <section className="drawer">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => set('tab', t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="drawer-body">
            {tab === 'schedule' && <SchedulePanel />}
            {tab === 'parts' && <PartsPanel />}
            {tab === 'export' && <ExportPanel />}
          </div>
        </section>
      </main>

      <Inspector />
      {!printerId && <PrinterPrompt />}
    </div>
  );
}
