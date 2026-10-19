import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, Plane, Quaternion, Vector3 } from 'three';
import { add, designRadius, len, norm, scale, sub, type SnPlan } from '../modules/strut-node';
import type { BuiltPart, Vec3 } from '../types';
import { usePlates } from './PartsPanel';
import { useStore } from './store';
import { useSnPlan } from './useSnPlan';
import { CameraRig, PartMesh, Pixels, PlateScene, SceneBasics, plateFrame, useGeometries, useMaterials } from './Viewer';
import { useWorkbench } from './workbenchStore';

/* The bench works in the slicer's Z-up millimetres; three.js is Y-up. */
const toWorld = (p: Vec3) => new Vector3(p[0], p[2], -p[1]);
const toLocal = (v: Vector3): Vec3 => [v.x, -v.z, v.y];

const UP = new Vector3(0, 1, 0);
const COLORS = {
  node: '#8c93b8',
  controller: '#ffb347',
  selected: '#2fd4ff',
  pending: '#8b5cf6',
  bad: '#ff5d73',
  strut: '#d9d5cb',
  dark: '#4a4a58',
  chainA: new Color('#2fd4ff'),
  chainB: new Color('#c56bff'),
  darkRun: '#ffb347',
};

function useLivePositions() {
  const design = useWorkbench((s) => s.design);
  const drag = useWorkbench((s) => s.drag);
  return useMemo(() => {
    const m = new Map(design.nodes.map((n) => [n.id, n.pos]));
    if (drag) m.set(drag.id, drag.pos);
    return m;
  }, [design, drag]);
}

