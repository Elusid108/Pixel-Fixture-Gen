import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { BENCH_COLORS as COLORS, between, toLocal, toWorld } from '../../../ui/bench/util';
import { WorkPlane } from '../../../ui/bench/WorkPlane';
import { useBench } from '../../../workbench/store';
import type { SceneProps } from '../../../workbench/ui';
import { cross, norm } from '../../../geom/vec';
import type { SketchPlane } from '../../../sketch/types';
import type { Vec3 } from '../../../types';
import { Handle, NO_RAY } from '../../shared/Handle';
import { anchorKey, anchorLabel, parseAnchorKey, type PcDesign } from '../model';
import type { PcGarlandPlan, PcPlan } from '../plan';
import { HANG_Z } from '../system';
import { pendingFirst, planFor, usePc, usePcParams } from './usePc';

const NO_LINE_RAY = () => null;

/** Shift held: anchor drags move up and down instead of across the bench. */
function useShift(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Shift' && setOn(true);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && setOn(false);
    const blur = () => setOn(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return on;
}

/** The design with the anchor being dragged moved to its live position. */
function useLiveDesign(vertical: boolean): PcDesign {
  const design = usePc((s) => s.design);
  const drag = usePc((s) => s.drag);
  return useMemo(() => {
    const k = drag ? parseAnchorKey(drag.id) : null;
    if (!drag || !k) return design;
    return {
      ...design,
      garlands: design.garlands.map((g) =>
        g.id !== k.gid ? g : { ...g, anchors: g.anchors.map((a, i) => (i !== k.index ? a : vertical ? ([a[0], a[1], drag.pos[2]] as Vec3) : ([drag.pos[0], drag.pos[1], a[2]] as Vec3))) },
      ),
    };
  }, [design, drag, vertical]);
}

/* ---------------- Link markers (instanced) ---------------- */

const tmp = new Matrix4();

function LinkMarkers({ gp, radius, color, hidden, passive, onPick }: { gp: PcGarlandPlan; radius: number; color: string; hidden: boolean; passive: boolean; onPick: (e: ThreeEvent<MouseEvent>) => void }) {
  const ref = useRef<InstancedMesh>(null);
  const links = gp.links;
  const mat = useMemo(
    () =>
      hidden
        ? new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
        : new MeshStandardMaterial({ color, emissive: new Color(color).multiplyScalar(0.25), roughness: 0.35, transparent: true, opacity: 0.9 }),
    [hidden, color],
  );
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    links.forEach((l, i) => {
      const p = toWorld(l.pos);
      m.setMatrixAt(i, tmp.makeTranslation(p.x, p.y, p.z));
    });
    m.instanceMatrix.needsUpdate = true;
    m.boundingSphere = null;
    m.computeBoundingSphere();
  }, [links]);
  if (!links.length) return null;
  return (
    <instancedMesh
      key={links.length}
      ref={ref}
      args={[undefined, undefined, links.length]}
      material={mat}
      raycast={passive ? NO_RAY : InstancedMesh.prototype.raycast}
      onClick={(e) => {
        if (e.delta > 4) return;
        e.stopPropagation();
        onPick(e);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <sphereGeometry args={[radius, 14, 10]} />
    </instancedMesh>
  );
}

/* ---------------- Data path overlay ---------------- */

function ChainOverlay({ plan, lift }: { plan: PcPlan; lift: number }) {
  const total = Math.max(1, plan.px - 1);
  let at = 0;
  const up = (p: Vec3): Vec3 => [p[0], p[1], p[2] + lift];
  const spliceAt = new Set(plan.splices.map((s) => `${s.gid}:${s.link}`));
  return (
    <>
      {plan.garlands.map((gp) => {
        if (gp.incomplete || gp.order.length < 2) {
          at += gp.order.length;
          return null;
        }
        const start = at;
        at += gp.order.length;
        const pts = gp.order.map((l) => toWorld(up(l.pos)));
        const colors = gp.order.map((_, i) => {
          const c = COLORS.chainA.clone().lerp(COLORS.chainB, (start + i) / total);
          return [c.r, c.g, c.b] as [number, number, number];
        });
        const a = up(gp.order[0].pos);
        const b = up(gp.order[1].pos);
        const { q } = between(a, b);
        const head = COLORS.chainA.clone().lerp(COLORS.chainB, start / total);
        return (
          <group key={gp.id}>
            <Line points={pts} vertexColors={colors} lineWidth={2.2} raycast={NO_LINE_RAY} />
            <mesh position={toWorld(a)} quaternion={q} raycast={NO_RAY}>
              <coneGeometry args={[lift * 0.3, lift * 0.8, 12]} />
              <meshBasicMaterial color={head} toneMapped={false} />
            </mesh>
            {gp.order.map((l, i) =>
              spliceAt.has(`${gp.id}:${i + 1}`) ? (
                <Html key={i} position={toWorld(up(l.pos))} center pointerEvents="none" zIndexRange={[20, 0]} className="wb-tag order">
                  splice
                </Html>
              ) : null,
            )}
          </group>
        );
      })}
      {plan.jumps.map((j) => {
        const from = plan.garlands.find((g) => g.id === j.from)!;
        const to = plan.garlands.find((g) => g.id === j.to)!;
        return (
          <Line
            key={`${j.from}-${j.to}`}
            points={[toWorld(up(from.order[from.order.length - 1].pos)), toWorld(up(to.order[0].pos))]}
            color={j.mm > plan.dims.lead ? COLORS.bad : COLORS.darkRun}
            lineWidth={1.5}
            dashed
            dashSize={14}
            gapSize={10}
            raycast={NO_LINE_RAY}
          />
        );
      })}
    </>
  );
}

/* ---------------- The system scene ---------------- */

/** Anchors, the catenary preview, link markers, the data path and the garland work plane. */
export function PcScene({ ghost, hideStale, passive }: SceneProps) {
  const tool = usePc((s) => s.tool);
  const selection = usePc((s) => s.selection);
  const pending = usePc((s) => s.pending);
  const showChain = usePc((s) => s.showChain);
  const showLabels = usePc((s) => s.showLabels);
  const workZ = usePc((s) => s.workZ);
  const camera = useThree((s) => s.camera);
  const params = usePcParams();
  const shift = useShift();
  const vertical = shift && tool === 'select';
  const live = useLiveDesign(vertical);
  const plan = useMemo(() => planFor(live, params), [live, params]);
  const st = usePc.getState;

  // Garlands hang: a placing tool on a plane at bench-top height starts at hang height instead.
  const lastTool = useRef(tool);
  useEffect(() => {
    if (tool === 'garland' && lastTool.current !== 'garland' && workZ < 200) useBench.getState().set('workZ', HANG_Z);
    lastTool.current = tool;
  }, [tool, workZ]);

  const d = plan.dims;
  const g = ghost && !hideStale;
  const handleR = g ? d.R * 1.1 : Math.max(8, d.R * 0.55);
  const markerR = g ? d.R * 1.05 : Math.max(5, d.R * 0.4);
  const selGarland = selection?.kind === 'garland' ? selection.id : selection?.kind === 'anchor' ? parseAnchorKey(selection.id)?.gid : null;

  // Shift-drag plane: vertical, facing the camera, through the anchor.
  const look = new Vector3();
  camera.getWorldDirection(look);
  const dl = toLocal(look);
  const h: Vec3 = Math.hypot(dl[0], dl[1]) > 1e-6 ? norm([dl[0], dl[1], 0]) : [0, 1, 0];
  const across = norm(cross(h, [0, 0, 1]));
  const vplane = (p: Vec3): SketchPlane => ({ origin: p, u: across, v: [0, 0, 1] });

  const first = pendingFirst(pending);

  return (
    <>
      {plan.garlands.map((gp) => {
        const garland = live.garlands.find((x) => x.id === gp.id)!;
        const on = selGarland === gp.id;
        const dataIn = gp.order[0]?.anchor ?? 0;
        return (
          <group key={gp.id}>
            <Line points={gp.curve.map(toWorld)} color={on ? COLORS.selected : COLORS.strut} lineWidth={on ? 2.6 : 1.4} transparent opacity={g ? 0.55 : 0.95} raycast={NO_LINE_RAY} />
            <LinkMarkers
              gp={gp}
              radius={markerR}
              color={on ? COLORS.selected : gp.worst && !gp.worst.ok ? COLORS.bad : COLORS.node}
              hidden={g}
              passive={passive}
              onPick={() => {
                const s = st();
                if (s.tool === 'garland') return;
                s.select({ kind: 'garland', id: gp.id });
              }}
            />
            {garland.anchors.map((a, i) => {
              const key = anchorKey(gp.id, i);
              const isSel = selection?.kind === 'anchor' && selection.id === key;
              return (
                <Handle
                  key={key}
                  id={key}
                  pos={a}
                  radius={handleR}
                  color={i === dataIn ? COLORS.controller : COLORS.node}
                  selected={isSel}
                  ghost={g}
                  passive={passive}
                  plane={vertical ? vplane(a) : undefined}
                  cursor={vertical ? 'ns-resize' : undefined}
                  onMove={
                    tool === 'select'
                      ? (p) => {
                          const cur = usePc.getState().design.garlands.find((x) => x.id === gp.id)?.anchors[i] ?? a;
                          st().moveAnchor(gp.id, i, vertical ? [cur[0], cur[1], p[2]] : [p[0], p[1], cur[2]]);
                        }
                      : undefined
                  }
                  onClick={() => {
                    const s = st();
                    if (s.tool === 'garland') {
                      // Clicking the first anchor of the garland being drawn closes it into a ring.
                      if (s.pending === gp.id && i === 0 && garland.anchors.length >= 3) s.placeAnchor(a);
                      return;
                    }
                    s.select({ kind: 'anchor', id: key });
                  }}
                  label={i === dataIn ? `${gp.id} · ${anchorLabel(i)} · DATA IN` : anchorLabel(i)}
                  showLabel={showLabels}
                  labelClass={i === dataIn ? 'ctl' : undefined}
                />
              );
            })}
          </group>
        );
      })}
      {showChain && <ChainOverlay plan={plan} lift={d.R + 16} />}
      {first && (
        <mesh position={toWorld(first)} raycast={NO_RAY}>
          <sphereGeometry args={[handleR, 16, 12]} />
          <meshBasicMaterial color={COLORS.pending} transparent opacity={0.7} />
        </mesh>
      )}
      {tool === 'garland' && !passive && <WorkPlane ghostRadius={handleR} onPick={(p) => st().placeAnchor(p)} />}
    </>
  );
}

/** Glow size for built pixels: about the bead. */
export function usePcPixelSize(): number {
  const params = usePcParams();
  return Number(params.beadD) * 2.2;
}
