import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';
import { add, scale } from '../../../geom/vec';
import { fromPlane, planeNormal, pointInPolygon, toPlane } from '../../../sketch/geom';
import type { Vec2 } from '../../../sketch/types';
import { BENCH_COLORS as COLORS, pickMat, toWorld } from '../../../ui/bench/util';
import type { SceneProps } from '../../../workbench/ui';
import { Handle, rayFor } from '../../shared/Handle';
import { fromLattice, hexPts, layoutWall, PLACED, type HwLayout, type HwSlot } from '../layout';
import type { HwDesign } from '../model';
import { liftPlane, parseVertexId, useHw, useHwLayout, useHwParams, vertexId, withVertex } from './useHw';

const TILE = { full: '#2fd4ff', partial: '#ffb347', whole: '#c56bff', empty: '#4a5566' };

type Loop = { outer: Vec2[]; holes: Vec2[][] };

/** Triangulated fill of loops (lattice coords) mapped into the world. */
function fillGeometry(loops: Loop[], map: (p: Vec2) => Vector3): BufferGeometry {
  const pos: number[] = [];
  for (const { outer, holes } of loops) {
    if (outer.length < 3) continue;
    const tris = ShapeUtils.triangulateShape(
      outer.map((p) => new Vector2(p[0], p[1])),
      holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))),
    );
    const all = [...outer, ...holes.flat()];
    for (const t of tris) {
      for (const k of t) {
        const v = map(all[k]);
        pos.push(v.x, v.y, v.z);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

const shift = (l: Vec2[], c: Vec2): Vec2[] => l.map((p) => [p[0] + c[0], p[1] + c[1]]);

/** A slot's visible shape in lattice coords: the clip for trimmed tiles, the hex otherwise. */
function slotLoops(s: HwSlot, A: number): Loop[] {
  if (s.state === 'partial' && s.clip) {
    const holes = s.clip.holes;
    return s.clip.outers.map((o) => ({ outer: shift(o, s.center), holes: holes.filter((h) => pointInPolygon(h[0], o)).map((h) => shift(h, s.center)) }));
  }
  return [{ outer: hexPts(A, s.center), holes: [] }];
}

const loopPts = (l: Vec2[], map: (p: Vec2) => Vector3) => [...l, l[0]].map(map);
/** Closed loops as one segment list, so a whole family draws as a single line object. */
const segs = (loops: Vec2[][], map: (p: Vec2) => Vector3) => loops.flatMap((l) => l.flatMap((p, k) => [map(p), map(l[(k + 1) % l.length])]));

/* ---------------- Tile slots ---------------- */

function Slots({ layout, map, ghost, passive }: { layout: HwLayout; map: (p: Vec2, dz?: number) => Vector3; ghost: boolean; passive: boolean }) {
  const tool = useHw((s) => s.tool);
  const selection = useHw((s) => s.selection);
  const showLabels = useHw((s) => s.showLabels);
  const [hover, setHover] = useState<string | null>(null);
  const A = layout.dims.A;
  const tileTool = tool === 'tile';
  const unitOf = useMemo(() => new Map(layout.tiles.map((t) => [t.slot.key, t])), [layout]);

  // Fills only for placed slots (pick targets for all of them, and for empty ones while the Tile tool is on).
  const geos = useMemo(() => {
    const m = new Map<string, BufferGeometry>();
    for (const s of layout.slots) {
      const placed = PLACED.includes(s.state);
      if (!placed && !tileTool) continue;
      m.set(s.key, fillGeometry(placed ? slotLoops(s, A) : [{ outer: hexPts(A, s.center), holes: [] }], (p) => map(p)));
    }
    return m;
  }, [layout, A, map, tileTool]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);

  const mats = useMemo(() => {
    const m = (color: string, opacity: number) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide });
    const o = ghost ? 0.05 : 0.16;
    return { full: m(TILE.full, o), partial: m(TILE.partial, o * 1.4), whole: m(TILE.whole, o * 1.4), sel: m(COLORS.selected, 0.4), hover: m(COLORS.selected, 0.22) };
  }, [ghost]);

  const lines = useMemo(() => {
    const placed = layout.slots.filter((s) => PLACED.includes(s.state));
    const of = (st: string) => placed.filter((s) => s.state === st).flatMap((s) => slotLoops(s, A).flatMap((l) => [l.outer, ...l.holes]));
    const empty = layout.slots.filter((s) => s.state === 'off' || s.state === 'dropped' || (tileTool && s.state === 'out')).map((s) => hexPts(A - 1, s.center));
    const lift = (p: Vec2) => map(p, 0.3);
    return { full: segs(of('full'), lift), partial: segs(of('partial'), lift), whole: segs(of('whole'), lift), empty: segs(empty, lift) };
  }, [layout, A, map, tileTool]);

  const click = (s: HwSlot) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const st = useHw.getState();
    if (st.tool === 'tile') st.toggle(s.key, s.natural);
    else st.select({ kind: 'tile', id: s.key });
  };

  const sel = selection?.kind === 'tile' ? layout.bySlot.get(selection.id) : undefined;
  return (
    <>
      {[...geos.entries()].map(([key, g]) => {
        const s = layout.bySlot.get(key)!;
        const placed = PLACED.includes(s.state);
        const mat = sel?.key === key ? mats.sel : hover === key ? mats.hover : placed ? mats[s.state as 'full' | 'partial' | 'whole'] : pickMat;
        const t = unitOf.get(key);
        const showTag = t && (showLabels || sel?.key === key || hover === key);
        return (
          <group key={key}>
            <mesh
              geometry={g}
              material={mat}
              raycast={rayFor(passive || (!placed && !tileTool))}
              onClick={click(s)}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(key);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHover((h) => (h === key ? null : h));
                document.body.style.cursor = '';
              }}
            />
            {showTag && (
              <Html position={map(s.center, 3)} center pointerEvents="none" zIndexRange={[20, 0]} className={`wb-tag${sel?.key === key ? ' on' : ''}`}>
                {t.unit}
                {t.piece !== 'full' ? ` · ${t.piece}` : ''}
              </Html>
            )}
            {!t && tileTool && hover === key && (
              <Html position={map(s.center, 3)} center pointerEvents="none" zIndexRange={[20, 0]} className="wb-tag">
                {s.state === 'off' ? 'switched off · click to restore' : s.state === 'dropped' ? 'sliver · click for a whole tile' : 'click for a whole tile'}
              </Html>
            )}
          </group>
        );
      })}
      {lines.full.length > 0 && <Line points={lines.full} segments color={COLORS.node} lineWidth={1.2} transparent opacity={ghost ? 0.5 : 0.9} />}
      {lines.partial.length > 0 && <Line points={lines.partial} segments color={TILE.partial} lineWidth={1.4} transparent opacity={ghost ? 0.6 : 1} />}
      {lines.whole.length > 0 && <Line points={lines.whole} segments color={TILE.whole} lineWidth={1.4} />}
      {lines.empty.length > 0 && <Line points={lines.empty} segments color={TILE.empty} lineWidth={1} dashed dashSize={6} gapSize={5} />}
      {sel && <Line points={slotLoops(sel, layout.dims.A).flatMap((l) => loopPts(l.outer, (p) => map(p, 0.6)))} color={COLORS.selected} lineWidth={2.6} />}
    </>
  );
}