/** Cylinder between two Z-up points, as position + quaternion + length in world space. */
function between(a: Vec3, b: Vec3) {
  const A = toWorld(a);
  const B = toWorld(b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const length = dir.length();
  const q = new Quaternion().setFromUnitVectors(UP, dir.normalize());
  return { mid, q, length };
}

function snapTo(v: number, step: number) {
  return step > 0 ? Math.round(v / step) * step : Math.round(v * 10) / 10;
}

/* ---------------- Nodes ---------------- */

function NodeHandles({ plan, radius, ghost }: { plan: SnPlan; radius: number; ghost: boolean }) {
  const design = useWorkbench((s) => s.design);
  const selection = useWorkbench((s) => s.selection);
  const pending = useWorkbench((s) => s.pending);
  const tool = useWorkbench((s) => s.tool);
  const snap = useWorkbench((s) => s.snap);
  const showLabels = useWorkbench((s) => s.showLabels);
  const wb = useWorkbench.getState;
  const pos = useLivePositions();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const camera = useThree((s) => s.camera);
  const dragRef = useRef<{ id: string; plane: Plane; start: Vec3; grab: Vec3; moved: boolean; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const collide = new Set(plan.an.hubs.filter((h) => h.collide).map((h) => h.id));

  const down = (id: string) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = wb();
    if (st.tool === 'connect') {
      if (st.pending && st.pending !== id) {
        st.connect(st.pending, id);
        st.setPending(id);
      } else st.setPending(st.pending === id ? null : id);
      st.select({ kind: 'node', id });
      return;
    }
    if (st.tool === 'order') return;
    st.select({ kind: 'node', id });
    if (st.tool !== 'select') return;
    const p = pos.get(id)!;
    const P = toWorld(p);
    // Shift-drag moves the hub vertically on a plane that faces the camera.
    let normal = UP.clone();
    if (e.shiftKey) {
      const look = new Vector3();
      camera.getWorldDirection(look);
      look.y = 0;
      normal = look.lengthSq() > 1e-6 ? look.normalize() : new Vector3(0, 0, 1);
    }
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, P);
    const hit = new Vector3();
    const grab = e.ray.intersectPlane(plane, hit) ? toLocal(hit) : p;
    dragRef.current = { id, plane, start: p, grab, moved: false, x: e.clientX, y: e.clientY };
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    if (controls) controls.enabled = false;
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    const hit = new Vector3();
    if (!e.ray.intersectPlane(d.plane, hit)) return;
    const at = toLocal(hit);
    const delta = sub(at, d.grab);
    const vertical = Math.abs(d.plane.normal.y) < 0.5;
    const next: Vec3 = vertical
      ? [d.start[0], d.start[1], snapTo(d.start[2] + delta[2], snap)]
      : [snapTo(d.start[0] + delta[0], snap), snapTo(d.start[1] + delta[1], snap), d.start[2]];
    wb().setDrag({ id: d.id, pos: next });
  };

  const up = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
    const st = wb();
    if (d.moved && st.drag) st.moveNode(d.id, st.drag.pos);
    st.setDrag(null);
  };

  const mats = useMemo(() => {
    const m = (color: string) =>
      new MeshStandardMaterial({ color, emissive: new Color(color).multiplyScalar(0.35), roughness: 0.4, transparent: ghost, opacity: ghost ? 0.38 : 1, depthWrite: !ghost });
    return { node: m(COLORS.node), controller: m(COLORS.controller), selected: m(COLORS.selected), pending: m(COLORS.pending), bad: m(COLORS.bad) };
  }, [ghost]);

  return (
    <>
      {design.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const isSel = selection?.kind === 'node' && selection.id === n.id;
        const mat = isSel ? mats.selected : pending === n.id ? mats.pending : collide.has(n.id) ? mats.bad : n.id === design.controller ? mats.controller : mats.node;
        const showLabel = showLabels || isSel || hover === n.id;
        return (
          <group key={n.id} position={toWorld(p)}>
            <mesh
              material={mat}
              onPointerDown={down(n.id)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(n.id);
                document.body.style.cursor = tool === 'select' ? 'grab' : 'pointer';
              }}
              onPointerOut={() => {
                setHover((h) => (h === n.id ? null : h));
                document.body.style.cursor = '';
              }}
              scale={isSel || hover === n.id ? 1.12 : 1}
            >
              <sphereGeometry args={[radius, 24, 16]} />
            </mesh>
            {showLabel && (
              <Html position={[0, radius + 6, 0]} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${isSel ? ' on' : ''}${n.id === design.controller ? ' ctl' : ''}`}>
                {n.id}
                {n.id === design.controller ? ' · DATA IN' : ''}
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Struts ---------------- */

const pickMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

function StrutHandles({ plan, radius, hubR, ghost }: { plan: SnPlan; radius: number; hubR: number; ghost: boolean }) {
  const pickR = Math.max(radius * 1.3, 10);
  const design = useWorkbench((s) => s.design);
  const selection = useWorkbench((s) => s.selection);
  const tool = useWorkbench((s) => s.tool);
  const wb = useWorkbench.getState;
  const pos = useLivePositions();
  const info = new Map(plan.an.struts.map((s) => [s.id, s]));
  const orderIdx = new Map(plan.chain.lit.map((r, i) => [r.strut, i + 1]));
  const [hover, setHover] = useState<string | null>(null);

  const mats = useMemo(() => {
    const vis = (color: string, opacity = 1) => new MeshStandardMaterial({ color, roughness: 0.5, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    return {
      lit: ghost ? new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) : vis(COLORS.strut, 0.85),
      dark: ghost ? new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }) : vis(COLORS.dark),
      bad: vis(COLORS.bad, ghost ? 0.45 : 0.9),
      selected: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide }),
      hover: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.2, depthWrite: false }),
    };
  }, [ghost]);

  return (
    <>
      {design.struts.map((s) => {
        const a = pos.get(s.a);
        const b = pos.get(s.b);
        const si = info.get(s.id);
        if (!a || !b || !si) return null;
        const { mid, q, length } = between(a, b);
        const isSel = selection?.kind === 'strut' && selection.id === s.id;
        const mat = isSel ? mats.selected : hover === s.id ? mats.hover : si.tooShort ? mats.bad : s.dark ? mats.dark : mats.lit;
        const idx = orderIdx.get(s.id);
        const userPicked = idx !== undefined && idx <= plan.chain.userCount;
        return (
          <group key={s.id} position={mid} quaternion={q}>
            <mesh material={mat} raycast={() => null}>
              <cylinderGeometry args={[isSel || hover === s.id ? radius * 1.25 : radius, isSel || hover === s.id ? radius * 1.25 : radius, length, 14, 1, true]} />
            </mesh>
            {/* A fat, unseen pick target: thin struts are hard to hit at bench zoom. Stops short of the hubs. */}
            <mesh
              material={pickMat}
              onClick={(e) => {
                if (e.delta > 4) return;
                e.stopPropagation();
                const st = wb();
                if (st.tool === 'order') {
                  if (e.shiftKey) st.toggleStrut(s.id, 'flip');
                  else st.clickOrder(s.id);
                } else st.select({ kind: 'strut', id: s.id });
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(s.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHover((h) => (h === s.id ? null : h));
                document.body.style.cursor = '';
              }}
            >
              <cylinderGeometry args={[pickR, pickR, Math.max(1, length - 2 * hubR), 8, 1]} />
            </mesh>
            {(tool === 'order' || isSel) && idx !== undefined && (
              <Html position={[radius * 2.2, 0, 0]} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag order${userPicked ? ' user' : ''}${isSel ? ' on' : ''}`}>
                {idx}
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Data chain ---------------- */

function ChainOverlay({ plan, offset }: { plan: SnPlan; offset: number }) {
  const pos = useLivePositions();
  const info = new Map(plan.an.struts.map((s) => [s.id, s]));
  const n = Math.max(1, plan.chain.lit.length - 1);
  let litIndex = 0;
  return (
    <>
      {plan.chain.steps.map((st, i) => {
        const a = pos.get(st.from);
        const b = pos.get(st.to);
        if (!a || !b) return null;
        if (!st.strut) {
          return <Line key={i} points={[toWorld(a), toWorld(b)]} color={COLORS.bad} lineWidth={1.5} dashed dashSize={10} gapSize={8} />;
        }
        const s = info.get(st.strut);
        if (!s) return null;
        const dir = norm(sub(b, a));
        const L = len(sub(b, a));
        const ia = (st.from === s.a ? s.offA : s.offB) * 0.6;
        const ib = (st.to === s.a ? s.offA : s.offB) * 0.6;
        if (st.lit) {
          const k = litIndex++ / n;
          const color = COLORS.chainA.clone().lerp(COLORS.chainB, k);
          const lift = scale(s.face, offset);
          const p0 = add(add(a, scale(dir, ia)), lift);
          const p1 = add(add(a, scale(dir, L - ib)), lift);
          const tip = add(add(a, scale(dir, L * 0.62)), lift);
          const { q } = between(a, b);
          return (
            <group key={i}>
              <Line points={[toWorld(p0), toWorld(p1)]} color={color} lineWidth={2.4} />
              <mesh position={toWorld(tip)} quaternion={q}>
                <coneGeometry args={[offset * 0.32, offset * 0.9, 12]} />
                <meshBasicMaterial color={color} toneMapped={false} />
              </mesh>
            </group>
          );
        }
        const drop = scale(s.face, -offset * 0.7);
        return (
          <Line key={i} points={[toWorld(add(add(a, scale(dir, ia)), drop)), toWorld(add(add(a, scale(dir, L - ib)), drop))]} color={COLORS.darkRun} lineWidth={1.6} dashed dashSize={8} gapSize={6} />
        );
      })}
    </>
  );
}

/* ---------------- Work plane for placing hubs ---------------- */

function WorkPlane() {
  const workZ = useWorkbench((s) => s.workZ);
  const snap = useWorkbench((s) => s.snap);
  const selection = useWorkbench((s) => s.selection);
  const wb = useWorkbench.getState;
  const [ghost, setGhost] = useState<Vec3 | null>(null);
  const at = (e: ThreeEvent<PointerEvent | MouseEvent>): Vec3 => {
    const p = toLocal(e.point);
    return [snapTo(p[0], snap), snapTo(p[1], snap), workZ];
  };
  return (
    <>
      <Grid position={[0, workZ, 0]} args={[1600, 1600]} cellSize={Math.max(5, snap || 10)} sectionSize={100} cellColor="#2a3a4a" sectionColor="#2fd4ff" fadeDistance={2400} sectionThickness={0.6} cellThickness={0.4} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, workZ, 0]}
        onPointerMove={(e) => setGhost(at(e))}
        onPointerOut={() => setGhost(null)}
        onClick={(e) => {
          if (e.delta > 4) return;
          e.stopPropagation();
          wb().addNode(at(e), selection?.kind === 'node' ? selection.id : null);
        }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
      {ghost && (
        <mesh position={toWorld(ghost)}>
          <sphereGeometry args={[8, 16, 12]} />
          <meshBasicMaterial color={COLORS.selected} transparent opacity={0.5} />
        </mesh>
      )}
    </>
  );
}

/* ---------------- The bench ---------------- */

export function WorkbenchBench() {
  const result = useStore((s) => s.result);
  const view = useStore((s) => s.view);
  const plateIndex = useStore((s) => s.plateIndex);
  const selectedPart = useStore((s) => s.selectedPart);
  const design = useWorkbench((s) => s.design);
  const tool = useWorkbench((s) => s.tool);
  const showParts = useWorkbench((s) => s.showParts);
  const showChain = useWorkbench((s) => s.showChain);
  const frameSeq = useWorkbench((s) => s.frameSeq);
  const drag = useWorkbench((s) => s.drag);
  const plan = useSnPlan();
  const built = result?.fixtureId === 'strut-node' ? result : null;
  const parts: BuiltPart[] = built?.parts ?? [];
  const geos = useGeometries(parts);
  const mats = useMaterials();
  const { printer, plates } = usePlates();
  const plate = plates[Math.min(plateIndex, plates.length - 1)];
  const radius = designRadius(design);

  const frame = useMemo(() => {
    if (view === 'plates') return plateFrame(printer);
    if (!design.nodes.length) return { center: new Vector3(0, 60, 0), radius: 300 };
    const c = design.nodes.reduce<Vec3>((s, n) => add(s, scale(n.pos, 1 / design.nodes.length)), [0, 0, 0]);
    // The bench canvas is short and wide; give the whole design room.
    return { center: toWorld(c), radius: radius * 1.5 };
    // Re-frame on a new design or view, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, printer, frameSeq, built ? 1 : 0]);

  const ghost = showParts && parts.length > 0;
  const handleR = ghost ? plan.dims.coreR * 1.05 : Math.max(7, plan.dims.coreR * 0.6);
  const strutR = ghost ? plan.dims.tubeR * 1.1 : Math.max(2.5, plan.dims.tubeR * 0.35);
  const hideStale = drag !== null;

  return (
    <Canvas
      shadows
      camera={{ fov: 35, position: [600, 500, 800] }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onPointerMissed={(e) => {
        if (e.button === 0 && tool !== 'add') useWorkbench.getState().select(null);
      }}
    >
      <SceneBasics size={radius * 2} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <CameraRig center={frame.center} radius={frame.radius} viewKey={`wb-${view}-${printer.id}-${frameSeq}-${built ? 1 : 0}`} />
      {view === 'assembled' && (
        <>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {showParts &&
              !hideStale &&
              parts.map((p) =>
                p.instances.map((inst, i) => (
                  <PartMesh key={`${p.id}-${i}`} geometry={geos.get(p.id)!} material={p.id === selectedPart ? mats.selected : mats[p.role]} matrix={inst} />
                )),
              )}
            {showParts && built && !hideStale && <Pixels result={built} size={plan.dims.tubeR * 9} diffuser={mats.diffuser} />}
          </group>
          <NodeHandles plan={plan} radius={handleR} ghost={ghost && !hideStale} />
          <StrutHandles plan={plan} radius={strutR} hubR={handleR} ghost={ghost && !hideStale} />
          {showChain && <ChainOverlay plan={plan} offset={plan.dims.tubeR + 8} />}
          {tool === 'add' && <WorkPlane />}
        </>
      )}
      {view === 'plates' && plate && (
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <PlateScene parts={parts} geos={geos} mats={mats} printer={printer} plate={plate} selected={selectedPart} />
        </group>
      )}
    </Canvas>
  );
}
