import { Grid } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useState } from 'react';
import { DoubleSide } from 'three';
import type { Vec3 } from '../../types';
import { useBench } from '../../workbench/store';
import { BENCH_COLORS, snapTo, toLocal, toWorld } from './util';

/**
 * A horizontal grid at the bench's work height that turns clicks into snapped Z-up points.
 * Systems mount it while a placing tool is active.
 */
export function WorkPlane({ onPick, ghostRadius = 8 }: { onPick: (p: Vec3) => void; ghostRadius?: number }) {
  const workZ = useBench((s) => s.workZ);
  const snap = useBench((s) => s.snap);
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
          onPick(at(e));
        }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
      {ghost && (
        <mesh position={toWorld(ghost)}>
          <sphereGeometry args={[ghostRadius, 16, 12]} />
          <meshBasicMaterial color={BENCH_COLORS.selected} transparent opacity={0.5} />
        </mesh>
      )}
    </>
  );
}
