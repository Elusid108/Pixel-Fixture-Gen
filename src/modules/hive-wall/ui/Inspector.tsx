import { bounds2, polygonArea } from '../../../sketch/geom';
import { fmt, plural } from '../../shared/layout';
import { NameInput, NumInput, ParamGroups, Stat } from '../../shared/ui';
import type { HwLayout } from '../layout';
import { HW_STARTS, START_LABEL, type HwStart } from '../model';
import { HW_PARAMS } from '../params';
import { useHw, useHwLayout, useHwParams } from './useHw';

const EDGE = ['upper right', 'top', 'upper left', 'lower left', 'bottom', 'lower right'];

function DesignPanel({ layout }: { layout: HwLayout }) {
  const name = useHw((s) => s.design.name);
  const lattice = useHw((s) => s.design.lattice);
  const start = useHw((s) => s.design.start);
  const areas = useHw((s) => s.design.areas.length);
  const values = useHwParams();
  const a = useHw.getState;
  const { dims: d, tiles, pieces, seams, rails } = layout;
  const studs = rails.reduce((k, r) => k + r.n, 0);
  const breaks = tiles.filter((t, k) => k > 0 && !t.linked).length;
  const watts = layout.px * d.pixel.wattsPerPx;

  return (
    <>
      <header>
        <div className="eyebrow">M1 · Hive wall</div>
        <NameInput name={name} onRename={(n) => a().rename(n)} />
        <p>
          Whole tiles print as one set ×N; tiles crossing the outline are trimmed exactly and closed off along the cut. Use the Tile tool (T) to switch slots off or on.
        </p>
      </header>
      <dl className="stats">
        <Stat k="Tiles" v={`${layout.full} whole ${d.size} · ${layout.partial} trimmed (${plural(pieces.length, 'shape')})`} />
        {layout.dropped > 0 && <Stat k="Left out" v={`${plural(layout.dropped, 'sliver')} under ${Math.round(d.minArea * 100)} %`} tone="warn" />}
        <Stat k="Cells" v={`${layout.px} px · ${layout.px * d.pixel.chPerPx} ch · ${fmt(watts)} W`} />
        <Stat k="Wall" v={tiles.length ? `${Math.round(layout.size.w)} × ${Math.round(layout.size.h)} mm` : '—'} />
        <Stat k="Tile" v={`${d.size} · ${fmt(2 * d.A)} mm across flats · ${d.pitch} mm pitch`} tone={d.fallback ? 'warn' : undefined} />
        <Stat k="Seams" v={`${seams.length} · ${d.magnets ? `${seams.length * 4} magnets` : 'no magnets'} · ${d.bowties ? `${seams.length} keys` : 'no keys'}`} />
        {d.rail && <Stat k="Cleat rails" v={`${plural(rails.length, 'segment')} · ${plural(studs, 'stud')}`} />}
        <Stat k="Data" v={`${layout.order} serpentine from ${START_LABEL[start].toLowerCase()}${breaks ? ` · ${plural(breaks, 'extension lead')}` : ''}`} tone={breaks ? 'warn' : undefined} />
      </dl>
      {d.fallback && <p className="dim">{d.fallback}</p>}
      <fieldset>
        <legend>Lattice (plane mm, °)</legend>
        <div className="xyz-row">
          <NumInput label="X" value={lattice.offset[0]} onCommit={(v) => a().setLattice({ offset: [v, lattice.offset[1]] })} />
          <NumInput label="Y" value={lattice.offset[1]} onCommit={(v) => a().setLattice({ offset: [lattice.offset[0], v] })} />
          <NumInput label="Turn" value={lattice.rot} onCommit={(v) => a().setLattice({ rot: v })} />
        </div>
        <div className="buttons">
          <button disabled={!areas} onClick={() => a().centreLattice()}>
            Centre on the outline
          </button>
        </div>
        <label className="field">
          <span>Data starts</span>
          <select value={start} onChange={(e) => a().setStart(e.target.value as HwStart)}>
            {HW_STARTS.map((s) => (
              <option key={s} value={s}>
                {START_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <ParamGroups specs={HW_PARAMS} values={values} />
    </>
  );
}

function TilePanel({ layout, id }: { layout: HwLayout; id: string }) {
  const a = useHw.getState;
  const s = layout.bySlot.get(id);
  const t = layout.tiles.find((x) => x.slot.key === id);
  if (!s) {
    return (
      <header>
        <div className="eyebrow">Slot {id}</div>
        <p className="dim">Outside the outline. Switch it on with the Tile tool to place a whole tile.</p>
      </header>
    );
  }
  const placed = Boolean(t);
  const state = s.state === 'full' ? 'whole tile' : s.state === 'partial' ? 'trimmed edge tile' : s.state === 'whole' ? 'whole tile, placed by hand' : s.state === 'off' ? 'switched off' : s.state === 'dropped' ? 'sliver, left out' : 'outside the outline';
  const intact = s.edges.map((e, k) => (e ? EDGE[k] : null)).filter(Boolean);
  return (
    <>
      <header>
        <div className="eyebrow">Tile slot {id}</div>
        <h2>
          {t ? t.unit : 'Empty'} {t && t.piece !== 'full' && <span className="chip">{`${t.piece} ×${layout.pieces.find((p) => p.id === t.piece)?.units.length ?? 1}`}</span>}
        </h2>
        <p>{state}</p>
      </header>
      <dl className="stats">
        {t && <Stat k="Position" v={t.position} />}
        <Stat k="Cells" v={placed ? `${t!.cells.length} of ${layout.dims.cells.length}` : '—'} />
        <Stat k="Inside outline" v={`${Math.round(s.ratio * 100)} %`} />
        {placed && <Stat k="Whole edges" v={intact.length === 6 ? 'all six' : intact.length ? intact.join(', ') : 'none'} tone={intact.length ? undefined : 'warn'} />}
        {placed && layout.dims.rail && <Stat k="On the rail" v={s.keyholes.filter(Boolean).length === 2 ? 'two studs' : s.keyholes.some(Boolean) ? 'one stud' : 'no stud: held by neighbours'} tone={s.keyholes.some(Boolean) ? undefined : 'warn'} />}
        {t && <Stat k="Data" v={`${t.linked ? 'in from the neighbour' : 'extension lead in'} · enters ${t.enters}`} tone={t.linked ? undefined : 'warn'} />}
      </dl>
      <div className="buttons">
        {placed ? (
          <button onClick={() => a().setOff(id, true)}>Switch off</button>
        ) : (
          <button onClick={() => a().setWhole(id, true)}>Place a whole tile</button>
        )}
        {s.state === 'partial' && <button onClick={() => a().setWhole(id, true)}>Use a whole tile</button>}
        {s.override && <button onClick={() => (s.override === 'on' ? a().setWhole(id, false) : a().setOff(id, false))}>Back to the outline</button>}
      </div>
    </>
  );
}

function AreaPanel({ id }: { id: string }) {
  const area = useHw((s) => s.design.areas.find((x) => x.id === id));
  const a = useHw.getState;
  if (!area) return null;
  const b = bounds2(area.outer);
  const mm2 = Math.abs(polygonArea(area.outer)) - area.holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
  return (
    <>
      <header>
        <div className="eyebrow">Outline</div>
        <h2>{id}</h2>
        <p>Drag its points on the wall to reshape it. Tiles re-trim as you drag.</p>
      </header>
      <dl className="stats">
        <Stat k="Points" v={area.outer.length} />
        <Stat k="Size" v={`${Math.round(b.max[0] - b.min[0])} × ${Math.round(b.max[1] - b.min[1])} mm`} />
        <Stat k="Area" v={`${fmt(mm2 / 1e6, 2)} m²`} />
        <Stat k="Windows" v={area.holes.length || 'none'} />
      </dl>
      <div className="buttons">
        <button disabled={!area.holes.length} onClick={() => a().removeHoles(id)}>
          Fill the windows
        </button>
        <button onClick={() => a().removeArea(id)}>Delete outline</button>
      </div>
    </>
  );
}

export function HwInspector() {
  const selection = useHw((s) => s.selection);
  const layout = useHwLayout();
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {selection?.kind === 'tile' ? <TilePanel layout={layout} id={selection.id} /> : selection?.kind === 'area' ? <AreaPanel id={selection.id} /> : <DesignPanel layout={layout} />}
      {selection && (
        <button className="ghost" onClick={() => useHw.getState().select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
