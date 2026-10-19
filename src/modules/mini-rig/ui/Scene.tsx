import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { Color, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { add, dot, scale, sub } from '../../../geom/vec';
import type { Vec3 } from '../../../types';
import { BENCH_COLORS as COLORS, toWorld } from '../../../ui/bench/util';
import { WorkPlane } from '../../../ui/bench/WorkPlane';
import type { SceneProps } from '../../../workbench/ui';
import { Handle, rayFor } from '../../shared/Handle';
import type { InstrumentKind, MountSide } from '../model';
import type { InstInfo, RigPlan, SpanInfo } from '../plan';
import { useLiveRigPlan } from './usePlan';
import { useRig, useRigTool } from './useRig';

export const KIND_COLORS: Record<InstrumentKind, string> = {
  par: '#ffd166',
  blinder2: '#ff9f6b',
  blinder4: '#ff7b54',
  mover: '#7ee0c3',
  batten: '#b9a6ff',
};

const dirW = (v: Vec3) => toWorld(v).sub(toWorld([0, 0, 0]));

/** Rotation for a box whose local X/Y/Z are the given Z-up axes (right-handed). */
function quatOf(x: Vec3, y: Vec3, z: Vec3): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(dirW(x), dirW(y), dirW(z)));
}

/* ---------------- Nodes (corner blocks) ---------------- */

function Nodes({ plan, ghost, passive }: { plan: RigPlan; ghost: boolean; passive: boolean }) {
  const design = useRig((s) => s.design);
  const selection = useRig((s) => s.selection);
  const pending = useRig((s) => s.pending);
  const tool = useRig((s) => s.tool);
  const showLabels = useRig((s) => s.showLabels);
  const info = new Map(plan.nodes.map((n) => [n.id, n]));
  const W = plan.dims.W;
  return (
    <>
      {design.nodes.map((n) => {
        const ni = info.get(n.id);
        const isCtl = n.id === plan.controller;
        const color = pending === n.id ? COLORS.pending : ni?.bad ? COLORS.bad : isCtl ? COLORS.controller : COLORS.node;
        return (
          <Handle
            key={n.id}
            id={n.id}
            pos={n.pos}
            radius={W / 1.6}
            shape="box"
            color={color}
            ghost={ghost}
            passive={passive}
            selected={selection?.kind === 'node' && selection.id === n.id}
            onMove={tool === 'select' ? (p) => useRig.getState().moveNode(n.id, p) : undefined}
            onClick={() => {
              const st = useRig.getState();
              if (st.tool === 'truss') {
                if (st.pending && st.pending !== n.id) {
                  st.connect(st.pending, n.id);
                  st.setPending(n.id);
                } else st.setPending(st.pending === n.id ? null : n.id);
              }
              st.select({ kind: 'node', id: n.id });
            }}
            label={`${n.id}${isCtl ? ' · DATA IN' : ''}${ni && ni.spans.length ? ` · ${ni.label}` : ''}`}
            showLabel={showLabels}
            labelClass={isCtl ? 'ctl' : undefined}
          />
        );
      })}
    </>
  );
}

/* ---------------- Spans ---------------- */

function sideAt(sp: SpanInfo, p: Vec3): { t: number; side: MountSide } {
  const f = sp.frame;
  const s = dot(sub(p, f.A), f.d);
  const t = sp.clear > 0 ? (s - sp.length / 2 + sp.clear / 2) / sp.clear : 0.5;
  const rel = sub(p, add(f.A, scale(f.d, s)));
  const side = `${dot(rel, f.up) < 0 ? 'below' : 'above'}-${dot(rel, f.front) >= 0 ? 'front' : 'back'}` as MountSide;
  return { t: Math.min(1, Math.max(0, t)), side };
}

