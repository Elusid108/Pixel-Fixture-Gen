import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { BENCH_COLORS as COLORS, between, snapTo, toLocal, toWorld } from '../../../ui/bench/util';
import { WorkPlane } from '../../../ui/bench/WorkPlane';
import type { Vec3 } from '../../../types';
import type { SceneProps } from '../../../workbench/ui';
import { Handle, rayFor, useLivePos } from '../../shared/Handle';
import type { SegKind } from '../model';
import { xfPoint, type CsPlan, type StackPlan } from '../plan';
import { useColumn, useCsPlan } from './useColumn';

export const KIND_COLORS: Record<SegKind, string> = {
  helix: '#7fb3ff',
  band: '#ffd27f',
  lattice: '#9be59b',
  louver: '#d6a2ff',
  ring: '#ff9f8a',
};

const handleId = (stackId: string) => `stack:${stackId}`;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** World point on a stack's axis at column height z. */
const axisAt = (st: StackPlan, z: number): Vec3 => xfPoint(st.frame, [0, 0, z]);

/** Where the stack's handle sits: inside the base, or just under the ceiling inside the canopy. */
function handlePos(st: StackPlan, plan: CsPlan): Vec3 {
  const d = plan.dims;
  return st.mount === 'floor' ? [st.pos[0], st.pos[1], st.pos[2] + d.baseTop * 0.45] : [st.pos[0], st.pos[1], st.pos[2] - d.canopyH / 2];
}

function useMats(ghost: boolean) {
  return useMemo(() => {
    const kind = Object.fromEntries(
      (Object.keys(KIND_COLORS) as SegKind[]).map((k) => [k, new MeshStandardMaterial({ color: KIND_COLORS[k], roughness: 0.6, transparent: true, opacity: ghost ? 0.07 : 0.82, depthWrite: !ghost })]),
    ) as Record<SegKind, MeshStandardMaterial>;
    return {
      kind,
      cap: new MeshStandardMaterial({ color: '#e8e4da', roughness: 0.5, transparent: true, opacity: ghost ? 0.07 : 0.8, depthWrite: !ghost }),
      base: new MeshStandardMaterial({ color: '#5a5f78', roughness: 0.7, transparent: true, opacity: ghost ? 0.06 : 0.45, depthWrite: false }),
      selected: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.45, depthWrite: false }),
      hover: new MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.22, depthWrite: false }),
    };
  }, [ghost]);
}