/* ---------------- Outline handles ---------------- */

function Outline({ design, live, plane, radius, ghost, passive }: { design: HwDesign; live: HwDesign; plane: ReturnType<typeof liftPlane>; radius: number; ghost: boolean; passive: boolean }) {
  const tool = useHw((s) => s.tool);
  const selection = useHw((s) => s.selection);
  const at = (p: Vec2) => toWorld(fromPlane(p, plane));
  return (
    <>
      {live.areas.map((a) => {
        const sel = selection?.kind === 'area' && selection.id === a.id;
        const stored = design.areas.find((x) => x.id === a.id) ?? a;
        const loops: [number, Vec2[], Vec2[]][] = [[-1, a.outer, stored.outer], ...a.holes.map((h, k) => [k, h, stored.holes[k] ?? h] as [number, Vec2[], Vec2[]])];
        return (
          <group key={a.id}>
            {loops.map(([loop, pts]) => (
              <Line key={loop} points={loopPts(pts, at)} color={sel ? COLORS.sketchSel : COLORS.sketch} lineWidth={sel ? 2.4 : 1.6} />
            ))}
            {tool === 'select' &&
              loops.map(([loop, , pts]) =>
                // Dense loops (drawn circles, curves) only get handles once their area is selected.
                pts.length <= 24 || sel
                  ? pts.map((p, idx) => (
                      <Handle
                        key={`${loop}:${idx}`}
                        id={vertexId(a.id, loop, idx)}
                        pos={fromPlane(p, plane)}
                        radius={radius}
                        color={COLORS.sketch}
                        selected={sel}
                        ghost={ghost}
                        passive={passive}
                        plane={plane}
                        onMove={(pos) => useHw.getState().moveVertex(a.id, loop, idx, toPlane(pos, plane))}
                        onClick={() => useHw.getState().select({ kind: 'area', id: a.id })}
                      />
                    ))
                  : null,
              )}
          </group>
        );
      })}
    </>
  );
}

