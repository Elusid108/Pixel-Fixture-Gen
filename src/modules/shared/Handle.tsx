import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Color, Mesh, MeshStandardMaterial, Plane, Vector3 } from 'three';
import { BENCH_COLORS, snapTo, toLocal, toWorld } from '../../ui/bench/util';
import { useBench } from '../../workbench/store';
import { add, cross, dot, norm, scale, sub } from '../../geom/vec';
import type { SketchPlane } from '../../sketch/types';
import type { Vec3 } from '../../types';

/**
 * Scene building blocks shared by the M-series: a draggable point handle and a raycast switch
 * that honours `passive` (a drawing tool is active, so handles draw but don't take clicks).
 */

export const NO_RAY = () => null;
/** Pass as `raycast` on any pickable mesh. */
export const rayFor = (passive: boolean) => (passive ? NO_RAY : Mesh.prototype.raycast);

/** Live position of a handle being dragged, or its stored position. */
export function useLivePos(id: string, pos: Vec3): Vec3 {
  const drag = useBench((s) => s.drag);
  return drag && drag.id === id ? drag.pos : pos;
}

export function handleMaterial(color: string, ghost: boolean) {
  return new MeshStandardMaterial({ color, emissive: new Color(color).multiplyScalar(0.35), roughness: 0.4, transparent: ghost, opacity: ghost ? 0.4 : 1, depthWrite: !ghost });
}

export interface HandleProps {
  /** Unique within the system; used for the live drag state. */
  id: string;
  pos: Vec3;
  radius: number;
  color?: string;
  selected?: boolean;
  ghost?: boolean;
  passive: boolean;
  /** Drag plane. Default: horizontal through the point. With a plane, the point slides in it. */
  plane?: SketchPlane;
  /** Called on release after a real drag, with the snapped position. Omit to make the handle click-only. */
  onMove?: (pos: Vec3) => void;
  onClick?: (e: ThreeEvent<PointerEvent>) => void;
  label?: ReactNode;
  /** Show the label without hover or selection (an "IDs" overlay). */
  showLabel?: boolean;
  labelClass?: string;
  shape?: 'sphere' | 'box';
  cursor?: string;
}

/**
 * A pickable sphere that clicks and drags. Drags preview through the bench's `drag` state
 * (so the system can show its design moving) and commit once on release via `onMove`.
 */
export function Handle({ id, pos, radius, color = BENCH_COLORS.node, selected, ghost = false, passive, plane, onMove, onClick, label, showLabel, labelClass, shape = 'sphere', cursor }: HandleProps) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const snap = useBench((s) => s.snap);
  const live = useLivePos(id, pos);
  const [hover, setHover] = useState(false);
  const ref = useRef<{ plane: Plane; start: Vec3; grab: Vec3; moved: boolean; x: number; y: number } | null>(null);
  const mat = useMemo(() => handleMaterial(selected ? BENCH_COLORS.selected : color, ghost), [selected, color, ghost]);

  const snapIn = (p: Vec3): Vec3 => {
    if (!plane) return [snapTo(p[0], snap), snapTo(p[1], snap), p[2]];
    // Snap in plane coordinates.
    const d = sub(p, plane.origin);
    const x = snapTo(dot(d, plane.u), snap);
    const y = snapTo(dot(d, plane.v), snap);
    return add(plane.origin, add(scale(plane.u, x), scale(plane.v, y)));
  };

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const P = toWorld(pos);
    const n = plane ? norm(cross(plane.u, plane.v)) : ([0, 0, 1] as Vec3);
    const normal = toWorld(n).sub(toWorld([0, 0, 0])).normalize();
    const pl = new Plane().setFromNormalAndCoplanarPoint(normal, P);
    const hit = new Vector3();
    const grab = e.ray.intersectPlane(pl, hit) ? toLocal(hit) : pos;
    ref.current = { plane: pl, start: pos, grab, moved: false, x: e.clientX, y: e.clientY };
    if (onMove) {
      (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
      if (controls) controls.enabled = false;
    }
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = ref.current;
    if (!d || !onMove) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    const hit = new Vector3();
    if (!e.ray.intersectPlane(d.plane, hit)) return;
    const at = toLocal(hit);
    useBench.getState().setDrag({ id, pos: snapIn(add(d.start, sub(at, d.grab))) });
  };

  const up = (e: ThreeEvent<PointerEvent>) => {
    const d = ref.current;
    if (!d) return;
    ref.current = null;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
    const st = useBench.getState();
    if (d.moved && st.drag && st.drag.id === id) onMove?.(st.drag.pos);
    else onClick?.(e);
    st.setDrag(null);
  };

  const s = selected || hover ? 1.15 : 1;
  return (
    <group position={toWorld(live)}>
      <mesh
        material={mat}
        raycast={rayFor(passive)}
        scale={s}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = cursor ?? (onMove ? 'grab' : 'pointer');
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        {shape === 'box' ? <boxGeometry args={[radius * 1.6, radius * 1.6, radius * 1.6]} /> : <sphereGeometry args={[radius, 20, 14]} />}
      </mesh>
      {label !== undefined && (selected || hover || showLabel) && (
        <Html position={[0, radius + 6, 0]} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${selected ? ' on' : ''}${labelClass ? ` ${labelClass}` : ''}`}>
          {label}
        </Html>
      )}
    </group>
  );
}
