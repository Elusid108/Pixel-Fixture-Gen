import { PRESETS } from '../modules/strut-node';
import { useStore } from './store';
import { useWorkbench, type Tool } from './workbenchStore';

const COMPONENTS: { tool: Tool; code: string; name: string; tag: string; key: string }[] = [
  { tool: 'add', code: 'HUB', name: 'Hub', tag: 'Click the bench to place one. With a hub selected, the new one is strutted to it.', key: 'N' },
  { tool: 'connect', code: 'STR', name: 'Strut', tag: 'Click two hubs. Keep clicking to draw a chain of struts.', key: 'C' },
  { tool: 'order', code: 'DAT', name: 'Data order', tag: 'Click struts in the order data should run. Shift-click flips a strip.', key: 'O' },
  { tool: 'select', code: 'SEL', name: 'Select & move', tag: 'Drag a hub to move it on the grid. Shift-drag moves it up and down.', key: 'V' },
];

export function WorkbenchCatalog() {
  const tool = useWorkbench((s) => s.tool);
  const setTool = useWorkbench((s) => s.setTool);
  const loadPreset = useWorkbench((s) => s.loadPreset);
  const clear = useWorkbench((s) => s.clear);
  const selection = useWorkbench((s) => s.selection);
  const design = useWorkbench((s) => s.design);
  const toggleStrut = useWorkbench((s) => s.toggleStrut);
  const setController = useWorkbench((s) => s.setController);
  const setMode = useStore((s) => s.setMode);
  const setFixture = useStore((s) => s.setFixture);
  const strut = selection?.kind === 'strut' ? design.struts.find((s) => s.id === selection.id) : null;
  const node = selection?.kind === 'node' ? selection.id : null;

  return (
    <nav className="catalog" aria-label="Workbench components">
      <section>
        <h3>Systems</h3>
        <div className="fixture-card active">
          <span className="code">M4</span>
          <span className="body">
            <span className="name">Strut & Node</span>
            <span className="tag">Wireframes with hubs generated at their exact socket angles.</span>
          </span>
        </div>
        <button
          className="fixture-card"
          onClick={() => {
            setFixture('hive');
            setMode('catalog');
          }}
          title="Hive tiles are in the catalogue for now"
        >
          <span className="code">M1</span>
          <span className="body">
            <span className="name">
              Hive <em>catalogue</em>
            </span>
            <span className="tag">Single tile today. Wall layouts on the bench come next.</span>
          </span>
        </button>
        <div className="fixture-card planned">
          <span className="code">M2</span>
          <span className="body">
            <span className="name">
              Linea <em>drawing board</em>
            </span>
            <span className="tag">Bars, corners, tees on the same bench.</span>
          </span>
        </div>
      </section>

      <section>
        <h3>Components</h3>
        {COMPONENTS.map((c) => (
          <button key={c.tool} className={`fixture-card${tool === c.tool ? ' active' : ''}`} onClick={() => setTool(c.tool)} aria-pressed={tool === c.tool}>
            <span className="code">{c.code}</span>
            <span className="body">
              <span className="name">
                {c.name} <kbd>{c.key}</kbd>
              </span>
              <span className="tag">{c.tag}</span>
            </span>
          </button>
        ))}
        <button className="fixture-card" disabled={!strut} onClick={() => strut && toggleStrut(strut.id, 'dark')} title="Select a strut first">
          <span className="code">DRK</span>
          <span className="body">
            <span className="name">{strut?.dark ? 'Light this strut' : 'Dark strut'}</span>
            <span className="tag">{strut ? `${strut.id}: wire only, opaque tube, no pixels.` : 'Select a strut to make it wire-only.'}</span>
          </span>
        </button>
        <button className="fixture-card" disabled={!node || node === design.controller} onClick={() => node && setController(node)} title="Select a hub first">
          <span className="code">CTL</span>
          <span className="body">
            <span className="name">Controller hub</span>
            <span className="tag">{node ? `Feed data and power into ${node}.` : `Now ${design.controller || 'unset'}. Select a hub to move it.`}</span>
          </span>
        </button>
      </section>

      <section>
        <h3>Presets</h3>
        {PRESETS.map((p) => (
          <button key={p.id} className={`fixture-card${design.name === p.name ? ' active' : ''}`} onClick={() => loadPreset(p.id)}>
            <span className="code">{p.id === 'geo2v' ? '2V' : p.id.slice(0, 3).toUpperCase()}</span>
            <span className="body">
              <span className="name">{p.name}</span>
              <span className="tag">{p.blurb}</span>
            </span>
          </button>
        ))}
        <button className="fixture-card" onClick={clear}>
          <span className="code">NEW</span>
          <span className="body">
            <span className="name">Empty bench</span>
            <span className="tag">Start from nothing with the hub tool.</span>
          </span>
        </button>
      </section>
    </nav>
  );
}
