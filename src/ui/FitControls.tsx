import { declaresFit, FIT_PARAMS } from '../fit';
import type { FixtureDef, Params, ParamValue } from '../types';
import { useStore } from './store';

/**
 * The Fit group for any fixture or Workbench system that declares the fit params: shows the
 * global fit gap and seat clearance, and lets this fixture override either one.
 */
export function FitControls({
  def,
  stored,
  setParam,
  unsetParam,
}: {
  def: FixtureDef;
  stored: Params | undefined;
  setParam: (k: string, v: ParamValue) => void;
  unsetParam: (k: string) => void;
}) {
  const fitGap = useStore((s) => s.fitGap);
  const seat = useStore((s) => s.seatClearance);
  if (!declaresFit(def)) return null;
  const rows = [
    { spec: FIT_PARAMS[0], global: fitGap },
    { spec: FIT_PARAMS[1], global: seat },
  ];
  return (
    <fieldset className="fit-controls">
      <legend>Fit</legend>
      {rows.map(({ spec, global }) => {
        const own = stored?.[spec.key];
        const overridden = own !== undefined;
        const value = overridden ? Number(own) : global;
        const id = `fit-${spec.key}`;
        return (
          <div className="field" key={spec.key} title={spec.help}>
            <span>
              {spec.label}
              <output>
                {value.toFixed(2)}
                <i>mm</i> {overridden ? <em className="fit-own">this fixture</em> : <em>global</em>}
              </output>
            </span>
            {overridden ? (
              <input id={id} type="range" min={spec.min} max={spec.max} step={spec.step} value={value} onChange={(e) => setParam(spec.key, Number(e.target.value))} aria-label={spec.label} />
            ) : null}
            <button type="button" className="ghost small" onClick={() => (overridden ? unsetParam(spec.key) : setParam(spec.key, global))}>
              {overridden ? `Use global (${global.toFixed(2)} mm)` : 'Override for this fixture'}
            </button>
          </div>
        );
      })}
      <small className="fit-note">Every mating part is modelled with this gap, and the exported 3MF records it.</small>
    </fieldset>
  );
}

/** Header control for the global fit gap and seat clearance. */
export function GlobalFit() {
  const fitGap = useStore((s) => s.fitGap);
  const seat = useStore((s) => s.seatClearance);
  const setFit = useStore((s) => s.setFit);
  return (
    <div className="global-fit" title="Fit gap between printed parts · pixel seat clearance">
      <label className="inline">
        Fit
        <input className="num-input" type="number" min={0} max={1} step={0.05} value={fitGap} onChange={(e) => setFit(Number(e.target.value), seat)} aria-label="Fit gap, mm" />
      </label>
      <label className="inline">
        Seat
        <input className="num-input" type="number" min={0} max={0.6} step={0.05} value={seat} onChange={(e) => setFit(fitGap, Number(e.target.value))} aria-label="Pixel seat clearance, mm" />
      </label>
    </div>
  );
}
