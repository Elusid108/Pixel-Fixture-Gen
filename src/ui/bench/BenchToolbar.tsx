import { useEffect } from 'react';
import { futureOf, pastOf, useBench } from '../../workbench/store';
import { getUI } from '../../workbench/uis';
import type { ToolDef } from '../../workbench/ui';
import { usePlates } from '../PartsPanel';
import { useStore, type Effect } from '../store';

const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'chase', label: 'Chase (data order)' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'ripple', label: 'Ripple' },
  { value: 'off', label: 'Off' },
];

/** Tools from outside the active system (the drawing engine registers its own here). */
const extraTools: ToolDef[] = [];
export function registerBenchTools(tools: ToolDef[]) {
  for (const t of tools) if (!extraTools.some((x) => x.id === t.id)) extraTools.push(t);
}
export const benchTools = (system: string): ToolDef[] => [...getUI(system).tools, ...extraTools];

/** Keyboard: tools, delete, undo/redo, escape. Ignored while typing in a field. */
export function useBenchKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = useBench.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selection) {
          e.preventDefault();
          st.removeSelection();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (st.pending) st.setPending(null);
        else st.select(null);
        return;
      }
      const tool = benchTools(st.system).find((x) => x.key === e.key.toLowerCase());
      if (tool) st.setTool(tool.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function BenchToolbar() {
  const system = useBench((s) => s.system);
  const tool = useBench((s) => s.tool);
  const setTool = useBench((s) => s.setTool);
  const snap = useBench((s) => s.snap);
  const workZ = useBench((s) => s.workZ);
  const showParts = useBench((s) => s.showParts);
  const showChain = useBench((s) => s.showChain);
  const showLabels = useBench((s) => s.showLabels);
  const past = useBench((s) => pastOf(s).length);
  const future = useBench((s) => futureOf(s).length);
  const wb = useBench((s) => s.set);
  const undo = useBench((s) => s.undo);
  const redo = useBench((s) => s.redo);
  const view = useStore((s) => s.view);
  const effect = useStore((s) => s.effect);
  const plateIndex = useStore((s) => s.plateIndex);
  const set = useStore((s) => s.set);
  const { plates } = usePlates();
  const ui = getUI(system);
  const tools = benchTools(system);
  const active = tools.find((t) => t.id === tool);

  return (
    <div className="viewbar wb-bar">
      <div className="seg" role="tablist" aria-label="View">
        {(['assembled', 'plates'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => set('view', v)}>
            {v === 'assembled' ? 'Bench' : `Plates (${plates.length})`}
          </button>
        ))}
      </div>
      {view === 'assembled' ? (
        <>
          <div className="seg" role="toolbar" aria-label="Tool">
            {ui.tools.map((t) => (
              <button key={t.id} className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>
                {t.label}
              </button>
            ))}
          </div>
          <label className="inline">
            Snap
            <select value={snap} onChange={(e) => wb('snap', Number(e.target.value))}>
              {[0, 5, 10, 25, 50].map((s) => (
                <option key={s} value={s}>
                  {s ? `${s} mm` : 'free'}
                </option>
              ))}
            </select>
          </label>
          {active?.plane && (
            <label className="inline">
              Plane Z
              <input className="num-input" type="number" step={snap || 1} value={workZ} onChange={(e) => wb('workZ', Number(e.target.value))} />
            </label>
          )}
          <div className="seg" aria-label="Show">
            <button className={showParts ? 'on' : ''} aria-pressed={showParts} onClick={() => wb('showParts', !showParts)}>
              Parts
            </button>
            {ui.overlays?.chain && (
              <button className={showChain ? 'on' : ''} aria-pressed={showChain} onClick={() => wb('showChain', !showChain)}>
                Data path
              </button>
            )}
            {ui.overlays?.labels && (
              <button className={showLabels ? 'on' : ''} aria-pressed={showLabels} onClick={() => wb('showLabels', !showLabels)}>
                IDs
              </button>
            )}
          </div>
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
          <div className="seg">
            <button onClick={undo} disabled={!past} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button onClick={redo} disabled={!future} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
          </div>
          {active && <span className="wb-hint">{active.hint}</span>}
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
