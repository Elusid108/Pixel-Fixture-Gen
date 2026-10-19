import { FIXTURES, PLANNED } from '../fixtures/registry';
import type { Family } from '../types';
import { useStore } from './store';

const FAMILY_LABEL: Record<Family, string> = {
  single: 'Single bed',
  assembly: 'Centrepieces & chandeliers',
  modular: 'Modular systems',
  utility: 'Shop',
};
const ORDER: Family[] = ['single', 'assembly', 'modular', 'utility'];

export function Catalog() {
  const fixtureId = useStore((s) => s.fixtureId);
  const setFixture = useStore((s) => s.setFixture);

  return (
    <nav className="catalog" aria-label="Fixture catalogue">
      {ORDER.map((fam) => {
        const built = FIXTURES.filter((f) => f.family === fam);
        const planned = PLANNED.filter((f) => f.family === fam);
        if (!built.length && !planned.length) return null;
        return (
          <section key={fam}>
            <h3>{FAMILY_LABEL[fam]}</h3>
            {built.map((f) => (
              <button key={f.id} className={`fixture-card${f.id === fixtureId ? ' active' : ''}`} onClick={() => setFixture(f.id)}>
                <span className="code">{f.code}</span>
                <span className="body">
                  <span className="name">{f.name}</span>
                  <span className="tag">{f.tagline}</span>
                </span>
              </button>
            ))}
            {planned.map((f) => (
              <div key={f.code} className="fixture-card planned" title={`${f.tagline}\n${f.schedule}`}>
                <span className="code">{f.code}</span>
                <span className="body">
                  <span className="name">
                    {f.name} <em>drawing board</em>
                  </span>
                  <span className="tag">{f.tagline}</span>
                </span>
              </div>
            ))}
          </section>
        );
      })}
    </nav>
  );
}
