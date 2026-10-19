import { Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, Path, Shape, Vector2, Vector3 } from 'three';
import { add, dist, scale, sub } from '../../geom/vec';
import { arcPath, circleRegion, finishPolyline, freehand, polygonRegion, rectRegion } from '../../sketch/draw';
import { arc3, circlePts, fromPlane, planeNormal, regularPolygon, toPlane } from '../../sketch/geom';
import { activePlane, ids, useSketch } from '../../sketch/store';
import type { SketchPath, SketchPlane, SketchRegion, Vec2 } from '../../sketch/types';
import type { Vec3 } from '../../types';
import { useBench } from '../../workbench/store';
import { BENCH_COLORS, snapTo, toLocal } from '../bench/util';

/**
 * The drawing engine's canvas layer. Works in Z-up mm inside a rotated group, like the parts.
 * Draws every entity, the active plane's grid, the snapped cursor and the rubber band, and turns
 * clicks into entities through the pure helpers in src/sketch/draw.ts.
 */

const v3 = (p: Vec3) => new Vector3(p[0], p[1], p[2]);

/** Last snapped cursor position, for typed-length entry from the panel. */
export const sketchCursor: { current: Vec3 | null } = { current: null };

export function planeMatrix(pl: SketchPlane): Matrix4 {
  const n = planeNormal(pl);
  return new Matrix4().makeBasis(v3(pl.u), v3(pl.v), v3(n)).setPosition(v3(pl.origin));
}

type SnapKind = 'vertex' | 'angle' | 'grid';

/** Candidate points for vertex snapping: endpoints, vertices and segment midpoints. */
function useSnapTargets(): Vec3[] {
  const sketch = useSketch((s) => s.sketch);
  return useMemo(() => {
    const out: Vec3[] = [];
    const addLoop = (pts: Vec3[], closed: boolean) => {
      out.push(...pts);
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) out.push(scale(add(pts[i], pts[(i + 1) % pts.length]), 0.5));
    };
    for (const p of sketch.paths) addLoop(p.pts, p.closed);
    for (const r of sketch.regions) for (const loop of [r.outer, ...r.holes]) addLoop(loop.map((q) => fromPlane(q, r.plane)), true);
    return out;
  }, [sketch]);
}

function GroupAt({ matrix, children }: { matrix: Matrix4; children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.matrix.copy(matrix);
    ref.current.matrixWorldNeedsUpdate = true;
  }, [matrix]);
  return (
    <group ref={ref} matrixAutoUpdate={false}>
      {children}
    </group>
  );
}

/* ---------------- Entities ---------------- */

function RegionFill({ r, selected, onPick }: { r: SketchRegion; selected: boolean; onPick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const geom = useMemo(() => {
    const shape = new Shape(r.outer.map(([x, y]) => new Vector2(x, y)));
    for (const h of r.holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))));
    return shape;
  }, [r]);
  const matrix = useMemo(() => planeMatrix(r.plane), [r.plane]);
  const color = selected ? BENCH_COLORS.sketchSel : BENCH_COLORS.sketch;
  return (
    <GroupAt matrix={matrix}>
      <mesh onClick={onPick}>
        <shapeGeometry args={[geom]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.22 : 0.1} side={DoubleSide} depthWrite={false} />
      </mesh>
      {[r.outer, ...r.holes].map((loop, i) => (
        <Line key={i} points={[...loop, loop[0]].map(([x, y]) => new Vector3(x, y, 0.2))} color={color} lineWidth={selected ? 3 : 2} />
      ))}
    </GroupAt>
  );
}

function Entities({ pickable }: { pickable: boolean }) {
  const sketch = useSketch((s) => s.sketch);
  const selected = useSketch((s) => s.selected);
  const pick = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (!pickable || e.delta > 4) return;
    e.stopPropagation();
    useSketch.getState().select(id, e.shiftKey);
  };
  return (
    <>
      {sketch.regions.map((r) => (
        <RegionFill key={r.id} r={r} selected={selected.includes(r.id)} onPick={pickable ? pick(r.id) : undefined} />
      ))}
      {sketch.paths.map((p) => {
        const sel = selected.includes(p.id);
        const pts = (p.closed ? [...p.pts, p.pts[0]] : p.pts).map(v3);
        return (
          <Line
            key={p.id}
            points={pts}
            color={sel ? BENCH_COLORS.sketchSel : p.source === '3d' ? '#ff9f6b' : BENCH_COLORS.sketch}
            lineWidth={sel ? 4 : 2.5}
            onClick={pickable ? pick(p.id) : undefined}
          />
        );
      })}
    </>
  );
}

/* ---------------- Plane grid ---------------- */

