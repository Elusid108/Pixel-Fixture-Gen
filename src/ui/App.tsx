import { useEffect, useMemo, useRef, useState } from 'react';
import type { Params } from '../types';
import { requestBuild } from '../build/client';
import { getFixture } from '../fixtures/registry';
import { resolveParams } from '../fixtures/util';
import { hostFill, type HostSettings } from '../fit';
import { DEFAULT_PRINTER_ID, PRINTERS } from '../printers';
import { getCore } from '../workbench/cores';
import { designOf, paramsOf, useBench } from '../workbench/store';
import { getUI } from '../workbench/uis';
import { BenchCanvas } from './bench/BenchCanvas';
import { BenchCatalog } from './bench/BenchCatalog';
import { BenchToolbar, useBenchKeys } from './bench/BenchToolbar';
import { SketchLayer } from './sketch/SketchLayer';
import { SketchPanel } from './sketch/SketchPanel';
import { Catalog } from './Catalog';
import { GlobalFit } from './FitControls';
import { ExportPanel } from './ExportPanel';
import { Inspector } from './Inspector';
import { PartsPanel, usePlates } from './PartsPanel';
import { SchedulePanel } from './SchedulePanel';
import { useStore, type Effect, type Tab } from './store';
import { Viewer } from './Viewer';

/** Rebuild on any fixture/param/design change, debounced, latest request wins. */
function useAutoBuild() {
  const mode = useStore((s) => s.mode);
  const catalogId = useStore((s) => s.fixtureId);
  const stored = useStore((s) => s.params[catalogId]);
  const printerId = useStore((s) => s.printerId) ?? DEFAULT_PRINTER_ID;
  const system = useBench((s) => s.system);
  const design = useBench(designOf);
  const sysParams = useBench(paramsOf);
  const setResult = useStore((s) => s.setResult);
  const setBuilding = useStore((s) => s.setBuilding);
  const latest = useRef(0);
  const core = getCore(system);
  const fixtureId = mode === 'workbench' ? core.moduleId : catalogId;
  const fitGap = useStore((s) => s.fitGap);
  const seatClearance = useStore((s) => s.seatClearance);
  const host = useMemo(() => ({ printerId, fit: fitGap, seat: seatClearance }), [printerId, fitGap, seatClearance]);
  const benchParams = useMemo(
    () => hostFill(getFixture(core.moduleId), core.buildParams(design, sysParams, printerId), { ...host, fit: Number(sysParams.fit ?? host.fit), seat: Number(sysParams.seat ?? host.seat) }),
    [core, design, sysParams, printerId, host],
  );
  useEffect(() => {
    const ticket = ++latest.current;
    const params = mode === 'workbench' ? benchParams : catalogParams(fixtureId, stored, host);
    const timer = setTimeout(() => {
      setBuilding(true);
      requestBuild(fixtureId, params)
        .then((r) => ticket === latest.current && setResult(r))
        .catch((e: Error) => ticket === latest.current && setResult(null, e.message))
        .finally(() => ticket === latest.current && setBuilding(false));
    }, mode === 'workbench' ? 250 : 120);
    return () => clearTimeout(timer);
  }, [mode, fixtureId, stored, benchParams, host, setResult, setBuilding]);
}

/** Catalogue build params, with the host's printer, fit gap and seat clearance filled in. */
function catalogParams(fixtureId: string, stored: Params | undefined, host: HostSettings): Params {
  const def = getFixture(fixtureId);
  return resolveParams(def, hostFill(def, stored ?? {}, host));
}

/**
 * Build notes over the view. Errors always show; warnings fold into one line so they never
 * bury the model, and open on demand.
 */
function Notes({ error, errors, warnings }: { error: string | null; errors: string[]; warnings: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <ul className="notes">
      {error && <li className="err">{error}</li>}
      {errors.map((e) => (
        <li key={e} className="err">
          {e}
        </li>
      ))}
      {warnings.length > 0 && (
        <li className="toggle">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide notes' : `${warnings.length} note${warnings.length === 1 ? '' : 's'}: ${warnings[0].length > 70 ? warnings[0].slice(0, 70) + '…' : warnings[0]}`}
          </button>
        </li>
      )}
      {open && warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
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

const TABS: { id: Tab; label: string; bench?: boolean }[] = [
  { id: 'schedule', label: 'Instrument schedule' },
  { id: 'parts', label: 'Parts & plates' },
  { id: 'data', label: 'Data & power', bench: true },
  { id: 'export', label: 'Export' },
];

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  return (
    <div className="seg mode" role="tablist" aria-label="Mode">
      <button role="tab" aria-selected={mode === 'catalog'} className={mode === 'catalog' ? 'on' : ''} onClick={() => setMode('catalog')}>
        Catalogue
      </button>
      <button role="tab" aria-selected={mode === 'workbench'} className={mode === 'workbench' ? 'on' : ''} onClick={() => setMode('workbench')}>
        Workbench
      </button>
    </div>
  );
}

function BenchKeys() {
  useBenchKeys();
  return null;
}

export function App() {
  useAutoBuild();
  const mode = useStore((s) => s.mode);
  const bench = mode === 'workbench';
  const printerId = useStore((s) => s.printerId);
  const setPrinter = useStore((s) => s.setPrinter);
  const result = useStore((s) => s.result);
  const building = useStore((s) => s.building);
  const error = useStore((s) => s.error);
  const tab = useStore((s) => s.tab);
  const set = useStore((s) => s.set);
  const notes = [...(result?.errors ?? []), ...(result?.warnings ?? [])];
  const benchUI = getUI(useBench((s) => s.system));
  const BenchInspector = benchUI.Inspector;
  const BenchData = benchUI.Data;

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
        <ModeSwitch />
        <div className="top-right">
          <span className={`status ${building ? 'busy' : error ? 'err' : ''}`}>
            {building ? 'Building…' : error ? 'Build failed' : result ? `Built in ${result.ms.toFixed(0)} ms` : ''}
          </span>
          <GlobalFit />
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

      {bench ? <BenchCatalog extra={<SketchPanel />} /> : <Catalog />}

      <main className="stage">
        {bench ? <BenchToolbar /> : <ViewBar />}
        <div className="canvas-wrap">
          {bench ? (
            <BenchCanvas>
              <SketchLayer />
            </BenchCanvas>
          ) : (
            <Viewer />
          )}
          {(notes.length > 0 || error) && <Notes error={error} errors={result?.errors ?? []} warnings={result?.warnings ?? []} />}
        </div>
        <section className="drawer">
          <div className="tabs" role="tablist">
            {TABS.filter((t) => !t.bench || (bench && BenchData)).map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => set('tab', t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="drawer-body">
            {tab === 'schedule' && <SchedulePanel />}
            {tab === 'parts' && <PartsPanel />}
            {tab === 'data' && bench && BenchData && <BenchData />}
            {tab === 'export' && <ExportPanel />}
          </div>
        </section>
      </main>

      {bench ? <BenchInspector /> : <Inspector />}
      {bench && <BenchKeys />}
      {!printerId && <PrinterPrompt />}
    </div>
  );
}
