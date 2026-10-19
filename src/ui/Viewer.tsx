import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { BuildResult } from '../build/runBuild';
import { plateTransform } from '../export/plates';
import { mul, T } from '../geom/mat';
import type { Plate } from '../export/plates';
import type { Printer } from '../printers';
import type { BuiltPart, Mat4, MaterialRole } from '../types';
import { makeEffect } from './effects';
import { usePlates } from './PartsPanel';
import { useStore } from './store';
import { touchFriendlyEvents } from './touch';

const ROLE_COLOR: Record<MaterialRole, string> = { body: '#34343c', baffle: '#46465a', diffuser: '#f2eee4' };

export function useGeometries(parts: BuiltPart[]) {
  const geos = useMemo(() => {
    const m = new Map<string, BufferGeometry>();
    for (const p of parts) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(p.mesh.positions, 3));
      g.setIndex(new BufferAttribute(p.mesh.indices, 1));
      g.computeBoundingSphere();
      m.set(p.id, g);
    }
    return m;
  }, [parts]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return geos;
}

export function useMaterials() {
  return useMemo(() => {
    const body = new MeshStandardMaterial({ color: ROLE_COLOR.body, roughness: 0.62, metalness: 0.05, flatShading: true });
    const baffle = new MeshStandardMaterial({ color: ROLE_COLOR.baffle, roughness: 0.7, flatShading: true });
    const diffuser = new MeshStandardMaterial({
      color: ROLE_COLOR.diffuser,
      roughness: 0.35,
      transparent: true,
      opacity: 0.62,
      flatShading: true,
      side: DoubleSide,
      depthWrite: false,
      emissive: new Color(0, 0, 0),
    });
    const selected = new MeshStandardMaterial({ color: '#2fd4ff', emissive: new Color('#0b5d78'), roughness: 0.4, flatShading: true });
    return { body, baffle, diffuser, selected };
  }, []);
}

export function PartMesh({ geometry, material, matrix }: { geometry: BufferGeometry; material: MeshStandardMaterial; matrix: Mat4 }) {
  const ref = useRef<Mesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.matrix.fromArray(matrix);
    ref.current.matrixWorldNeedsUpdate = true;
  }, [matrix]);
  return <mesh ref={ref} geometry={geometry} material={material} matrixAutoUpdate={false} castShadow receiveShadow />;
}

/** Assembled-frame bounds of every placed instance. */
export function assembledBounds(parts: BuiltPart[]): Box3 {
  const box = new Box3();
  const m = new Matrix4();
  for (const p of parts) {
    const local = new Box3(new Vector3(...p.bounds.min), new Vector3(...p.bounds.max));
    for (const inst of p.instances) box.union(local.clone().applyMatrix4(m.fromArray(inst)));
  }
  return box;
}

export function Pixels({ result, size, diffuser }: { result: BuildResult; size: number; diffuser: MeshStandardMaterial }) {
  const effect = useStore((s) => s.effect);
  const core = useRef<InstancedMesh>(null);
  const glow = useRef<InstancedMesh>(null);
  const n = result.pixels.length;
  const fn = useMemo(() => makeEffect(result.pixels, effect), [result.pixels, effect]);
  const glowR = Math.min(16, Math.max(5, size * 0.035));
  const glowMat = useMemo(
    () => new MeshBasicMaterial({ transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );

  useLayoutEffect(() => {
    const o = new Object3D();
    result.pixels.forEach((p, i) => {
      o.position.set(...p.pos);
      o.scale.setScalar(1);
      o.updateMatrix();
      core.current?.setMatrixAt(i, o.matrix);
      o.scale.setScalar(glowR / 2.2);
      o.updateMatrix();
      glow.current?.setMatrixAt(i, o.matrix);
    });
    if (core.current) core.current.instanceMatrix.needsUpdate = true;
    if (glow.current) glow.current.instanceMatrix.needsUpdate = true;
  }, [result.pixels, glowR]);

  const c = useMemo(() => new Color(), []);
  const avg = useMemo(() => new Color(), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    avg.setRGB(0, 0, 0);
    for (let i = 0; i < n; i++) {
      fn(i, t, c);
      core.current?.setColorAt(i, c);
      glow.current?.setColorAt(i, c);
      avg.r += c.r / n;
      avg.g += c.g / n;
      avg.b += c.b / n;
    }
    if (core.current?.instanceColor) core.current.instanceColor.needsUpdate = true;
    if (glow.current?.instanceColor) glow.current.instanceColor.needsUpdate = true;
    diffuser.emissive.copy(avg).multiplyScalar(effect === 'off' ? 0 : 0.55);
  });

  if (!n) return null;
  return (
    <group>
      <instancedMesh ref={core} args={[undefined, undefined, n]} key={`c${n}`}>
        <sphereGeometry args={[2.2, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, n]} key={`g${n}`}>
        <sphereGeometry args={[2.2, 16, 12]} />
        <primitive object={glowMat} attach="material" />
      </instancedMesh>
    </group>
  );
}

export function CameraRig({ center, radius, viewKey }: { center: Vector3; radius: number; viewKey: string }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const ctl = controls as unknown as OrbitControlsImpl | null;
    // Fixtures face assembled +Y, which is world -Z after the Z-up → Y-up turn.
    // Three-quarter view from the front-right, slightly above.
    const dir = new Vector3(0.8, 0.6, -1).normalize();
    // A portrait view (a phone) is narrower than it is tall: back off so the sides fit too.
    const aspect = (camera as { aspect?: number }).aspect ?? 1;
    const dist = Math.max(140, (radius * 2.6) / Math.min(1, Math.max(0.45, aspect)));
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    camera.near = 1;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    if (ctl) {
      ctl.target.copy(center);
      ctl.update();
    }
    // Re-frame only when the fixture or view changes, not on every slider move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, controls]);
  return null;
}

export type Materials = ReturnType<typeof useMaterials>;

/** Background, lights and the bench grid, shared by the catalogue viewer and the workbench. */
export function SceneBasics({ size }: { size: number }) {
  return (
    <>
      <color attach="background" args={['#0b0b10']} />
      <hemisphereLight args={['#d6defa', '#241c2c', 1.1]} />
      <directionalLight position={[260, 420, -300]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-300, 200, 260]} intensity={0.9} color="#8fb4ff" />
      <directionalLight position={[0, -200, -300]} intensity={0.35} color="#ffcf9a" />
      <Grid
        position={[0, -0.05, 0]}
        args={[10, 10]}
        cellSize={10}
        sectionSize={100}
        cellColor="#1d1d26"
        sectionColor="#2b2b3a"
        fadeDistance={Math.max(1200, size * 6)}
        infiniteGrid
      />
    </>
  );
}