function PlaneGrid({ plane, step }: { plane: SketchPlane; step: number }) {
  const geom = useMemo(() => {
    const s = Math.max(5, step || 10);
    const half = Math.ceil(600 / s) * s;
    const pos: number[] = [];
    for (let x = -half; x <= half + 1e-6; x += s) pos.push(x, -half, 0, x, half, 0, -half, x, 0, half, x, 0);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, [step]);
  const matrix = useMemo(() => planeMatrix(plane), [plane]);
  return (
    <GroupAt matrix={matrix}>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color="#5b4a1c" transparent opacity={0.55} />
      </lineSegments>
      <Line
        points={[
          [-600, 0, 0],
          [600, 0, 0],
        ]}
        color="#b98a2a"
        lineWidth={1}
      />
      <Line
        points={[
          [0, -600, 0],
          [0, 600, 0],
        ]}
        color="#b98a2a"
        lineWidth={1}
      />
    </GroupAt>
  );
}

/* ---------------- Drawing ---------------- */

const DRAW_TOOLS = new Set(['draw:line', 'draw:rect', 'draw:circle', 'draw:polygon', 'draw:arc', 'draw:free']);

function rubberBand(tool: string, pts: Vec3[], cursor: Vec3 | null, plane: SketchPlane, sides: number): Vec3[] {
  if (!pts.length) return [];
  // No hover on touch: still show the points placed so far as a line.
  if (!cursor) return tool === 'draw:line' || tool === 'draw:arc' ? pts : [];
  const P = (p: Vec3) => toPlane(p, plane);
  const L = (q: Vec2[], close = true) => (close ? [...q, q[0]] : q).map((p) => fromPlane(p, plane));
  const c = P(pts[0]);
  const e = P(cursor);
  switch (tool) {
    case 'draw:line':
    case 'draw:free':
      return [...pts, cursor];
    case 'draw:rect':
      return L([c, [e[0], c[1]], e, [c[0], e[1]]]);
    case 'draw:circle':
      return L(circlePts(c, Math.hypot(e[0] - c[0], e[1] - c[1])));
    case 'draw:polygon':
      return L(regularPolygon(c, Math.hypot(e[0] - c[0], e[1] - c[1]), sides, (Math.atan2(e[1] - c[1], e[0] - c[0]) * 180) / Math.PI));
    case 'draw:arc':
      return pts.length < 2 ? [pts[0], cursor] : L(arc3(c, e, P(pts[1])), false);
    default:
      return [];
  }
}

export function SketchLayer() {
  const tool = useBench((s) => s.tool);
  const snap = useBench((s) => s.snap);
  const show = useSketch((s) => s.show);
  const draft = useSketch((s) => s.draft);
  const planeKind = useSketch((s) => s.planeKind);
  const offset = useSketch((s) => s.offset);
  const custom = useSketch((s) => s.custom);
  const angleSnap = useSketch((s) => s.angleSnap);
  const vertexSnap = useSketch((s) => s.vertexSnap);
  const sides = useSketch((s) => s.sides);
  const plane = useMemo(() => activePlane({ planeKind, offset, custom }), [planeKind, offset, custom]);
  const targets = useSnapTargets();
  const [cursor, setCursor] = useState<{ p: Vec3; kind: SnapKind } | null>(null);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const drawing = DRAW_TOOLS.has(tool);
  const stroke = useRef<Vec3[] | null>(null);
  const planeMat = useMemo(() => planeMatrix(plane), [plane]);

  if (!show && !drawing) return null;

  /** Ray hit → point on the active plane → vertex, angle or grid snap. */
  const snapAt = (e: ThreeEvent<PointerEvent | MouseEvent>): { p: Vec3; kind: SnapKind } => {
    const hit = toLocal(e.point);
    const q = toPlane(hit, plane);
    const raw = fromPlane(q, plane);
    const tol = Math.max(3, (snap || 10) * 0.6);
    const drafted = draft?.pts ?? [];
    if (vertexSnap) {
      let best: Vec3 | null = null;
      let bd = tol;
      for (const t of [...targets, ...drafted]) {
        const d = dist(t, raw);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best) return { p: best, kind: 'vertex' };
    }
    const last = drafted[drafted.length - 1];
    if (angleSnap && last && (tool === 'draw:line' || tool === 'draw:arc')) {
      const l = toPlane(last, plane);
      const dx = q[0] - l[0];
      const dy = q[1] - l[1];
      const len = snapTo(Math.hypot(dx, dy), snap);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
      // Stay at the last point's height above the plane, so 3D chains keep their offset.
      const lift = sub(last, fromPlane(l, plane));
      return { p: add(fromPlane([l[0] + len * Math.cos(ang), l[1] + len * Math.sin(ang)], plane), lift), kind: 'angle' };
    }
    return { p: fromPlane([snapTo(q[0], snap), snapTo(q[1], snap)], plane), kind: 'grid' };
  };

  const commitOut = (out: { paths: SketchPath[]; regions: SketchRegion[] }) => {
    if (out.paths.length || out.regions.length) useSketch.getState().add(out.paths, out.regions);
    useSketch.getState().setDraft(null);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || tool === 'draw:free') return;
    e.stopPropagation();
    const st = useSketch.getState();
    const at = snapAt(e).p;
    const d = st.draft && st.draft.tool === tool ? st.draft : { tool, pts: [], planes: [] };
    const pts = [...d.pts, at];
    const id = ids(st.sketch);
    const first = d.planes[0] ?? plane;
    switch (tool) {
      case 'draw:line': {
        // Clicking the first point again closes the shape.
        if (d.pts.length >= 3 && dist(at, d.pts[0]) < 0.05) return commitOut(finishPolyline(d.pts, first, true, id));
        st.setDraft({ tool, pts, planes: [...d.planes, plane] });
        return;
      }
      case 'draw:rect':
        if (pts.length < 2) return st.setDraft({ tool, pts, planes: [plane] });
        return commitOut(rectRegion(pts[0], pts[1], first, id.region));
      case 'draw:circle':
        if (pts.length < 2) return st.setDraft({ tool, pts, planes: [plane] });
        return commitOut(circleRegion(pts[0], pts[1], first, id.region));
      case 'draw:polygon':
        if (pts.length < 2) return st.setDraft({ tool, pts, planes: [plane] });
        return commitOut(polygonRegion(pts[0], pts[1], sides, first, id.region));
      case 'draw:arc':
        if (pts.length < 3) return st.setDraft({ tool, pts, planes: [...d.planes, plane] });
        return commitOut(arcPath(pts[0], pts[1], pts[2], first, id.path));
    }
  };

  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    if (tool !== 'draw:line') return;
    e.stopPropagation();
    finishDraft(false);
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'draw:free' || e.button !== 0) return;
    e.stopPropagation();
    stroke.current = [snapAt(e).p];
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    if (controls) controls.enabled = false;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const c = snapAt(e);
    setCursor(c);
    sketchCursor.current = c.p;
    if (stroke.current) {
      // Freehand records the raw plane point, not the grid snap.
      const raw = fromPlane(toPlane(toLocal(e.point), plane), plane);
      const last = stroke.current[stroke.current.length - 1];
      if (dist(raw, last) > 1.5) {
        stroke.current.push(raw);
        useSketch.getState().setDraft({ tool, pts: [...stroke.current], planes: [plane] });
      }
    }
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!stroke.current) return;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
    const pts = stroke.current;
    stroke.current = null;
    commitOut(freehand(pts, plane, ids(useSketch.getState().sketch)));
  };

  const band = draft ? rubberBand(draft.tool, draft.pts, cursor?.p ?? null, draft.planes[0] ?? plane, sides) : [];
  const n = planeNormal(plane);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {show && <Entities pickable={tool === 'draw:select'} />}
      {drawing && (
        <>
          <PlaneGrid plane={plane} step={snap} />
          <GroupAt matrix={planeMat}>
            <mesh onClick={onClick} onDoubleClick={onDouble} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerOut={() => setCursor(null)}>
              <planeGeometry args={[4000, 4000]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
            </mesh>
          </GroupAt>
          {cursor && (
            <mesh position={v3(add(cursor.p, scale(n, 0.5)))}>
              <sphereGeometry args={[cursor.kind === 'vertex' ? 4 : 2.6, 14, 10]} />
              <meshBasicMaterial color={cursor.kind === 'vertex' ? BENCH_COLORS.sketchSel : cursor.kind === 'angle' ? '#c56bff' : BENCH_COLORS.sketch} toneMapped={false} />
            </mesh>
          )}
          {band.length >= 2 && <Line points={band.map(v3)} color={BENCH_COLORS.sketchSel} lineWidth={2} dashed dashSize={6} gapSize={4} />}
          {draft?.pts.map((p, i) => (
            <mesh key={i} position={v3(p)}>
              <sphereGeometry args={[2.2, 10, 8]} />
              <meshBasicMaterial color={BENCH_COLORS.sketchSel} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

/** Finish the polyline in progress (Enter / double-click). */
export function finishDraft(closed: boolean) {
  const st = useSketch.getState();
  const d = st.draft;
  if (!d || d.tool !== 'draw:line') return;
  const out = finishPolyline(d.pts, d.planes[0] ?? activePlane(st), closed, ids(st.sketch));
  if (out.paths.length || out.regions.length) st.add(out.paths, out.regions);
  st.setDraft(null);
}
