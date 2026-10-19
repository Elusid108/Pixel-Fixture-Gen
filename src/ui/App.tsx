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
import { CanvasActions } from './bench/CanvasActions';
import { useCompact, usePageZoomGuard } from './touch';
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
        <p>Sets the bed for fit checks, part splitting and plate layout. You can change it any time from Printer in the header.</p>
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

function Brand() {
  return (
    <div className="brand">
      <span className="mark" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="brand-text">
        Pixel Fixture <b>Gen</b>
      </span>
    </div>
  );
}

/** The 3D view with its overlays: drawing buttons and build notes. */
function View3D({ phone }: { phone: boolean }) {
  const bench = useStore((s) => s.mode === 'workbench');
  const result = useStore((s) => s.result);
  const error = useStore((s) => s.error);
  const notes = (result?.errors.length ?? 0) + (result?.warnings.length ?? 0);
  return (
    <div className="canvas-wrap">
      {bench ? (
        <BenchCanvas>
          <SketchLayer />
        </BenchCanvas>
      ) : (
        <Viewer />
      )}
      {bench && <CanvasActions phone={phone} />}
      {(notes > 0 || error) && <Notes error={error} errors={result?.errors ?? []} warnings={result?.warnings ?? []} />}
    </div>
  );
}

export function App() {
  useAutoBuild();
  usePageZoomGuard();
  const compact = useCompact();
  return compact ? <PhoneShell /> : <DesktopShell />;
}

/* ---------------- Desktop: three columns ---------------- */

