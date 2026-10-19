import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, type ReactNode } from 'react';
import type { BuiltPart } from '../../types';
import { getCore } from '../../workbench/cores';
import { designOf, useBench } from '../../workbench/store';
import { getUI } from '../../workbench/uis';
import { usePlates } from '../PartsPanel';
import { useStore } from '../store';
import { CameraRig, PartMesh, Pixels, PlateScene, SceneBasics, plateFrame, useGeometries, useMaterials } from '../Viewer';
import { toWorld } from './util';

const DEFAULT_PIXEL_SIZE = () => 12;

/**
 * The shared bench canvas: camera, lights, built parts, pixel preview and the plates view.
 * The active system draws its handles and overlays through `SystemUI.Scene`; extra layers
 * (the drawing engine) come in as children.
 */
export function BenchCanvas({ children }: { children?: ReactNode }) {
  const system = useBench((s) => s.system);
  const core = getCore(system);
  const ui = getUI(system);
  const result = useStore((s) => s.result);
  const view = useStore((s) => s.view);
  const plateIndex = useStore((s) => s.plateIndex);
  const selectedPart = useStore((s) => s.selectedPart);
  const design = useBench(designOf);
  const tool = useBench((s) => s.tool);
  const showParts = useBench((s) => s.showParts);
  const frameSeq = useBench((s) => s.frameSeq);
  const drag = useBench((s) => s.drag);
  const built = result?.fixtureId === core.moduleId ? result : null;
  const parts: BuiltPart[] = built?.parts ?? [];
  const geos = useGeometries(parts);
  const mats = useMaterials();
  const { printer, plates } = usePlates();
  const plate = plates[Math.min(plateIndex, plates.length - 1)];
  const fr = core.frame(design);

  const frame = useMemo(() => {
    if (view === 'plates') return plateFrame(printer);
    return { center: toWorld(fr.center), radius: fr.radius };
    // Re-frame on a new design, system or view, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, printer, frameSeq, system, built ? 1 : 0]);

  const ghost = showParts && parts.length > 0;
  const hideStale = drag !== null;
  const Scene = ui.Scene;

  return (
    <Canvas
      shadows
      camera={{ fov: 35, position: [600, 500, 800] }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onPointerMissed={(e) => {
        if (e.button === 0 && !tool.startsWith('draw:') && !ui.tools.find((t) => t.id === tool)?.plane) useBench.getState().select(null);
      }}
    >
      <SceneBasics size={fr.radius * 1.4} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <CameraRig center={frame.center} radius={frame.radius} viewKey={`wb-${system}-${view}-${printer.id}-${frameSeq}-${built ? 1 : 0}`} />
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
            {showParts && built && !hideStale && <BuiltPixels key={system} usePixelSize={ui.usePixelSize ?? DEFAULT_PIXEL_SIZE} result={built} diffuser={mats.diffuser} />}
          </group>
          <Scene key={system} ghost={ghost} hideStale={hideStale} passive={tool.startsWith('draw:')} />
          {children}
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

function BuiltPixels({ usePixelSize, ...rest }: { usePixelSize: () => number } & Omit<Parameters<typeof Pixels>[0], 'size'>) {
  const size = usePixelSize();
  return <Pixels {...rest} size={size} />;
}