function StackView({ st, plan, ghost, passive }: { st: StackPlan; plan: CsPlan; ghost: boolean; passive: boolean }) {
  const selection = useColumn((s) => s.selection);
  const showLabels = useColumn((s) => s.showLabels);
  const tool = useColumn((s) => s.tool);
  const [hover, setHover] = useState<string | null>(null);
  const mats = useMats(ghost);
  const d = plan.dims;
  const hp = handlePos(st, plan);
  const live = useLivePos(handleId(st.id), hp);
  const offset = toWorld(sub(live, hp));
  const stackSel = selection?.kind === 'stack' && selection.id === st.id;
  const R = d.R * (ghost ? 1.05 : 1);
  const canPick = tool === 'select' || tool === 'stack' || tool === 'drop';

  const pick = (sel: { kind: string; id: string }) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || !canPick) return;
    e.stopPropagation();
    useColumn.getState().select(sel);
  };
  const over = (key: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(key);
    document.body.style.cursor = 'pointer';
  };
  const out = (key: string) => () => {
    setHover((h) => (h === key ? null : h));
    document.body.style.cursor = '';
  };

  const capMid = axisAt(st, st.cap.z0 + st.cap.h / 2);
  const capUp = st.mount === 'floor';
  const top = st.mount === 'floor' ? axisAt(st, 0) : axisAt(st, -d.hangerT);

  return (
    <group position={offset}>
      {/* Base or canopy, plus the drop cable. */}
      {st.mount === 'floor' ? (
        <mesh position={toWorld([st.pos[0], st.pos[1], st.pos[2] + d.baseTop / 2])} material={stackSel ? mats.selected : mats.base} raycast={() => null}>
          <cylinderGeometry args={[d.baseR, d.baseR, d.baseTop, 40]} />
        </mesh>
      ) : (
        <>
          <mesh position={toWorld([st.pos[0], st.pos[1], st.pos[2] - d.canopyH / 2])} material={stackSel ? mats.selected : mats.base} raycast={() => null}>
            <cylinderGeometry args={[d.canopyR, d.canopyR * 0.9, d.canopyH, 40]} />
          </mesh>
          <Line points={[toWorld([st.pos[0], st.pos[1], st.pos[2] - d.canopyH]), toWorld(top)]} color="#9aa0b8" lineWidth={1.2} dashed dashSize={10} gapSize={6} />
        </>
      )}

      {/* Segment slabs, clickable. */}
      {st.segs.map((s) => {
        const mid = axisAt(st, s.z0 + s.h / 2);
        const sel = selection?.kind === 'segment' && selection.id === s.id;
        const mat = sel ? mats.selected : hover === s.id ? mats.hover : mats.kind[s.kind];
        return (
          <group key={s.id} position={toWorld(mid)}>
            <mesh material={mat} raycast={rayFor(passive)} onClick={pick({ kind: 'segment', id: s.id })} onPointerOver={over(s.id)} onPointerOut={out(s.id)}>
              <cylinderGeometry args={[sel ? R * 1.04 : R, sel ? R * 1.04 : R, Math.max(1, s.h - 1.5), 40]} />
            </mesh>
            {(sel || hover === s.id) && (
              <Html position={[R + 14, 0, 0]} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${sel ? ' on' : ''}`}>
                {s.unit} · {s.px} px
              </Html>
            )}
          </group>
        );
      })}

      {/* Cap: selects the stack. */}
      <group position={toWorld(capMid)} rotation={[capUp ? 0 : Math.PI, 0, 0]}>
        <mesh
          material={stackSel ? mats.selected : hover === 'cap' ? mats.hover : mats.cap}
          raycast={rayFor(passive)}
          onClick={pick({ kind: 'stack', id: st.id })}
          onPointerOver={over('cap')}
          onPointerOut={out('cap')}
        >
          {st.cap.kind === 'fresnel' ? <cylinderGeometry args={[R, R, st.cap.h, 40]} /> : <cylinderGeometry args={[st.cap.kind === 'finial' ? 2 : R * 0.35, R, st.cap.h, 40]} />}
        </mesh>
      </group>

      <Handle
        id={handleId(st.id)}
        pos={hp}
        radius={(st.mount === 'floor' ? d.baseR : d.canopyR) * 0.42}
        shape="box"
        color={st.index === 0 ? COLORS.controller : COLORS.node}
        selected={stackSel}
        ghost={ghost}
        passive={passive}
        onClick={() => useColumn.getState().select({ kind: 'stack', id: st.id })}
        onMove={(p) => useColumn.getState().moveStack(st.id, [p[0], p[1], st.pos[2]])}
        label={`${st.label}${st.index === 0 ? ' · DATA IN' : ''}`}
        showLabel={showLabels}
        labelClass={st.index === 0 ? 'ctl' : undefined}
      />
    </group>
  );
}

/** Data path: up (or down) each stack beside its axis, segment by segment, then on to the next stack. */
function ChainOverlay({ plan }: { plan: CsPlan }) {
  const drag = useColumn((s) => s.drag);
  const d = plan.dims;
  const side = d.R + 12;
  const n = Math.max(1, plan.units.length - 1);
  let k = 0;
  const shift = (st: StackPlan): Vec3 => {
    if (!drag || drag.id !== handleId(st.id)) return [0, 0, 0];
    return sub(drag.pos, handlePos(st, plan));
  };
  const entry = (st: StackPlan): Vec3 => add(handlePos(st, plan), shift(st));
  return (
    <>
      {plan.stacks.map((st, si) => {
        const off = add([side, 0, 0], shift(st));
        const runs = [...st.segs.map((s) => ({ id: s.id, z0: s.z0, h: s.h, lit: s.px > 0 })), ...(st.cap.px ? [{ id: 'cap', z0: st.cap.z0, h: st.cap.h, lit: true }] : [])];
        const next = plan.stacks[si + 1];
        return (
          <group key={st.id}>
            {runs.map((r) => {
              const a = add(axisAt(st, r.z0 + 2), off);
              const b = add(axisAt(st, r.z0 + r.h - 2), off);
              const color = COLORS.chainA.clone().lerp(COLORS.chainB, k++ / n);
              const { q } = between(a, b);
              const tip = add(a, [(b[0] - a[0]) * 0.6, (b[1] - a[1]) * 0.6, (b[2] - a[2]) * 0.6]);
              return (
                <group key={r.id}>
                  <Line points={[toWorld(a), toWorld(b)]} color={color} lineWidth={2.4} />
                  <mesh position={toWorld(tip)} quaternion={q} raycast={() => null}>
                    <coneGeometry args={[4, 11, 12]} />
                    <meshBasicMaterial color={color} toneMapped={false} />
                  </mesh>
                </group>
              );
            })}
            {next && <Line points={[toWorld(entry(st)), toWorld(entry(next))]} color={COLORS.darkRun} lineWidth={1.5} dashed dashSize={12} gapSize={8} />}
          </group>
        );
      })}
    </>
  );
}

/** Floor stacks stand on the bench floor (z = 0) wherever the work plane is. Shows a ghost base. */
function FloorPick({ radius }: { radius: number }) {
  const snap = useColumn((s) => s.snap);
  const [at, setAt] = useState<Vec3 | null>(null);
  const pt = (e: ThreeEvent<PointerEvent | MouseEvent>): Vec3 => {
    const p = toLocal(e.point);
    return [snapTo(p[0], snap), snapTo(p[1], snap), 0];
  };
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => setAt(pt(e))}
        onPointerOut={() => setAt(null)}
        onClick={(e) => {
          if (e.delta > 4) return;
          e.stopPropagation();
          useColumn.getState().addStack(pt(e), 'floor');
        }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
      {at && (
        <mesh position={toWorld([at[0], at[1], 4])} raycast={() => null}>
          <cylinderGeometry args={[radius, radius, 8, 40]} />
          <meshBasicMaterial color={COLORS.selected} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

/** Stacks as clickable segment slabs, base/canopy handles, the data path and the placing plane. */
export function CsScene({ ghost, hideStale, passive }: SceneProps) {
  const plan = useCsPlan();
  const tool = useColumn((s) => s.tool);
  const showChain = useColumn((s) => s.showChain);
  const g = ghost && !hideStale;
  return (
    <>
      {plan.stacks.map((st) => (
        <StackView key={st.id} st={st} plan={plan} ghost={g} passive={passive} />
      ))}
      {showChain && <ChainOverlay plan={plan} />}
      {!passive && tool === 'stack' && <FloorPick radius={plan.dims.baseR} />}
      {!passive && tool === 'drop' && <WorkPlane ghostRadius={plan.dims.canopyR * 0.5} onPick={(p) => useColumn.getState().addStack(p, 'hang')} />}
    </>
  );
}

/** Glow size on the bench: about a pixel cell. */
export function useCsPixelSize(): number {
  return 16;
}
