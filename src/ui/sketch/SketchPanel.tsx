import { useMemo, useState } from 'react';
import { textStrokes } from '../../geom/font';
import { add, dist, norm, scale, sub } from '../../geom/vec';
import { applyGenerate, canGenerate, planGenerate, planSize } from '../../sketch/generate';
import { planeFrom3 } from '../../sketch/geom';
import { placeArtwork, textArtwork, type Artwork } from '../../sketch/import';
import { centroid, entities, entityPoints, linearArray, mapEntity, mirrorMap, polarArray, type Entity } from '../../sketch/ops';
import { activePlane, ids, useSketch, type PlaneKind } from '../../sketch/store';
import type { Vec3 } from '../../types';
import { getCore, SYSTEM_CORES } from '../../workbench/cores';
import { designOf, paramsOf, useBench } from '../../workbench/store';
import { registerBenchKeyHandler, registerBenchTools } from '../bench/BenchToolbar';
import { boldTextArtwork, svgArtwork } from './artwork';
import { finishDraft, sketchCursor } from './SketchLayer';
import type { SketchPath, SketchRegion } from '../../sketch/types';

const TOOLS = [
  { id: 'draw:select', label: 'Pick', key: 's', hint: 'Click shapes to select · Shift adds · Del removes · Esc leaves drawing' },
  { id: 'draw:line', label: 'Line', key: 'l', hint: 'Click points · double-click or Enter ends · click the first point to close · X / Y / Z turn onto a new plane (3D)' },
  { id: 'draw:rect', label: 'Rect', key: 'r', hint: 'Click two corners' },
  { id: 'draw:circle', label: 'Circle', key: 'e', hint: 'Click the centre, then the edge' },
  { id: 'draw:polygon', label: 'Polygon', key: 'p', hint: 'Click the centre, then a corner' },
  { id: 'draw:arc', label: 'Arc', key: 'a', hint: 'Click the start, the end, then a point on the arc' },
  { id: 'draw:free', label: 'Free', key: 'f', hint: 'Drag to draw · end where you began to make a filled shape' },
];
registerBenchTools(TOOLS);

/* Draw-tool keys run before the bench defaults. */
registerBenchKeyHandler((e, tool) => {
  if (!tool.startsWith('draw:')) return false;
  const st = useSketch.getState();
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && (k === 'z' || k === 'y')) {
    e.preventDefault();
    if (k === 'y' || e.shiftKey) st.redo();
    else st.undo();
    return true;
  }
  if (mod || e.altKey) return false;
  const d = st.draft;
  if (e.key === 'Enter') {
    finishDraft(false);
    return true;
  }
  if (e.key === 'Escape') {
    if (d) st.setDraft(null);
    else if (st.selected.length) st.clearSelection();
    else useBench.getState().setTool('select');
    return true;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (d?.pts.length) st.setDraft(d.pts.length > 1 ? { ...d, pts: d.pts.slice(0, -1), planes: d.planes.slice(0, -1) } : null);
    else st.removeSelected();
    return true;
  }
  // 3D sketch: turn onto a new plane through the last point.
  if (d?.tool === 'draw:line' && d.pts.length && (k === 'x' || k === 'y' || k === 'z')) {
    const last = d.pts[d.pts.length - 1];
    if (k === 'z') st.setPlane('XY', last[2]);
    if (k === 'y') st.setPlane('XZ', last[1]);
    if (k === 'x') st.setPlane('YZ', last[0]);
    return true;
  }
  return false;
});

const PLANES: { kind: PlaneKind; label: string; axis: string }[] = [
  { kind: 'XY', label: 'Floor XY', axis: 'Z' },
  { kind: 'XZ', label: 'Front XZ', axis: 'Y' },
  { kind: 'YZ', label: 'Side YZ', axis: 'X' },
];

function selectedEntities(): Entity[] {
  const { sketch, selected } = useSketch.getState();
  const all = entities(sketch);
  return selected.length ? all.filter((en) => selected.includes(en.e.id)) : all;
}

