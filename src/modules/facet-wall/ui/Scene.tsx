import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, MeshBasicMaterial, type Vector3 } from 'three';
import { add, scale } from '../../../geom/vec';
import { fromPlane, planeNormal, toPlane } from '../../../sketch/geom';
import type { SketchPlane, Vec2 } from '../../../sketch/types';
import { BENCH_COLORS, toWorld } from '../../../ui/bench/util';
import type { SceneProps } from '../../../workbench/ui';
import { Handle, rayFor } from '../../shared/Handle';
import type { Facet, FwLayout } from '../layout';
import type { FwDesign } from '../model';
import { tileOfSel, vertexId } from '../system';
import { angleTo, GRADIENT_DRAG, useFw, useFwLayout, useFwParams, useLiveDesign, VERTEX_DRAG, wallCentre } from './useFw';

/** Depth colours, shallow → deep: D1, D2, D3. */
export const DEPTH_COLORS = ['#5c7cfa', '#2fd4ff', '#ffd166'];

/** A plane-coords point at height `z` off the wall, in three's world. */
const at = (pl: SketchPlane, p: Vec2, z: number): Vector3 => toWorld(add(fromPlane(p, pl), scale(planeNormal(pl), z)));
const lifted = (pl: SketchPlane, z: number): SketchPlane => ({ ...pl, origin: add(pl.origin, scale(planeNormal(pl), z)) });

const faceZ = (L: FwLayout, f: Facet) => (f.omitted ? L.dims.depth + 0.3 : L.dims.depth + L.dims.heights[f.level] + 0.3);

/* ---------------- Facets ---------------- */

/** Every facet as one triangle at its face height, coloured by depth. One mesh: faceIndex is the facet. */
function FacetField({ L, plane, ghost, passive }: { L: FwLayout; plane: SketchPlane; ghost: boolean; passive: boolean }) {
  const tool = useFw((s) => s.tool);
  const selection = useFw((s) => s.selection);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const pos = new Float32Array(L.facets.length * 9);
    const col = new Float32Array(L.facets.length * 9);
    const omitted = new Color('#4a4a58');
    const white = new Color('#ffffff');
    L.facets.forEach((f, i) => {
      const z = faceZ(L, f);
      const c = f.omitted ? omitted : new Color(DEPTH_COLORS[f.level]);
      if (f.overridden && !f.omitted) c.lerp(white, 0.3);
      f.corners.forEach((p, k) => {
        // Pulled in a little so the seams read.
        const q: Vec2 = [f.centroid[0] + (p[0] - f.centroid[0]) * 0.92, f.centroid[1] + (p[1] - f.centroid[1]) * 0.92];
        const w = at(plane, q, z);
        pos.set([w.x, w.y, w.z], i * 9 + k * 3);
        col.set([c.r, c.g, c.b], i * 9 + k * 3);
      });
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }, [L, plane]);
  useEffect(() => () => geo.dispose(), [geo]);

  const mat = useMemo(() => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: ghost ? 0.22 : 0.88, depthWrite: !ghost }), [ghost]);
  useEffect(() => () => mat.dispose(), [mat]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || e.faceIndex == null) return;
    const f = L.facets[e.faceIndex];
    if (!f) return;
    e.stopPropagation();
    const st = useFw.getState();
    if (st.tool === 'depth') {
      if (e.shiftKey) st.setDepth(f.key, null);
      else st.cycleDepth(f.key, f.level);
    } else if (st.tool === 'knock') st.toggleOmit(f.key);
    else st.select({ kind: 'facet', id: f.key });
  };

  const sel = selection?.kind === 'facet' ? L.byKey.get(selection.id) : undefined;
  const hov = hover !== null ? L.facets[hover] : undefined;
  const ring = (f: Facet) => [...f.corners, f.corners[0]].map((p) => at(plane, p, faceZ(L, f) + 0.4));

  return (
    <>
      <mesh
        geometry={geo}
        material={mat}
        raycast={rayFor(passive)}
        onClick={click}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (e.faceIndex != null && e.faceIndex !== hover) setHover(e.faceIndex);
          document.body.style.cursor = tool === 'select' ? 'pointer' : 'crosshair';
        }}
        onPointerOut={() => {
          setHover(null);
          document.body.style.cursor = '';
        }}
      />
      {hov && !passive && <Line points={ring(hov)} color={BENCH_COLORS.selected} lineWidth={1.2} transparent opacity={0.7} />}
      {sel && <Line points={ring(sel)} color={BENCH_COLORS.selected} lineWidth={2.4} />}
      {hov && !passive && tool === 'depth' && (
        <Html position={at(plane, hov.centroid, faceZ(L, hov) + 6)} center pointerEvents="none" zIndexRange={[20, 0]} className="wb-tag">
          D{hov.level + 1}
          {hov.overridden ? ' (set)' : ''} → D{((hov.level + 1) % 3) + 1}
        </Html>
      )}
    </>
  );
}

