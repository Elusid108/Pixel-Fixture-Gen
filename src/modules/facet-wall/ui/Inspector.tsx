import { fmt, plural } from '../../shared/layout';
import { NameInput, NumInput, ParamGroups, patchOf, Stat, useBuiltReport } from '../../shared/ui';
import type { FwLayout } from '../layout';
import type { Level } from '../model';
import { FW_PARAMS } from '../params';
import { parseVertexId, tileOfSel, tileSelId, vertexId } from '../system';
import { DEPTH_COLORS } from './Scene';
import { useFw, useFwLayout, useFwParams } from './useFw';

const D = (l: number) => `D${l + 1}`;

function DriverPanel() {
  const driver = useFw((s) => s.design.driver);
  const setDriver = useFw((s) => s.setDriver);
  const pct = (v: number) => Math.round(v * 100);
  return (
    <fieldset>
      <legend>Depth driver</legend>
      <div className="buttons">
        <button aria-pressed={driver.kind === 'gradient'} className={driver.kind === 'gradient' ? 'active' : ''} onClick={() => setDriver({ kind: 'gradient' })}>
          Gradient
        </button>
        <button aria-pressed={driver.kind === 'image'} className={driver.kind === 'image' ? 'active' : ''} onClick={() => setDriver({ kind: 'image' })}>
          Picture
        </button>
      </div>
      {driver.kind === 'gradient' ? (
        <div className="xyz-row">
          <NumInput label="Angle °" value={driver.angle} onCommit={(v) => setDriver({ angle: ((Math.round(v) % 360) + 360) % 360 })} />
        </div>
      ) : (
        <p className="dim">Set the picture under Depth below. Brighter stands further off the wall; the picture is stretched over the outline.</p>
      )}
      <div className="xyz-row">
        <NumInput label="Start %" value={pct(driver.start)} onCommit={(v) => setDriver({ start: Math.min(100, Math.max(0, v)) / 100 })} />
        <NumInput label="End %" value={pct(driver.end)} onCommit={(v) => setDriver({ end: Math.min(100, Math.max(0, v)) / 100 })} />
      </div>
      <label className="field toggle">
        <span>Invert (swap shallow and deep)</span>
        <input type="checkbox" checked={driver.invert} onChange={() => setDriver({ invert: !driver.invert })} />
        <span className="switch" aria-hidden />
      </label>
    </fieldset>
  );
}

function DesignPanel({ L }: { L: FwLayout }) {
  const name = useFw((s) => s.design.name);
  const rename = useFw((s) => s.rename);
  const overrides = useFw((s) => Object.keys(s.design.overrides).length);
  const omitted = useFw((s) => s.design.omit.length);
  const areas = useFw((s) => s.design.areas.length);
  const values = useFwParams();
  const prints = L.classes.length;
  const lead = L.dims.lead;
  return (
    <>
      <header>
        <div className="eyebrow">M5 · Facet Wall</div>
        <NameInput name={name} onRename={rename} />
        <p>
          {areas
            ? 'Click a facet to inspect it, or use the Depth tool (D) to set facets by hand. Facets of one depth print as one part; backer tiles that match print as one part.'
            : 'Draw a closed shape with the sketch tools and send it here: it fills with whole triangles.'}
        </p>
      </header>
      <dl className="stats">
        <Stat
          k="Facets"
          v={
            <>
              {L.chain.length}{' '}
              {L.counts.map((n, i) => (
                <span key={i} className="chip" style={{ color: DEPTH_COLORS[i] }}>
                  {D(i)} ×{n}
                </span>
              ))}
            </>
          }
        />
        <Stat k="Backer tiles" v={`${L.tiles.length} → ${plural(prints, 'part')} (${L.classes.map((c) => `${c.id} ×${c.members.length}`).join(', ') || '—'})`} />
        <Stat k="Tile size" v={`${L.k} facets a side, sized for the ${L.bedName}`} />
        <Stat k="Pixels" v={`${L.chain.length} × ${L.dims.pixel.name}`} />
        <Stat k="Node spacing" v={`${fmt(L.spacing)} mm centre to centre · lead ${lead} mm`} tone={L.spacing > lead ? 'bad' : 'ok'} />
        <Stat k="Strand" v={L.longGaps.length ? `${plural(L.longGaps.length, 'run')} over the lead (longest ${Math.round(L.maxGap)} mm)` : `longest run ${Math.round(L.maxGap)} mm`} tone={L.longGaps.length ? 'warn' : 'ok'} />
        <Stat k="Set by hand" v={`${plural(overrides, 'facet')} · ${omitted} knocked out`} />
      </dl>
      {L.warnings.map((w) => (
        <p key={w} className="warn">
          {w}
        </p>
      ))}
      <DriverPanel />
      <ParamGroups specs={FW_PARAMS} values={values} />
    </>
  );
}