function addEntities(list: Entity[]) {
  const paths: SketchPath[] = [];
  const regions: SketchRegion[] = [];
  for (const x of list) {
    if (x.kind === 'path') paths.push(x.e);
    else regions.push(x.e);
  }
  useSketch.getState().add(paths, regions);
}

/** Typed length: extend the line in progress toward the cursor by exactly `mm`. */
function addSegment(mm: number) {
  const st = useSketch.getState();
  const d = st.draft;
  const cur = sketchCursor.current;
  if (!d || d.tool !== 'draw:line' || !d.pts.length || !cur || mm <= 0) return false;
  const last = d.pts[d.pts.length - 1];
  if (dist(cur, last) < 1e-6) return false;
  const p = add(last, scale(norm(sub(cur, last)), mm));
  st.setDraft({ ...d, pts: [...d.pts, p], planes: [...d.planes, activePlane(st)] });
  return true;
}

function place(art: Artwork, width: number, flipY: boolean, source: 'text' | 'svg') {
  const st = useSketch.getState();
  const out = placeArtwork(art, { plane: activePlane(st), width, flipY, source }, ids(st.sketch));
  st.add(out.paths, out.regions);
  return out.paths.length + out.regions.length;
}

function Num({ label, value, onChange, step = 1, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string }) {
  return (
    <label className="sk-num">
      <span>{label}</span>
      <input className="num-input" type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {unit && <i>{unit}</i>}
    </label>
  );
}