/** One plate of the bed layout. Lives inside the Z-up group. */
export function PlateScene({ parts, geos, mats, printer, plate, selected }: { parts: BuiltPart[]; geos: Map<string, BufferGeometry>; mats: Materials; printer: Printer; plate: Plate; selected?: string | null }) {
  return (
    <>
      <mesh position={[printer.x / 2, printer.y / 2, -0.6]} receiveShadow>
        <boxGeometry args={[printer.x, printer.y, 1.2]} />
        <meshStandardMaterial color="#17171f" roughness={0.9} />
      </mesh>
      {plate.items.map((it) => {
        const p = parts.find((x) => x.id === it.partId);
        if (!p || !geos.get(p.id)) return null;
        return (
          <PartMesh
            key={`${it.partId}-${it.instance}`}
            geometry={geos.get(p.id)!}
            material={it.oversize || p.id === selected ? mats.selected : mats[p.role]}
            matrix={plateTransform(p.bounds, it)}
          />
        );
      })}
    </>
  );
}

/** Camera framing for the plates view, in Y-up world coordinates. */
export const plateFrame = (printer: Printer) => ({ center: new Vector3(printer.x / 2, 0, -printer.y / 2), radius: Math.max(printer.x, printer.y) * 0.55 });

export function Viewer() {
  const result = useStore((s) => s.result);
  const explode = useStore((s) => s.explode);
  const view = useStore((s) => s.view);
  const plateIndex = useStore((s) => s.plateIndex);
  const selected = useStore((s) => s.selectedPart);
  const parts = result?.parts ?? [];
  const geos = useGeometries(parts);
  const mats = useMaterials();

  const box = useMemo(() => assembledBounds(parts), [parts]);
  const size = box.isEmpty() ? 150 : box.getSize(new Vector3()).length();
  const { printer, plates } = usePlates();
  const plate = plates[Math.min(plateIndex, plates.length - 1)];

  // Camera framing, in Y-up world coordinates.
  const frame = useMemo(() => {
    if (view === 'plates') return plateFrame(printer);
    if (box.isEmpty()) return { center: new Vector3(), radius: 100 };
    const c = box.getCenter(new Vector3());
    return { center: new Vector3(c.x, c.z, -c.y), radius: size / 2 };
  }, [view, box, size, printer]);

  const matFor = (p: BuiltPart) => (p.id === selected ? mats.selected : mats[p.role]);
  const explodeDist = explode * size * 0.45;

  return (
    <Canvas shadows camera={{ fov: 35, position: [300, 250, 400] }} dpr={[1, 2]} gl={{ antialias: true }} events={touchFriendlyEvents}>
      <SceneBasics size={size} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <CameraRig center={frame.center} radius={frame.radius} viewKey={`${result?.fixtureId}-${view}-${printer.id}`} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {view === 'assembled' &&
          parts.map((p) =>
            p.instances.map((inst, i) => (
              <PartMesh
                key={`${p.id}-${i}`}
                geometry={geos.get(p.id)!}
                material={matFor(p)}
                matrix={explodeDist ? mul(T(p.explode[0] * explodeDist, p.explode[1] * explodeDist, p.explode[2] * explodeDist), inst) : inst}
              />
            )),
          )}
        {view === 'assembled' && result && <Pixels result={result} size={size} diffuser={mats.diffuser} />}
        {view === 'plates' && plate && <PlateScene parts={parts} geos={geos} mats={mats} printer={printer} plate={plate} selected={selected} />}
      </group>
    </Canvas>
  );
}