function FacetPanel({ L, id }: { L: FwLayout; id: string }) {
  const setDepth = useFw((s) => s.setDepth);
  const toggleOmit = useFw((s) => s.toggleOmit);
  const select = useFw((s) => s.select);
  const report = useBuiltReport('facet-wall');
  const f = L.byKey.get(id);
  if (!f) return <p className="dim">Facet {id} is no longer inside the outline.</p>;
  const tile = L.tiles.find((t) => t.id === f.tile);
  return (
    <>
      <header>
        <div className="eyebrow">Facet{f.omitted ? ' · knocked out' : ''}</div>
        <h2>
          {f.key} <span className="chip">{f.up ? 'up' : 'down'}</span>
        </h2>
      </header>
      <dl className="stats">
        <Stat k="Depth" v={`${D(f.level)} · ${fmt(L.dims.heights[f.level])} mm off the backer${f.overridden ? ' (set by hand)' : ''}`} />
        <Stat k="Driver says" v={`${D(f.auto)} (${Math.round(f.value * 100)}%)`} />
        <Stat k="Tile" v={tile ? `${tile.id} · backer ${tile.cls}` : '—'} />
        <Stat k="Data" v={f.order >= 0 ? `node ${f.order + 1} of ${L.chain.length}` : '—'} />
        {tile && <Stat k="Patch" v={patchOf(report, tile.id) || 'building…'} />}
      </dl>
      <fieldset>
        <legend>Depth</legend>
        <div className="buttons">
          {([0, 1, 2] as Level[]).map((l) => (
            <button key={l} aria-pressed={f.overridden && f.level === l} className={f.overridden && f.level === l ? 'active' : ''} onClick={() => setDepth(f.key, l)}>
              {D(l)}
            </button>
          ))}
          <button disabled={!f.overridden} onClick={() => setDepth(f.key, null)}>
            Follow the driver
          </button>
        </div>
      </fieldset>
      <div className="buttons">
        <button onClick={() => toggleOmit(f.key)}>{f.omitted ? 'Put the facet back' : 'Knock out this facet'}</button>
        {tile && <button onClick={() => select({ kind: 'tile', id: tileSelId(tile.id, tile.facets) })}>Tile {tile.id}</button>}
      </div>
    </>
  );
}

function TilePanel({ L, id }: { L: FwLayout; id: string }) {
  const remove = useFw((s) => s.remove);
  const report = useBuiltReport('facet-wall');
  const t = L.tiles.find((x) => x.id === tileOfSel(id));
  if (!t) return <p className="dim">That tile changed. Select a facet to find its tile.</p>;
  const cls = L.classes.find((c) => c.id === t.cls);
  const i = L.tiles.indexOf(t);
  return (
    <>
      <header>
        <div className="eyebrow">Backer tile{cls?.full ? '' : ' · edge piece'}</div>
        <h2>
          {t.id} <span className="chip">{cls && cls.members.length > 1 ? `${cls.id} ×${cls.members.length}` : `${t.cls} · unique`}</span>
        </h2>
      </header>
      <dl className="stats">
        <Stat k="Facets" v={`${t.facets.length} · ${t.depths.map((n, l) => `${D(l)} ${n}`).join(' · ')}`} />
        <Stat k="Data" v={`${i + 1} of ${L.tiles.length}${i ? ` · from ${L.tiles[i - 1].id}` : ' · data in'}`} />
        <Stat k="Patch" v={patchOf(report, t.id) || 'building…'} />
        <Stat k="Wall screws" v={t.screws} />
        <Stat k="Magnets" v={L.dims.magnets ? `${2 * t.shared} on ${plural(t.shared, 'shared edge')}` : 'off'} />
        {cls && <Stat k="Print" v={`${fmt(cls.size[0])} × ${fmt(cls.size[1])} mm, face down${cls.printRot ? `, turned ${cls.printRot}°` : ''}`} />}
      </dl>
      <div className="buttons">
        <button onClick={() => remove({ kind: 'tile', id: tileSelId(t.id, t.facets) })}>Knock out the whole tile</button>
      </div>
    </>
  );
}

function VertexPanel({ id }: { id: string }) {
  const design = useFw((s) => s.design);
  const moveVertex = useFw((s) => s.moveVertex);
  const remove = useFw((s) => s.remove);
  const v = parseVertexId(id);
  const area = v ? design.areas.find((a) => a.id === v.area) : undefined;
  const loop = area && v ? [area.outer, ...area.holes][v.loop] : undefined;
  const p = loop && v ? loop[v.i] : undefined;
  if (!v || !area || !loop || !p) return <p className="dim">That corner is gone.</p>;
  return (
    <>
      <header>
        <div className="eyebrow">Outline corner{v.loop ? ` · hole ${v.loop}` : ''}</div>
        <h2>
          {area.id} <span className="chip">#{v.i + 1} of {loop.length}</span>
        </h2>
      </header>
      <fieldset>
        <legend>Position on the wall (mm)</legend>
        <div className="xyz-row">
          {['Across', 'Up'].map((l, k) => (
            <NumInput key={l} label={l} value={p[k]} onCommit={(n) => moveVertex(id, k ? [p[0], n] : [n, p[1]])} />
          ))}
        </div>
      </fieldset>
      <div className="buttons">
        <button disabled={loop.length <= 3 && v.loop === 0} onClick={() => remove({ kind: 'vertex', id: vertexId(area.id, v.loop, v.i) })}>
          Delete corner
        </button>
        <button onClick={() => remove({ kind: 'area', id: area.id })}>Delete outline {area.id}</button>
      </div>
    </>
  );
}

export function FwInspector() {
  const selection = useFw((s) => s.selection);
  const select = useFw((s) => s.select);
  const L = useFwLayout();
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {selection?.kind === 'facet' ? (
        <FacetPanel L={L} id={selection.id} />
      ) : selection?.kind === 'tile' ? (
        <TilePanel L={L} id={selection.id} />
      ) : selection?.kind === 'vertex' ? (
        <VertexPanel id={selection.id} />
      ) : (
        <DesignPanel L={L} />
      )}
      {selection && (
        <button className="ghost" onClick={() => select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