export function SketchPanel() {
  const tool = useBench((s) => s.tool);
  const setTool = useBench((s) => s.setTool);
  const system = useBench((s) => s.system);
  const sketch = useSketch((s) => s.sketch);
  const selected = useSketch((s) => s.selected);
  const planeKind = useSketch((s) => s.planeKind);
  const offset = useSketch((s) => s.offset);
  const angleSnap = useSketch((s) => s.angleSnap);
  const vertexSnap = useSketch((s) => s.vertexSnap);
  const show = useSketch((s) => s.show);
  const sides = useSketch((s) => s.sides);
  const sk = useSketch.getState;

  const [text, setText] = useState('PIXEL');
  const [textH, setTextH] = useState(60);
  const [bold, setBold] = useState(false);
  const [svgW, setSvgW] = useState(300);
  const [msg, setMsg] = useState('');
  const [segLen, setSegLen] = useState(100);
  const draft = useSketch((s) => s.draft);
  const [count, setCount] = useState(3);
  const [step, setStep] = useState<Vec3>([150, 0, 0]);
  const [polarN, setPolarN] = useState(6);
  const [polarDeg, setPolarDeg] = useState(360);
  const generators = SYSTEM_CORES.filter(canGenerate);
  // Follows the active system until you pick another target.
  const [picked, setTarget] = useState<string | null>(null);
  const target = picked ?? system;
  const core = getCore(generators.some((c) => c.id === target) ? target : (generators[0]?.id ?? system));
  const plan = useMemo(() => planGenerate(sketch, selected, core), [sketch, selected, core]);
  const total = sketch.paths.length + sketch.regions.length;

  const exitOrPick = (id: string) => setTool(tool === id ? 'select' : id);

  const mirror = (axis: Vec3) => {
    const list = selectedEntities();
    const c = centroid(list.flatMap(entityPoints));
    const next = ids(sk().sketch);
    addEntities(list.map((en) => mapEntity(en, mirrorMap(c, axis), en.kind === 'path' ? next.path() : next.region())));
  };
  const linear = () => {
    const list = selectedEntities();
    const next = ids(sk().sketch);
    addEntities(list.flatMap((en) => linearArray(en, count, step, en.kind === 'path' ? next.path : next.region)));
  };
  const polar = () => {
    const list = selectedEntities();
    const next = ids(sk().sketch);
    const pl = activePlane(sk());
    // Around the plane normal, through the plane origin: draw off-centre, array around the middle.
    const axis = [pl.u[1] * pl.v[2] - pl.u[2] * pl.v[1], pl.u[2] * pl.v[0] - pl.u[0] * pl.v[2], pl.u[0] * pl.v[1] - pl.u[1] * pl.v[0]] as Vec3;
    addEntities(list.flatMap((en) => polarArray(en, polarN, pl.origin, axis, polarDeg, en.kind === 'path' ? next.path : next.region)));
  };
  const customPlane = () => {
    const st = sk();
    const path = st.sketch.paths.find((p) => st.selected.includes(p.id)) ?? st.sketch.paths[st.sketch.paths.length - 1];
    if (!path || path.pts.length < 3) return setMsg('Select a path with three or more points first.');
    const pl = planeFrom3(path.pts[0], path.pts[Math.floor(path.pts.length / 2)], path.pts[path.pts.length - 1]);
    if (!pl) return setMsg('Those points are in a straight line.');
    st.setPlane('custom', 0, pl);
    setMsg('Drawing on the plane through that path.');
  };
  const generate = () => {
    if (!planSize(plan)) return;
    const bench = useBench.getState();
    bench.setSystem(core.id);
    const b = useBench.getState();
    b.commit(applyGenerate(core, designOf(b), paramsOf(b), plan), { frameSeq: b.frameSeq + 1, selection: null, pending: null });
    b.setTool('select');
    setTarget(null);
    setMsg(`Generated ${planSize(plan)} shape${planSize(plan) === 1 ? '' : 's'} into ${core.name}. Ctrl+Z on the bench undoes it.`);
  };

  return (
    <>
      <section className="sketch">
        <h3>Draw</h3>
        <div className="sk-tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} onClick={() => exitOrPick(t.id)} title={`${t.hint} (${t.key.toUpperCase()})`}>
              {t.label}
              <kbd>{t.key.toUpperCase()}</kbd>
            </button>
          ))}
        </div>
        {tool === 'draw:polygon' && <Num label="Sides" value={sides} onChange={(v) => useSketch.getState().set('sides', Math.max(3, Math.min(24, Math.round(v))))} />}
        {tool === 'draw:line' && (
          <div className="sk-row">
            <Num label="Next" value={segLen} onChange={setSegLen} unit="mm" />
            <button className="small" disabled={!draft?.pts.length} onClick={() => addSegment(segLen)} title="Adds a segment of exactly this length toward the cursor">
              Add segment
            </button>
          </div>
        )}
        <div className="sk-row">
          <div className="seg" aria-label="Drawing plane">
            {PLANES.map((p) => (
              <button key={p.kind} className={planeKind === p.kind ? 'on' : ''} aria-pressed={planeKind === p.kind} onClick={() => sk().setPlane(p.kind)}>
                {p.kind}
              </button>
            ))}
            <button className={planeKind === 'custom' ? 'on' : ''} onClick={customPlane} title="Plane through the selected (or last) path">
              3-pt
            </button>
          </div>
          {planeKind !== 'custom' && <Num label={PLANES.find((p) => p.kind === planeKind)!.axis} value={offset} onChange={(v) => sk().set('offset', v)} unit="mm" />}
        </div>
        <div className="sk-row">
          <label className="sk-check">
            <input type="checkbox" checked={angleSnap} onChange={(e) => sk().set('angleSnap', e.target.checked)} /> 15° angles
          </label>
          <label className="sk-check">
            <input type="checkbox" checked={vertexSnap} onChange={(e) => sk().set('vertexSnap', e.target.checked)} /> Snap to points
          </label>
          <label className="sk-check">
            <input type="checkbox" checked={show} onChange={(e) => sk().set('show', e.target.checked)} /> Show
          </label>
        </div>
        <p className="sk-tip">Line tool: X, Y or Z turns the next segment onto a new plane through the last point. That's how you sketch in 3D.</p>
      </section>

      <section className="sketch">
        <h3>Text &amp; SVG</h3>
        <div className="sk-row">
          <input className="sk-text" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text" maxLength={40} />
          <Num label="H" value={textH} onChange={setTextH} unit="mm" />
        </div>
        <div className="sk-row">
          <label className="sk-check">
            <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Filled outline
          </label>
          <button
            className="small"
            disabled={!text.trim()}
            onClick={async () => {
              const width = textStrokes(text, textH).width;
              const art = bold ? await boldTextArtwork(text, textH, textH * 0.16) : textArtwork(text, textH);
              const n = place(art, width + (bold ? textH * 0.16 : 0), false, 'text');
              setMsg(`Placed "${text}" as ${n} ${bold ? 'filled shapes' : 'single-line paths'}.`);
            }}
          >
            Place text
          </button>
        </div>
        <div className="sk-row">
          <label className="sk-file">
            SVG…
            <input
              type="file"
              accept=".svg,image/svg+xml"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const n = place(svgArtwork(await f.text()), svgW, true, 'svg');
                  setMsg(n ? `Imported ${f.name}: ${n} shapes.` : `${f.name} had no usable shapes.`);
                } catch (err) {
                  setMsg(`Could not read ${f.name}: ${(err as Error).message}`);
                }
              }}
            />
          </label>
          <Num label="W" value={svgW} onChange={setSvgW} unit="mm" />
        </div>
      </section>

      <section className="sketch">
        <h3>
          Arrange <span className="sk-count">{selected.length ? `${selected.length} selected` : `all ${total}`}</span>
        </h3>
        <div className="sk-row">
          <span className="sk-label">Mirror</span>
          <div className="seg">
            {(['X', 'Y', 'Z'] as const).map((a, i) => (
              <button key={a} disabled={!total} onClick={() => mirror([i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0])} title={`Mirror across the ${a} axis through the shapes' centre`}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="sk-row">
          <Num label="×" value={count} onChange={(v) => setCount(Math.max(2, Math.min(50, Math.round(v))))} />
          {(['dx', 'dy', 'dz'] as const).map((k, i) => (
            <Num key={k} label={k} value={step[i]} onChange={(v) => setStep((s) => s.map((x, j) => (j === i ? v : x)) as Vec3)} />
          ))}
          <button className="small" disabled={!total} onClick={linear}>
            Array
          </button>
        </div>
        <div className="sk-row">
          <Num label="×" value={polarN} onChange={(v) => setPolarN(Math.max(2, Math.min(72, Math.round(v))))} />
          <Num label="°" value={polarDeg} onChange={setPolarDeg} />
          <button className="small" disabled={!total} onClick={polar} title="Copies around the drawing plane's origin">
            Polar
          </button>
        </div>
        <div className="sk-row">
          <button className="small" disabled={!total} onClick={() => sk().selectAll()}>
            Select all
          </button>
          <button className="small" disabled={!selected.length} onClick={() => sk().removeSelected()}>
            Delete
          </button>
          <button className="small" disabled={!total} onClick={() => sk().clearAll()}>
            Clear
          </button>
        </div>
      </section>

      <section className="sketch">
        <h3>Generate</h3>
        {generators.length ? (
          <>
            <div className="sk-row">
              <select value={core.id} onChange={(e) => setTarget(e.target.value)} aria-label="Target system">
                {generators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
              <button className="primary small" disabled={!planSize(plan)} onClick={generate}>
                Generate
              </button>
            </div>
            <p className="sk-tip">
              {planSize(plan)
                ? `${plan.regions.length} region${plan.regions.length === 1 ? '' : 's'} · ${plan.paths.length} path${plan.paths.length === 1 ? '' : 's'} · ${plan.paths3d.length} 3D path${plan.paths3d.length === 1 ? '' : 's'} → ${core.name}${plan.skipped ? ` (${plan.skipped} it can't use)` : ''}.`
                : 'Draw something, or select shapes, to generate from.'}
            </p>
          </>
        ) : (
          <p className="sk-tip">No system takes drawings yet.</p>
        )}
        {msg && <p className="sk-msg">{msg}</p>}
      </section>
    </>
  );
}
