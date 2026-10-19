import { getFixture } from '../fixtures/registry';
import { resolveParams } from '../fixtures/util';
import { getPixel, pixelSpec } from '../pixels/library';
import type { ParamSpec, ParamValue } from '../types';
import { useStore } from './store';

function Field({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue; onChange: (v: ParamValue) => void }) {
  const id = `p-${spec.key}`;
  if (spec.type === 'boolean') {
    return (
      <label className="field toggle" htmlFor={id} title={spec.help}>
        <span>{spec.label}</span>
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch" aria-hidden />
      </label>
    );
  }
  if (spec.type === 'select' || spec.type === 'pixel') {
    const options =
      spec.type === 'pixel' ? (spec.pixels ?? []).map((pid) => ({ value: pid, label: getPixel(pid).name })) : (spec.options ?? []);
    return (
      <label className="field" htmlFor={id} title={spec.help}>
        <span>{spec.label}</span>
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {spec.type === 'pixel' && <small className="spec">{pixelSpec(getPixel(String(value)))}</small>}
      </label>
    );
  }
  const n = Number(value);
  return (
    <label className="field" htmlFor={id} title={spec.help}>
      <span>
        {spec.label}
        <output>
          {Number.isInteger(spec.step ?? 1) ? n : n.toFixed(2)}
          {spec.unit && <i>{spec.unit}</i>}
        </output>
      </span>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        value={n}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {spec.help && <small>{spec.help}</small>}
    </label>
  );
}

export function Inspector() {
  const fixtureId = useStore((s) => s.fixtureId);
  const stored = useStore((s) => s.params[fixtureId]);
  const setParam = useStore((s) => s.setParam);
  const reset = useStore((s) => s.resetParams);
  const def = getFixture(fixtureId);
  const values = resolveParams(def, stored);

  const groups = new Map<string, ParamSpec[]>();
  for (const p of def.params) groups.set(p.group ?? 'Settings', [...(groups.get(p.group ?? 'Settings') ?? []), p]);

  return (
    <aside className="inspector" aria-label="Fixture parameters">
      <header>
        <div className="eyebrow">
          {def.code} · {def.family === 'modular' ? 'modular unit' : def.family === 'utility' ? 'shop' : 'fixture'}
        </div>
        <h2>{def.name}</h2>
        <p>{def.description}</p>
      </header>
      {[...groups.entries()].map(([g, specs]) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {specs.map((s) => (
            <Field key={s.key} spec={s} value={values[s.key]} onChange={(v) => setParam(s.key, v)} />
          ))}
        </fieldset>
      ))}
      <button className="ghost" onClick={reset}>
        Reset to defaults
      </button>
    </aside>
  );
}