/* ---------------- Outline and vertex handles ---------------- */

function Outlines({ design, L, ghost, passive, z }: { design: FwDesign; L: FwLayout; ghost: boolean; passive: boolean; z: number }) {
  const selection = useFw((s) => s.selection);
  const showLabels = useFw((s) => s.showLabels);
  const plane = design.plane;
  const dragPlane = useMemo(() => lifted(plane, z), [plane, z]);
  const r = Math.max(5, L.side / 9);
  return (
    <>
      {design.areas.map((a) =>
        [a.outer, ...a.holes].map((loop, li) => (
          <group key={`${a.id}:${li}`}>
            <Line points={[...loop, loop[0]].map((p) => at(plane, p, z))} color={BENCH_COLORS.sketch} lineWidth={1.6} transparent={ghost} opacity={ghost ? 0.6 : 1} />
            {loop.map((p, i) => {
              const id = vertexId(a.id, li, i);
              return (
                <Handle
                  key={id}
                  id={VERTEX_DRAG + id}
                  pos={add(fromPlane(p, plane), scale(planeNormal(plane), z))}
                  radius={r}
                  color={BENCH_COLORS.sketch}
                  selected={selection?.kind === 'vertex' && selection.id === id}
                  ghost={ghost}
                  passive={passive}
                  plane={dragPlane}
                  onMove={(pos) => {
                    const st = useFw.getState();
                    st.moveVertex(id, toPlane(pos, st.design.plane));
                    st.select({ kind: 'vertex', id });
                  }}
                  onClick={() => useFw.getState().select({ kind: 'vertex', id })}
                  label={`${a.id} · ${li ? `hole ${li} ` : ''}#${i + 1}`}
                  showLabel={showLabels && i === 0 && li === 0}
                />
              );
            })}
          </group>
        )),
      )}
    </>
  );
}

/* ---------------- Gradient arrow ---------------- */

function GradientArrow({ design, L, ghost, passive, z }: { design: FwDesign; L: FwLayout; ghost: boolean; passive: boolean; z: number }) {
  const plane = design.plane;
  const c = wallCentre(design);
  const span = Math.max(L.bounds.max[0] - L.bounds.min[0], L.bounds.max[1] - L.bounds.min[1]);
  const len = Math.max(80, span * 0.35);
  const th = (design.driver.angle * Math.PI) / 180;
  const tip: Vec2 = [c[0] + Math.cos(th) * len, c[1] + Math.sin(th) * len];
  const tail: Vec2 = [c[0] - Math.cos(th) * len, c[1] - Math.sin(th) * len];
  const dragPlane = useMemo(() => lifted(plane, z), [plane, z]);
  const color = BENCH_COLORS.controller;
  return (
    <>
      <Line points={[at(plane, tail, z), at(plane, tip, z)]} color={color} lineWidth={2.4} dashed dashSize={12} gapSize={6} />
      <Handle
        id={GRADIENT_DRAG}
        pos={add(fromPlane(tip, plane), scale(planeNormal(plane), z))}
        radius={Math.max(7, L.side / 6)}
        color={color}
        ghost={ghost}
        passive={passive}
        plane={dragPlane}
        shape="box"
        onMove={(pos) => {
          const st = useFw.getState();
          st.setDriver({ angle: angleTo(st.design, pos) });
        }}
        label={`Gradient ${Math.round(design.driver.angle)}° · drag to turn`}
      />
    </>
  );
}

