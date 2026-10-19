import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { DoubleSide, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { add, cross, dist, dot, scale, sub } from '../../../geom/vec';
import { planeXY } from '../../../sketch/types';
import type { Vec3 } from '../../../types';
import { BENCH_COLORS as COLORS, pickMat, toLocal, toWorld } from '../../../ui/bench/util';
import { WorkPlane } from '../../../ui/bench/WorkPlane';
import { useBench } from '../../../workbench/store';
import type { SceneProps } from '../../../workbench/ui';
import { Handle, rayFor } from '../../shared/Handle';
import { straightOffsets, type LineaPlan, type PEdge, type PNode } from '../plan';
import { linDims } from '../params';
import { handleLift, useDraft, useLinea, useLineaParams, useLivePlan } from './useLinea';

/** Z-up direction → three.js Y-up direction. */
const dirW = (d: Vec3) => new Vector3(d[0], d[2], -d[1]);

/** Rotation of a box whose local x runs along `dir` and local z along `face`. */
function quatOf(dir: Vec3, face: Vec3): Quaternion {
  const side = cross(face, dir);
  const m = new Matrix4().makeBasis(dirW(dir), dirW(side), dirW(face));
  return new Quaternion().setFromRotationMatrix(m);
}

/* ---------------- Bars ---------------- */

function Bars({ plan, ghost, passive }: { plan: LineaPlan; ghost: boolean; passive: boolean }) {
  const selection = useLinea((s) => s.selection);
  const tool = useLinea((s) => s.tool);
  const [hover, setHover] = useState<string | null>(null);
  const { D } = plan;
  const mats = useMemo(() => {
    const vis = (color: string, opacity = 1) => new MeshStandardMaterial({ color, roughness: 0.55, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    return {
      lit: ghost ? new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) : vis(COLORS.strut, 0.9),
      dark: ghost ? new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) : vis(COLORS.bad, 0.7),
      selected: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide }),
      hover: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.2, depthWrite: false }),
    };
  }, [ghost]);

  const click = (e: PEdge) => (ev: ThreeEvent<MouseEvent>) => {
    if (ev.delta > 4) return;
    ev.stopPropagation();
    const st = useLinea.getState();
    if (st.tool === 'run') {
      // Start or extend a run from a point on this bar (a T).
      const p = toLocal(ev.point);
      const t = Math.max(0, Math.min(e.length, dot(sub(p, e.A), e.dir)));
      addDraftPoint(add(e.A, scale(e.dir, t)));
      return;
    }
    st.select({ kind: 'bar', id: e.id });
  };

  return (
    <>
      {plan.edges.map((e) => {
        const q = quatOf(e.dir, e.face);
        const isSel = selection?.kind === 'bar' && selection.id === e.id;
        const runSel = selection?.kind === 'run' && selection.id === e.run;
        const mat = isSel || runSel ? mats.selected : hover === e.id ? mats.hover : e.k ? mats.lit : mats.dark;
        const pieces = e.k ? straightOffsets(plan, e).map((s) => ({ at: s.at, L: s.count * D.pitch })) : [{ at: e.armA, L: Math.max(1, e.length - e.armA - e.armB) }];
        return (
          <group key={e.id}>
            {pieces.map((s, i) => {
              const mid = add(add(e.A, scale(e.dir, s.at + s.L / 2)), scale(e.face, D.H / 2));
              return (
                <mesh key={i} position={toWorld(mid)} quaternion={q} material={mat} raycast={() => null}>
                  <boxGeometry args={[Math.max(0.5, s.L - 1.2), D.W, D.H]} />
                </mesh>
              );
            })}
            {/* Fat pick target along the whole bar between its joints. */}
            <mesh
              position={toWorld(add(add(e.A, scale(e.dir, e.armA + (e.length - e.armA - e.armB) / 2)), scale(e.face, D.H / 2)))}
              quaternion={q}
              material={pickMat}
              raycast={rayFor(passive)}
              onClick={click(e)}
              onPointerOver={(ev) => {
                ev.stopPropagation();
                setHover(e.id);
                document.body.style.cursor = tool === 'run' ? 'crosshair' : 'pointer';
              }}
              onPointerOut={() => {
                setHover((h) => (h === e.id ? null : h));
                document.body.style.cursor = '';
              }}
            >
              <boxGeometry args={[Math.max(1, e.length - e.armA - e.armB), Math.max(D.W * 1.6, 18), D.H + 10]} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Joints ---------------- */

function Joints({ plan, ghost, passive }: { plan: LineaPlan; ghost: boolean; passive: boolean }) {
  const selection = useLinea((s) => s.selection);
  const showLabels = useLinea((s) => s.showLabels);
  const [hover, setHover] = useState<string | null>(null);
  const { D } = plan;
  const mats = useMemo(
    () => ({
      joint: ghost ? new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) : new MeshStandardMaterial({ color: COLORS.dark, roughness: 0.6 }),
      feed: new MeshStandardMaterial({ color: COLORS.controller, roughness: 0.5, transparent: ghost, opacity: ghost ? 0.5 : 1 }),
      selected: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.5, depthWrite: false }),
      hover: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.25, depthWrite: false }),
    }),
    [ghost],
  );
  const pick = (n: PNode) => (ev: ThreeEvent<MouseEvent>) => {
    if (ev.delta > 4) return;
    ev.stopPropagation();
    const st = useLinea.getState();
    if (st.tool === 'run') addDraftPoint(n.pos);
    else st.select({ kind: 'joint', id: n.id });
  };
  return (
    <>
      {plan.nodes.map((n) => {
        const isSel = selection?.kind === 'joint' && selection.id === n.id;
        const mat = isSel ? mats.selected : hover === n.id ? mats.hover : n.feed ? mats.feed : mats.joint;
        const r = Math.max(D.W * 0.75, 9);
        return (
          <group key={n.id}>
            {n.arms.map((a, i) =>
              a.len > 0.01 ? (
                <mesh key={i} position={toWorld(add(add(n.pos, scale(a.dir, a.len / 2)), scale(a.face, D.H / 2)))} quaternion={quatOf(a.dir, a.face)} material={mat} raycast={() => null}>
                  <boxGeometry args={[a.len, D.W, D.H]} />
                </mesh>
              ) : null,
            )}
            <mesh
              position={toWorld(add(n.pos, scale(n.face, D.H / 2)))}
              material={n.classId || isSel || hover === n.id ? mat : pickMat}
              raycast={rayFor(passive)}
              onClick={pick(n)}
              onPointerOver={(ev) => {
                ev.stopPropagation();
                setHover(n.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHover((h) => (h === n.id ? null : h));
                document.body.style.cursor = '';
              }}
            >
              <sphereGeometry args={[r * 0.6, 16, 12]} />
            </mesh>
            {(showLabels || isSel || hover === n.id) && n.kind !== 'join' && (
              <Html position={toWorld(add(n.pos, scale(n.face, D.H + 14)))} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${isSel ? ' on' : ''}${n.feed ? ' ctl' : ''}`}>
                {n.id}
                {n.feed ? ' · DATA IN' : ''}
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Vertex handles ---------------- */

function Vertices({ plan, ghost, passive }: { plan: LineaPlan; ghost: boolean; passive: boolean }) {
  const runs = useLinea((s) => s.design.runs);
  const tool = useLinea((s) => s.tool);
  const selection = useLinea((s) => s.selection);
  const nodeOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of plan.topo.nodes) for (const v of n.verts) m.set(`${v.run}:${v.i}`, n.id);
    return m;
  }, [plan]);
  const r = Math.max(5, plan.D.W * 0.42);
  const lift = handleLift(plan.D);
  const placing = tool === 'run';
  return (
    <>
      {runs.map((run) =>
        run.pts.map((p, i) => {
          const node = nodeOf.get(`${run.id}:${i}`);
          const sel = selection?.kind === 'joint' && selection.id === node;
          return (
            <Handle
              key={`${run.id}:${i}`}
              id={`v:${run.id}:${i}`}
              pos={add(p, scale(run.face, lift))}
              radius={r}
              color={COLORS.node}
              selected={sel}
              ghost={ghost}
              passive={passive}
              plane={{ ...run.plane, origin: add(run.plane.origin, scale(run.face, lift)) }}
              onMove={placing ? undefined : (pos) => useLinea.getState().moveVertex(run.id, i, sub(pos, scale(run.face, lift)))}
              onClick={() => {
                const st = useLinea.getState();
                if (placing) addDraftPoint(p);
                else if (node) st.select({ kind: 'joint', id: node });
              }}
              label={`${run.id}·${i + 1}${node ? ` (${node})` : ''}`}
            />
          );
        }),
      )}
    </>
  );
}

/* ---------------- Run tool ---------------- */

/** Add a point to the run being drawn; clicking the last point again ends it, the first closes it. */
export function addDraftPoint(p: Vec3) {
  const draft = useDraft.getState();
  const bench = useBench.getState();
  const pts = draft.pts;
  const tol = Math.max(2, bench.snap / 2);
  if (pts.length && dist(pts[pts.length - 1], p) <= tol) {
    finishDraft(false);
    return;
  }
  if (pts.length >= 3 && dist(pts[0], p) <= tol) {
    finishDraft(true);
    return;
  }
  // A run lies in one horizontal plane: the first point sets its height (and the grid follows).
  const z = pts.length ? pts[0][2] : p[2];
  if (!pts.length && Math.abs(bench.workZ - z) > 1e-6) bench.set('workZ', z);
  draft.set([...pts, [p[0], p[1], z]]);
  bench.setPending('linea-run');
}

export function finishDraft(closed: boolean) {
  const { pts } = useDraft.getState();
  useDraft.getState().set([]);
  if (pts.length >= 2) useLinea.getState().addRun(pts, closed, planeXY(pts[0][2]));
  else useBench.getState().setPending(null);
}

function Draft() {
  const pts = useDraft((s) => s.pts);
  const pending = useLinea((s) => s.pending);
  const tool = useLinea((s) => s.tool);
  // Esc (the shell clears `pending`) or leaving the tool drops the draft.
  useEffect(() => {
    if ((pending !== 'linea-run' || tool !== 'run') && useDraft.getState().pts.length) useDraft.getState().set([]);
  }, [pending, tool]);
  useEffect(() => {
    if (tool !== 'run') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'Enter' && useDraft.getState().pts.length) {
        e.preventDefault();
        finishDraft(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);
  if (!pts.length) return null;
  return (
    <>
      {pts.length > 1 && <Line points={pts.map(toWorld)} color={COLORS.pending} lineWidth={2.5} />}
      {pts.map((p, i) => (
        <mesh key={i} position={toWorld(p)} raycast={() => null}>
          <sphereGeometry args={[i === 0 ? 6 : 4.5, 14, 10]} />
          <meshBasicMaterial color={COLORS.pending} />
        </mesh>
      ))}
    </>
  );
}

/* ---------------- Data chain ---------------- */

function ChainOverlay({ plan }: { plan: LineaPlan }) {
  const edgeById = new Map(plan.edges.map((e) => [e.id, e]));
  const nodePos = new Map(plan.nodes.map((n) => [n.id, n.pos]));
  const lift = plan.D.topZ + 8;
  const n = Math.max(1, plan.chain.lit.length - 1);
  let litIndex = 0;
  return (
    <>
      {plan.chain.steps.map((st, i) => {
        if (!st.strut) {
          const a = nodePos.get(st.from);
          const b = nodePos.get(st.to);
          if (!a || !b) return null;
          return <Line key={i} points={[toWorld(a), toWorld(b)]} color={COLORS.bad} lineWidth={1.5} dashed dashSize={10} gapSize={8} />;
        }
        const e = edgeById.get(st.strut);
        if (!e) return null;
        const fwd = st.from === e.a;
        const s0 = fwd ? e.armA : e.length - e.armB;
        const s1 = fwd ? e.length - e.armB : e.armA;
        const along = (s: number, h: number) => add(add(e.A, scale(e.dir, s)), scale(e.face, h));
        if (st.lit) {
          const k = litIndex++ / n;
          const color = COLORS.chainA.clone().lerp(COLORS.chainB, k);
          const dir = fwd ? e.dir : scale(e.dir, -1);
          const tip = along(s0 + (s1 - s0) * 0.6, lift);
          const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dirW(dir));
          return (
            <group key={i}>
              <Line points={[toWorld(along(s0, lift)), toWorld(along(s1, lift))]} color={color} lineWidth={2.4} />
              <mesh position={toWorld(tip)} quaternion={q} raycast={() => null}>
                <coneGeometry args={[4, 11, 12]} />
                <meshBasicMaterial color={color} toneMapped={false} />
              </mesh>
            </group>
          );
        }
        return <Line key={i} points={[toWorld(along(s0, -4)), toWorld(along(s1, -4))]} color={COLORS.darkRun} lineWidth={1.6} dashed dashSize={8} gapSize={6} />;
      })}
    </>
  );
}

/* ---------------- The system scene ---------------- */

export function LineaScene({ ghost, hideStale, passive }: SceneProps) {
  const tool = useLinea((s) => s.tool);
  const showChain = useLinea((s) => s.showChain);
  const plan = useLivePlan();
  const g = ghost && !hideStale;
  return (
    <>
      <Bars plan={plan} ghost={g} passive={passive} />
      <Joints plan={plan} ghost={g} passive={passive} />
      <Vertices plan={plan} ghost={g} passive={passive} />
      {showChain && <ChainOverlay plan={plan} />}
      <Draft />
      {tool === 'run' && !passive && <WorkPlane onPick={addDraftPoint} />}
    </>
  );
}

/** Pixel glow size follows the bar width. */
export function useLineaPixelSize(): number {
  const params = useLineaParams();
  return useMemo(() => linDims(params).W * 1.4, [params]);
}