function Spans({ plan, ghost, passive }: { plan: RigPlan; ghost: boolean; passive: boolean }) {
  const selection = useRig((s) => s.selection);
  const [hover, setHover] = useState<string | null>(null);
  const W = plan.dims.W;
  const h = plan.dims.c / 2;
  const mats = useMemo(() => {
    const m = (color: string, opacity: number) => new MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity, depthWrite: false });
    return {
      span: m(COLORS.strut, ghost ? 0.06 : 0.14),
      bad: m(COLORS.bad, 0.35),
      sel: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.32, depthWrite: false }),
      hover: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.16, depthWrite: false }),
    };
  }, [ghost]);
  const chordColor = ghost ? '#5d6680' : COLORS.strut;

  const click = (sp: SpanInfo) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const st = useRig.getState();
    if (st.tool === 'instrument') {
      const p: Vec3 = [e.point.x, -e.point.z, e.point.y];
      const { t, side } = sideAt(sp, p);
      st.addInstrument(sp.id, t, side, useRigTool.getState().kind);
    } else st.select({ kind: 'span', id: sp.id });
  };

  return (
    <>
      {plan.spans.map((sp) => {
        const f = sp.frame;
        const L = Math.max(1, sp.clear);
        const mid = add(f.A, scale(f.d, sp.length / 2));
        const q = quatOf(f.up, f.d, scale(f.front, -1));
        const isSel = selection?.kind === 'span' && selection.id === sp.id;
        const mat = isSel ? mats.sel : hover === sp.id ? mats.hover : sp.ok ? mats.span : mats.bad;
        const s0 = add(f.A, scale(f.d, W / 2));
        const s1 = add(f.A, scale(f.d, W / 2 + L));
        const corners: [number, number][] = [
          [h, h],
          [h, -h],
          [-h, -h],
          [-h, h],
        ];
        const off = (p: Vec3, [u, v]: [number, number]) => add(add(p, scale(f.up, u)), scale(f.front, v));
        return (
          <group key={sp.id}>
            <mesh
              position={toWorld(mid)}
              quaternion={q}
              material={mat}
              raycast={rayFor(passive)}
              onClick={click(sp)}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(sp.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHover((x) => (x === sp.id ? null : x));
                document.body.style.cursor = '';
              }}
            >
              <boxGeometry args={[W, L, W]} />
            </mesh>
            {sp.ok &&
              corners.map((c, k) => <Line key={k} points={[toWorld(off(s0, c)), toWorld(off(s1, c))]} color={chordColor} lineWidth={1.2} transparent opacity={ghost ? 0.4 : 0.9} />)}
            {!ghost &&
              sp.sections.slice(1).map((sec, k) => {
                const p = add(f.A, scale(f.d, sec.start));
                const ring = [...corners, corners[0]].map((c) => toWorld(off(p, c)));
                return <Line key={`j${k}`} points={ring} color={COLORS.dark} lineWidth={1.5} />;
              })}
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Instruments ---------------- */

function Instruments({ plan, ghost, passive }: { plan: RigPlan; ghost: boolean; passive: boolean }) {
  const selection = useRig((s) => s.selection);
  const showLabels = useRig((s) => s.showLabels);
  const [hover, setHover] = useState<string | null>(null);
  const mats = useMemo(() => {
    const out = new Map<string, MeshStandardMaterial>();
    for (const [k, c] of Object.entries(KIND_COLORS))
      out.set(k, new MeshStandardMaterial({ color: c, emissive: new Color(c).multiplyScalar(0.3), roughness: 0.5, transparent: ghost, opacity: ghost ? 0.35 : 1, depthWrite: !ghost }));
    out.set('sel', new MeshStandardMaterial({ color: COLORS.selected, emissive: new Color(COLORS.selected).multiplyScalar(0.4), transparent: ghost, opacity: ghost ? 0.6 : 1 }));
    return out;
  }, [ghost]);
  return (
    <>
      {plan.instruments.map((i: InstInfo) => {
        const isSel = selection?.kind === 'instrument' && selection.id === i.id;
        const r = Math.min(14, Math.max(7, Math.min(i.dims.half[0], i.dims.half[1])));
        const len = Math.max(12, i.dims.length);
        const centre = add(i.pose.body.o, scale(i.pose.beam, len / 2 - i.dims.zT));
        const round = i.kind === 'par' || i.kind === 'mover';
        const q = round ? new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dirW(i.pose.beam).normalize()) : quatOf(i.pose.body.x, i.pose.beam, scale(i.pose.body.y, -1));
        return (
          <group key={i.id}>
            <Line points={[toWorld(i.pose.chord), toWorld(i.pose.body.o)]} color={ghost ? '#5d6680' : '#9aa3c0'} lineWidth={1} />
            <mesh
              position={toWorld(centre)}
              quaternion={q}
              material={isSel ? mats.get('sel') : mats.get(i.kind)}
              raycast={rayFor(passive)}
              scale={isSel || hover === i.id ? 1.12 : 1}
              onClick={(e) => {
                if (e.delta > 4) return;
                e.stopPropagation();
                useRig.getState().select({ kind: 'instrument', id: i.id });
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(i.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHover((x) => (x === i.id ? null : x));
                document.body.style.cursor = '';
              }}
            >
              {round ? <cylinderGeometry args={[r * 0.8, r, len, 16]} /> : <boxGeometry args={[i.dims.half[0] * 2, len, i.dims.half[1] * 2]} />}
            </mesh>
            {(showLabels || isSel || hover === i.id) && (
              <Html position={toWorld(add(centre, scale(i.pose.beam, len / 2 + 8)))} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${isSel ? ' on' : ''}`}>
                {i.id}
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Data chain ---------------- */

function Chain({ plan }: { plan: RigPlan }) {
  const start = plan.nodes.find((n) => n.id === plan.controller)?.pos;
  if (!start || !plan.instruments.length) return null;
  const pts: Vec3[] = [start, ...plan.instruments.map((i) => i.pose.chord)];
  const n = Math.max(1, pts.length - 2);
  return (
    <>
      {pts.slice(1).map((p, k) => {
        const a = pts[k];
        const color = COLORS.chainA.clone().lerp(COLORS.chainB, k / n);
        const lift = (v: Vec3) => toWorld(add(v, [0, 0, 6]));
        return (
          <group key={k}>
            <Line points={[lift(a), lift(p)]} color={color} lineWidth={2.2} dashed={k === 0} dashSize={8} gapSize={6} />
            <mesh position={lift(p)}>
              <sphereGeometry args={[3.2, 12, 8]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/* ---------------- The system scene ---------------- */

/** Corner blocks, spans, instruments and the data chain inside the shared bench canvas. */
export function RigScene({ ghost, hideStale, passive }: SceneProps) {
  const tool = useRig((s) => s.tool);
  const showChain = useRig((s) => s.showChain);
  const plan = useLiveRigPlan();
  const g = ghost && !hideStale;
  return (
    <>
      <Spans plan={plan} ghost={g} passive={passive} />
      <Nodes plan={plan} ghost={g} passive={passive} />
      <Instruments plan={plan} ghost={g} passive={passive} />
      {showChain && <Chain plan={plan} />}
      {tool === 'truss' && !passive && (
        <WorkPlane
          ghostRadius={plan.dims.W / 2}
          onPick={(p) => {
            const st = useRig.getState();
            const id = st.addNodeAt(p, st.pending);
            useRig.getState().setPending(id);
          }}
        />
      )}
    </>
  );
}

/** Glow size for the jewel pixels on the bench. */
export function useRigPixelSize(): number {
  return 14;
}
