import { useEffect } from 'react';
import { usePlates } from './PartsPanel';
import { useStore, type Effect } from './store';
import { useWorkbench, type Tool } from './workbenchStore';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'v' },
  { id: 'add', label: 'Hub', key: 'n' },
  { id: 'connect', label: 'Strut', key: 'c' },
  { id: 'order', label: 'Order', key: 'o' },
];

const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'chase', label: 'Chase (data order)' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'ripple', label: 'Ripple' },
  { value: 'off', label: 'Off' },
];

/** Keyboard: tools, delete, undo/redo, escape. Ignored while typing in a field. */
export function useWorkbenchKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = useWorkbench.getState();
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
          st.remove(st.selection);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (st.pending) st.setPending(null);
        else st.select(null);
        return;
      }
      const tool = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (tool) st.setTool(tool.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const HINT: Record<Tool, string> = {
  select: 'Drag hubs on the grid · Shift-drag for height · Del removes',
  add: 'Click the plane to place a hub · it links to the selected hub',
  connect: 'Click hub, then hub · Esc ends the chain',
  order: 'Click struts in data order · click the last again to undo · Shift-click flips',
};

export function WorkbenchToolbar() {
  const tool = useWorkbench((s) => s.tool);
  const setTool = useWorkbench((s) => s.setTool);
  const snap = useWorkbench((s) => s.snap);
  const workZ = useWorkbench((s) => s.workZ);
  const showParts = useWorkbench((s) => s.showParts);
  const showChain = useWorkbench((s) => s.showChain);
  const showLabels = useWorkbench((s) => s.showLabels);
  const past = useWorkbench((s) => s.past.length);
  const future = useWorkbench((s) => s.future.length);
  const wb = useWorkbench((s) => s.set);
  const undo = useWorkbench((s) => s.undo);
  const redo = useWorkbench((s) => s.redo);
  const view = useStore((s) => s.view);
  const effect = useStore((s) => s.effect);
  const plateIndex = useStore((s) => s.plateIndex);
  const set = useStore((s) => s.set);
  const { plates } = usePlates();

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
            {TOOLS.map((t) => (
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
          {tool === 'add' && (
            <label className="inline">
              Plane Z
              <input className="num-input" type="number" step={snap || 1} value={workZ} onChange={(e) => wb('workZ', Number(e.target.value))} />
            </label>
          )}
          <div className="seg" aria-label="Show">
            <button className={showParts ? 'on' : ''} aria-pressed={showParts} onClick={() => wb('showParts', !showParts)}>
              Parts
            </button>
            <button className={showChain ? 'on' : ''} aria-pressed={showChain} onClick={() => wb('showChain', !showChain)}>
              Data path
            </button>
            <button className={showLabels ? 'on' : ''} aria-pressed={showLabels} onClick={() => wb('showLabels', !showLabels)}>
              IDs
            </button>
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
          <span className="wb-hint">{HINT[tool]}</span>
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