function DesktopShell() {
  const mode = useStore((s) => s.mode);
  const bench = mode === 'workbench';
  const printerId = useStore((s) => s.printerId);
  const setPrinter = useStore((s) => s.setPrinter);
  const result = useStore((s) => s.result);
  const building = useStore((s) => s.building);
  const error = useStore((s) => s.error);
  const tab = useStore((s) => s.tab);
  const set = useStore((s) => s.set);
  const benchUI = getUI(useBench((s) => s.system));
  const BenchInspector = benchUI.Inspector;
  const BenchData = benchUI.Data;

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
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
        <View3D phone={false} />
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

/* ---------------- Phone and tablet: view, tab bar, one sheet at a time ---------------- */

const ICONS = {
  view: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  fixtures: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  build: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3',
  params: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M17 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  schedule: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  parts: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  data: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  export: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  printer: 'M7 9V3h10v6M7 17H4v-8h16v8h-3M7 13h10v8H7z',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

type SheetId = 'fixtures' | 'params' | 'schedule' | 'parts' | 'data' | 'export' | 'setup';

/** Printer and the global fit, which live in the header on a desktop. */
function PrinterSetup() {
  const printerId = useStore((s) => s.printerId);
  const setPrinter = useStore((s) => s.setPrinter);
  return (
    <div className="setup">
      <h4>Printer</h4>
      <div className="printer-grid">
        {PRINTERS.map((p) => (
          <button key={p.id} className={p.id === printerId ? 'on' : ''} aria-pressed={p.id === printerId} onClick={() => setPrinter(p.id)}>
            <b>{p.name}</b>
            <span>
              {p.x} × {p.y} × {p.z} mm
            </span>
          </button>
        ))}
      </div>
      <h4>Fit</h4>
      <GlobalFit />
      <p className="hint">Fit is the gap between mating printed parts, seat the clearance around each pixel, both in mm. A fixture can override either one in its parameters.</p>
    </div>
  );
}

/** Swipe the sheet's header: up to fill the screen, down to shrink or close. */
function useSheetSwipe(onUp: () => void, onDown: () => void) {
  const start = useRef<number | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      start.current = e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (start.current === null) return;
      const dy = e.clientY - start.current;
      start.current = null;
      if (dy < -40) onUp();
      else if (dy > 40) onDown();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

function PhoneShell() {
  const mode = useStore((s) => s.mode);
  const bench = mode === 'workbench';
  const printerId = useStore((s) => s.printerId);
  const result = useStore((s) => s.result);
  const building = useStore((s) => s.building);
  const error = useStore((s) => s.error);
  const benchUI = getUI(useBench((s) => s.system));
  const BenchInspector = benchUI.Inspector;
  const BenchData = benchUI.Data;
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [full, setFull] = useState(false);
  const toggle = (id: SheetId | null) => setSheet((cur) => (cur === id ? null : id));
  const swipe = useSheetSwipe(
    () => setFull(true),
    () => (full ? setFull(false) : setSheet(null)),
  );

  useEffect(() => {
    if (!sheet) setFull(false);
    if (sheet === 'data' && !(bench && BenchData)) setSheet(null);
  }, [sheet, bench, BenchData]);
  // Picking a tool that works on the view (draw, place, connect…) moves the build sheet out of the way.
  useEffect(
    () =>
      useBench.subscribe((s, prev) => {
        if (s.tool !== prev.tool && s.tool !== 'select' && s.tool !== 'draw:select') setSheet((cur) => (cur === 'fixtures' ? null : cur));
      }),
    [],
  );

  const tabs: { id: SheetId | null; label: string; icon: keyof typeof ICONS }[] = [
    { id: null, label: 'View', icon: 'view' },
    { id: 'fixtures', label: bench ? 'Build' : 'Fixtures', icon: bench ? 'build' : 'fixtures' },
    { id: 'params', label: bench ? 'Inspect' : 'Params', icon: 'params' },
    { id: 'schedule', label: 'Schedule', icon: 'schedule' },
    { id: 'parts', label: 'Parts', icon: 'parts' },
    ...(bench && BenchData ? [{ id: 'data' as const, label: 'Data', icon: 'data' as const }] : []),
    { id: 'export', label: 'Export', icon: 'export' },
  ];
  const titles: Record<SheetId, string> = {
    fixtures: bench ? 'Workbench' : 'Fixtures',
    params: bench ? 'Inspector' : 'Parameters',
    schedule: 'Instrument schedule',
    parts: 'Parts & plates',
    data: 'Data & power',
    export: 'Export',
    setup: 'Printer & fit',
  };
  const content: Record<SheetId, () => React.ReactNode> = {
    fixtures: () => (bench ? <BenchCatalog extra={<SketchPanel />} /> : <Catalog />),
    params: () => (bench ? <BenchInspector /> : <Inspector />),
    schedule: () => <SchedulePanel />,
    parts: () => <PartsPanel />,
    data: () => (BenchData ? <BenchData /> : null),
    export: () => <ExportPanel />,
    setup: () => <PrinterSetup />,
  };

  return (
    <div className={`app phone${sheet ? ' has-sheet' : ''}${sheet && full ? ' sheet-full' : ''}`}>
      <header className="topbar">
        <Brand />
        <ModeSwitch />
        <span className={`status ${building ? 'busy' : error ? 'err' : ''}`} role="status">
          {building ? 'Building…' : error ? 'Failed' : result ? `${result.ms.toFixed(0)} ms` : ''}
        </span>
        <button className={`icon-btn${sheet === 'setup' ? ' on' : ''}`} onClick={() => toggle('setup')} aria-expanded={sheet === 'setup'} aria-label="Printer and fit">
          <Icon name="printer" />
          <span className="lbl">Printer</span>
        </button>
      </header>

      <main className="stage">
        {bench ? <BenchToolbar /> : <ViewBar />}
        <View3D phone />
      </main>

      {sheet && (
        <section className="bsheet" role="dialog" aria-label={titles[sheet]}>
          <div className="bsheet-head" {...swipe}>
            <span className="grip" aria-hidden />
            <h2>{titles[sheet]}</h2>
            <button className="icon-btn" onClick={() => setFull((f) => !f)} aria-label={full ? 'Shrink the panel' : 'Fill the screen'}>
              <Icon name={full ? 'down' : 'up'} />
            </button>
            <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close the panel">
              <Icon name="close" />
            </button>
          </div>
          <div className="bsheet-body" key={`${sheet}-${mode}`}>
            {content[sheet]()}
          </div>
        </section>
      )}

      <nav className="tabbar" aria-label="Panels">
        {tabs.map((t) => (
          <button key={t.label} className={sheet === t.id ? 'on' : ''} aria-pressed={sheet === t.id} onClick={() => (t.id ? toggle(t.id) : setSheet(null))}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {bench && <BenchKeys />}
      {!printerId && <PrinterPrompt />}
    </div>
  );
}
