import { getCore, PLANNED_SYSTEMS, SYSTEM_CORES } from '../../workbench/cores';
import { useBench } from '../../workbench/store';
import { getUI } from '../../workbench/uis';
import type { ReactNode } from 'react';

/** Left panel on the bench: systems, then the active system's palette (its own sections), then its presets. */
export function BenchCatalog({ extra }: { extra?: ReactNode }) {
  const system = useBench((s) => s.system);
  const setSystem = useBench((s) => s.setSystem);
  const loadPreset = useBench((s) => s.loadPreset);
  const clear = useBench((s) => s.clear);
  const core = getCore(system);
  const Palette = getUI(system).Palette;
  const built = new Set(SYSTEM_CORES.map((c) => c.code + c.name));

  return (
    <nav className="catalog" aria-label="Workbench">
      <section>
        <h3>Systems</h3>
        {SYSTEM_CORES.map((c) => (
          <button key={c.id} className={`fixture-card${c.id === system ? ' active' : ''}`} onClick={() => setSystem(c.id)} aria-pressed={c.id === system}>
            <span className="code">{c.code}</span>
            <span className="body">
              <span className="name">{c.name}</span>
              <span className="tag">{c.tagline}</span>
            </span>
          </button>
        ))}
        {PLANNED_SYSTEMS.filter((p) => !built.has(p.code + p.name)).map((p) => (
          <div key={p.code + p.name} className="fixture-card planned" title={p.tagline}>
            <span className="code">{p.code}</span>
            <span className="body">
              <span className="name">
                {p.name} <em>drawing board</em>
              </span>
              <span className="tag">{p.tagline}</span>
            </span>
          </div>
        ))}
      </section>

      {extra}

      <Palette key={system} />

      <section>
        <h3>Presets</h3>
        {core.presets.map((p) => (
          <button key={p.id} className="fixture-card" onClick={() => loadPreset(p.id)}>
            <span className="code">{p.code}</span>
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
            <span className="tag">Start from nothing.</span>
          </span>
        </button>
      </section>
    </nav>
  );
}