/* ---------------- Data path and cells ---------------- */

function Chain({ layout, map }: { layout: HwLayout; map: (p: Vec2, dz?: number) => Vector3 }) {
  const n = Math.max(1, layout.tiles.length - 1);
  return (
    <>
      {layout.tiles.slice(1).map((t, k) => {
        const a = map(layout.tiles[k].slot.center, 2.5);
        const b = map(t.slot.center, 2.5);
        if (!t.linked) return <Line key={t.unit} points={[a, b]} color={COLORS.bad} lineWidth={1.8} dashed dashSize={8} gapSize={6} />;
        const color = COLORS.chainA.clone().lerp(COLORS.chainB, k / n);
        const tip = a.clone().lerp(b, 0.6);
        return (
          <group key={t.unit}>
            <Line points={[a, b]} color={color} lineWidth={2.4} />
            <mesh position={tip} quaternion={quatAlong(a, b)}>
              <coneGeometry args={[5, 14, 10]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      {layout.tiles[0] && (
        <Html position={map(layout.tiles[0].slot.center, 8)} center pointerEvents="none" zIndexRange={[20, 0]} className="wb-tag ctl">
          DATA IN · {layout.tiles[0].unit}
        </Html>
      )}
    </>
  );
}

const quatAlong = (a: Vector3, b: Vector3) => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());

function Cells({ layout, map }: { layout: HwLayout; map: (p: Vec2, dz?: number) => Vector3 }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    for (const t of layout.tiles) for (const c of t.cellsLat) {
      const v = map(c, 0.8);
      pos.push(v.x, v.y, v.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, [layout, map]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo} raycast={() => null}>
      <pointsMaterial color={COLORS.sketch} size={layout.dims.pitch * 0.4} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

/* ---------------- The system scene ---------------- */

/** Tile slots, the outline with draggable vertices, cells and the data path, in the shared canvas. */
export function HwScene({ ghost, hideStale, passive }: SceneProps) {
  const design = useHw((s) => s.design);
  const drag = useHw((s) => s.drag);
  const showChain = useHw((s) => s.showChain);
  const params = useHwParams();
  const base = useHwLayout();
  const d = base.dims;
  const n = useMemo(() => planeNormal(design.plane), [design.plane]);
  const front = d.zBack + d.Hs + 1.5;
  const plane = useMemo(() => liftPlane(design.plane, n, front), [design.plane, n, front]);
  // While an outline vertex drags, re-plan from the live outline so tiles re-trim under the cursor.
  const live = useMemo(() => {
    const v = drag ? parseVertexId(drag.id) : null;
    return drag && v ? withVertex(design, v.area, v.loop, v.idx, toPlane(drag.pos, plane)) : design;
  }, [design, drag, plane]);
  const layout = useMemo(() => (live === design ? base : layoutWall(live, params)), [live, design, base, params]);
  const map = useMemo(() => (p: Vec2, dz = 0) => toWorld(add(fromPlane(fromLattice(live.lattice, p), live.plane), scale(n, front + dz))), [live.lattice, live.plane, n, front]);
  const g = ghost && !hideStale;
  return (
    <>
      <Slots layout={layout} map={map} ghost={g} passive={passive} />
      <Outline design={design} live={live} plane={plane} radius={Math.max(5, d.pitch * 0.2)} ghost={g} passive={passive} />
      {!g && <Cells layout={layout} map={map} />}
      {showChain && <Chain layout={layout} map={map} />}
    </>
  );
}

/** Pixel glow size follows the cell pitch. */
export function useHwPixelSize(): number {
  return useHwLayout().dims.pitch * 11;
}
