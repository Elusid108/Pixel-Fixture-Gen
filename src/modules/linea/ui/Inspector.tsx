import { dist } from '../../../geom/vec';
import { fmt, plural } from '../../shared/layout';
import { NameInput, ParamGroups, Stat } from '../../shared/ui';
import { interiorAngle } from '../lock';
import { LINEA_PARAMS } from '../params';
import { nearestCatalogue, type LineaPlan } from '../plan';
import { useLinea, useLineaParams, useLineaPlan } from './useLinea';

const deg = (v: number) => `${fmt(v, 2)}°`;
const mm = (v: number) => `${fmt(v)} mm`;

function planeName(face: number[]): string {
  const [x, y, z] = face;
  if (z > 0.999) return 'floor, light up';
  if (z < -0.999) return 'ceiling, light down';
  if (y < -0.999) return 'front wall, light to the viewer';
  if (y > 0.999) return 'front wall, light away';
  if (Math.abs(x) > 0.999) return `side wall, light to ${x > 0 ? '+X' : '−X'}`;
  return 'custom plane';
}

function DesignPanel({ plan }: { plan: LineaPlan }) {
  const design = useLinea((s) => s.design);
  const rename = useLinea((s) => s.rename);
  const values = useLineaParams();
  const { stats, chain, classes, D } = plan;
  const prints = classes.length + stats.straights.length;
  return (
    <>
      <header>
        <div className="eyebrow">M2 · Linea</div>
        <NameInput name={design.name} onRename={rename} />
        <p>Select a bar or a joint to inspect it. Straights are whole pixels long; corners keep the exact angle you drew.</p>
      </header>
      <dl className="stats">
        <Stat k="Runs" v={design.runs.length} />
        <Stat k="Straights" v={stats.straights.length ? stats.straights.map((s) => `${fmt(s.mm)} ×${s.n}`).join(' · ') : '—'} />
        <Stat k="Corners" v={stats.corners.length ? stats.corners.map((c) => `${fmt(c.angle, 1)}° ×${c.n}`).join(' · ') : '—'} />
        <Stat k="T / X joints" v={`${stats.tees} T · ${stats.crosses} X${stats.hubs ? ` · ${stats.hubs} hub` : ''}`} />
        <Stat k="End caps" v={stats.ends} />
        <Stat k="Pixels" v={`${stats.px} px · ${(stats.stripMm / 1000).toFixed(2)} m of ${D.strip ? 'strip' : 'cells'}`} />
        <Stat k="Part types" v={`${prints} (${classes.length} joint${classes.length === 1 ? '' : 's'}, ${stats.straights.length} straight${stats.straights.length === 1 ? '' : 's'})`} />
        <Stat k="Data path" v={`${chain.lit.length} lit bars · ${chain.darkSteps} return run${chain.darkSteps === 1 ? '' : 's'} (${(chain.darkMm / 1000).toFixed(2)} m)`} tone={chain.jumps ? 'bad' : undefined} />
      </dl>
      {plan.warnings.length > 0 && (
        <ul className="checks">
          {plan.warnings.map((w) => (
            <li key={w} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      <ParamGroups specs={LINEA_PARAMS} values={values} />
    </>
  );
}

function RunPanel({ plan, id }: { plan: LineaPlan; id: string }) {
  const design = useLinea((s) => s.design);
  const select = useLinea((s) => s.select);
  const act = useLinea.getState;
  const run = design.runs.find((r) => r.id === id);
  if (!run) return null;
  const bars = plan.edges.filter((e) => e.run === id);
  const px = bars.reduce((s, e) => s + e.k, 0);
  const length = bars.reduce((s, e) => s + e.length, 0);
  const feed = (design.feed || design.runs[0]?.id) === id;
  const corners = run.pts.map((_, i) => interiorAngle(run.pts, run.closed, i)).filter((a): a is number => a !== null && a < 179);
  return (
    <>
      <header>
        <div className="eyebrow">Run{feed ? ' · data in at its start' : ''}</div>
        <h2>
          {id} <span className="chip">{run.closed ? 'closed' : 'open'}</span>
        </h2>
      </header>
      <dl className="stats">
        <Stat k="Plane" v={planeName(run.face)} />
        <Stat k="Length" v={`${mm(length)} over ${plural(run.pts.length, 'vertex', 'vertices')}`} />
        <Stat k="Pixels" v={px} />
        <Stat k="Corners" v={corners.length ? corners.map((a) => `${deg(a)} (≈${nearestCatalogue(a)}°)`).join(' · ') : 'none'} />
      </dl>
      <div className="table-wrap">
        <table className="mini">
          <thead>
            <tr>
              <th>Bar</th>
              <th>Joints</th>
              <th className="num">Px</th>
              <th>Straights</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => select({ kind: 'bar', id: e.id })}>
                <td className="mono strong">{e.id}</td>
                <td className="mono">
                  {e.a}–{e.b}
                </td>
                <td className="num">{e.k}</td>
                <td className="mono dim">{e.straights.length ? e.straights.map((c) => fmt(c * plan.D.pitch)).join(' + ') : 'too short'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="buttons">
        <button onClick={() => act().reverseRun(id)}>Reverse</button>
        <button onClick={() => act().flipFace(id)}>Flip light side</button>
        <button disabled={feed} onClick={() => act().setFeed(id)}>
          Feed here
        </button>
        <button onClick={() => act().relock(id)} title="Snap every segment back to whole pixels">
          Re-lock
        </button>
        <button onClick={() => act().remove({ kind: 'run', id })}>Delete run</button>
      </div>
    </>
  );
}

function JointPanel({ plan, id }: { plan: LineaPlan; id: string }) {
  const select = useLinea((s) => s.select);
  const act = useLinea.getState;
  const n = plan.nodes.find((x) => x.id === id);
  if (!n) return null;
  const cls = plan.classes.find((c) => c.id === n.classId);
  const tn = plan.topo.nodes.find((x) => x.id === id);
  return (
    <>
      <header>
        <div className="eyebrow">Joint{n.feed ? ' · data in' : ''}</div>
        <h2>
          {id} {cls && <span className="chip">{cls.members.length > 1 ? `${cls.id} ×${cls.members.length}` : 'unique part'}</span>}
        </h2>
      </header>
      <dl className="stats">
        <Stat k="Piece" v={cls ? cls.label : n.kind === 'join' ? 'straight join (bars butt with keys)' : '—'} />
        {n.kind === 'corner' && n.angle !== null && (
          <>
            <Stat k="Angle (exact)" v={deg(n.angle)} />
            <Stat k="Nearest catalogue" v={`${n.nearest}° (${fmt(Math.abs(n.angle - (n.nearest ?? 0)), 2)}° off)`} tone={Math.abs(n.angle - (n.nearest ?? 0)) < 0.05 ? 'ok' : undefined} />
          </>
        )}
        {n.gaps.length > 2 && <Stat k="Arm angles" v={n.gaps.map(deg).join(' · ')} />}
        <Stat k="Runs" v={n.runs.join(', ')} />
        <Stat k="Takes leftover" v={n.flexible ? 'yes: arms stretch so every straight stays whole pixels' : 'no: arms are fixed by the angle'} />
        {!n.planar && <Stat k="Print" v="bars from different planes: needs supports" tone="warn" />}
      </dl>
      <div className="table-wrap">
        <table className="mini">
          <thead>
            <tr>
              <th>Arm to bar</th>
              <th className="num">Arm</th>
              <th className="num">Bar px</th>
            </tr>
          </thead>
          <tbody>
            {n.arms.map((a) => {
              const e = plan.edges.find((x) => x.id === a.edge);
              return (
                <tr key={a.edge} className="clickable" onClick={() => select({ kind: 'bar', id: a.edge })}>
                  <td className="mono strong">{a.edge}</td>
                  <td className="num">{mm(a.len)}</td>
                  <td className="num">{e?.k ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="buttons">
        {n.runs.map((r) => (
          <button key={r} onClick={() => select({ kind: 'run', id: r })}>
            Run {r}
          </button>
        ))}
        <button disabled={!tn?.verts.length} onClick={() => act().remove({ kind: 'joint', id })} title={tn?.verts.length ? 'Remove the vertices here' : 'A crossing has no vertex to remove'}>
          Delete vertex
        </button>
      </div>
    </>
  );
}

function BarPanel({ plan, id }: { plan: LineaPlan; id: string }) {
  const select = useLinea((s) => s.select);
  const act = useLinea.getState;
  const e = plan.edges.find((x) => x.id === id);
  if (!e) return null;
  const idx = plan.chain.lit.findIndex((r) => r.strut === id);
  const run = plan.chain.lit[idx];
  const P = plan.D.pitch;
  return (
    <>
      <header>
        <div className="eyebrow">Bar · run {e.run}</div>
        <h2>
          {id} <span className="chip">{e.k} px</span>
        </h2>
      </header>
      <div className="buttons">
        <button onClick={() => select({ kind: 'joint', id: e.a })}>{e.a}</button>
        <span className="dim">→</span>
        <button onClick={() => select({ kind: 'joint', id: e.b })}>{e.b}</button>
      </div>
      <dl className="stats">
        <Stat k="Joint to joint" v={mm(dist(e.A, e.B))} />
        <Stat k="Joint arms" v={`${mm(e.armA)} + ${mm(e.armB)}`} />
        <Stat k="Straights" v={e.straights.length ? `${e.straights.map((c) => `${fmt(c * P)} (${c} px)`).join(' + ')}` : 'none'} tone={e.tooShort ? 'bad' : undefined} />
        <Stat k="Pitch lock" v={`${fmt(e.k * P, 2)} mm = ${e.k} × ${fmt(P, 3)} mm`} tone="ok" />
        <Stat k="Data" v={run ? `bar ${idx + 1} of ${plan.chain.lit.length} · DIN at ${run.from} → ${run.to}` : 'dark'} />
      </dl>
      <div className="buttons">
        <button onClick={() => select({ kind: 'run', id: e.run })}>Run {e.run}</button>
        <button onClick={() => act().remove({ kind: 'bar', id })} title="Removes the run segment this bar is on; the run splits in two">
          Delete segment
        </button>
      </div>
    </>
  );
}

export function LineaInspector() {
  const selection = useLinea((s) => s.selection);
  const plan = useLineaPlan();
  return (
    <aside className="inspector" aria-label="Workbench inspector">
      {selection?.kind === 'run' ? (
        <RunPanel plan={plan} id={selection.id} />
      ) : selection?.kind === 'joint' ? (
        <JointPanel plan={plan} id={selection.id} />
      ) : selection?.kind === 'bar' ? (
        <BarPanel plan={plan} id={selection.id} />
      ) : (
        <DesignPanel plan={plan} />
      )}
      {selection && (
        <button className="ghost" onClick={() => useLinea.getState().select(null)}>
          Back to the design
        </button>
      )}
    </aside>
  );
}