/* ---------------- Tiles and data path ---------------- */

function TileOutlines({ L, plane, z }: { L: FwLayout; plane: SketchPlane; z: number }) {
  const selection = useFw((s) => s.selection);
  const showLabels = useFw((s) => s.showLabels);
  const selTile = selection?.kind === 'tile' ? tileOfSel(selection.id) : selection?.kind === 'facet' ? L.byKey.get(selection.id)?.tile : undefined;
  const all = useMemo(() => L.tiles.flatMap((t) => t.outline.flatMap(([a, b]) => [at(plane, a, z), at(plane, b, z)])), [L, plane, z]);
  const sel = L.tiles.find((t) => t.id === selTile);
  const top = L.dims.depth + L.dims.heights[2] + 8;
  return (
    <>
      {all.length > 0 && <Line points={all} segments color="#8c93b8" lineWidth={1.4} />}
      {sel && <Line points={sel.outline.flatMap(([a, b]) => [at(plane, a, z + 0.2), at(plane, b, z + 0.2)])} segments color={BENCH_COLORS.selected} lineWidth={3} />}
      {showLabels &&
        L.tiles.map((t) => (
          <Html key={t.id} position={at(plane, t.centroid, top)} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${t.id === selTile ? ' on' : ''}`}>
            {t.id} · {t.cls}
          </Html>
        ))}
    </>
  );
}

function ChainOverlay({ L, plane }: { L: FwLayout; plane: SketchPlane }) {
  const { points, colors } = useMemo(() => {
    const n = Math.max(1, L.chain.length - 1);
    return {
      points: L.chain.map((f) => at(plane, f.centroid, faceZ(L, f) + 3)),
      colors: L.chain.map((_, i) => BENCH_COLORS.chainA.clone().lerp(BENCH_COLORS.chainB, i / n)),
    };
  }, [L, plane]);
  const longs = useMemo(() => L.longGaps.map((g) => [L.byKey.get(g.from)!, L.byKey.get(g.to)!]), [L]);
  if (points.length < 2) return null;
  return (
    <>
      <Line points={points} vertexColors={colors} lineWidth={2} />
      {longs.map(([a, b], i) => (
        <Line key={i} points={[at(plane, a.centroid, faceZ(L, a) + 4), at(plane, b.centroid, faceZ(L, b) + 4)]} color={BENCH_COLORS.bad} lineWidth={2.4} dashed dashSize={8} gapSize={5} />
      ))}
      <mesh position={points[0]}>
        <sphereGeometry args={[Math.max(3, L.side / 14), 14, 10]} />
        <meshBasicMaterial color={BENCH_COLORS.controller} toneMapped={false} />
      </mesh>
      <Html position={points[0]} center pointerEvents="none" zIndexRange={[20, 0]} className="wb-tag ctl" style={{ transform: 'translateY(-18px)' }}>
        DATA IN
      </Html>
    </>
  );
}

/* ---------------- The system scene ---------------- */

/** Facets (relief preview, depth tool target), outline handles, the gradient arrow, tiles and the strand. */
export function FwScene({ ghost, hideStale, passive }: SceneProps) {
  const L = useFwLayout();
  const design = useLiveDesign();
  const showChain = useFw((s) => s.showChain);
  const g = ghost && !hideStale;
  const front = L.dims.depth + 0.5;
  return (
    <>
      <FacetField L={L} plane={design.plane} ghost={g} passive={passive} />
      <TileOutlines L={L} plane={design.plane} z={front} />
      <Outlines design={design} L={L} ghost={g} passive={passive} z={front} />
      {design.driver.kind === 'gradient' && design.areas.length > 0 && <GradientArrow design={design} L={L} ghost={g} passive={passive} z={L.dims.depth + L.dims.heights[2] + 14} />}
      {showChain && <ChainOverlay L={L} plane={design.plane} />}
    </>
  );
}

/** Glow size on the bench follows the facet. */
export function useFwPixelSize(): number {
  return Number(useFwParams().side) * 0.75;
}
