import { Color, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../../types';

/* The bench works in the slicer's Z-up millimetres; three.js is Y-up. */
export const toWorld = (p: Vec3) => new Vector3(p[0], p[2], -p[1]);
export const toLocal = (v: Vector3): Vec3 => [v.x, -v.z, v.y];

export const UP = new Vector3(0, 1, 0);

export const BENCH_COLORS = {
  node: '#8c93b8',
  controller: '#ffb347',
  selected: '#2fd4ff',
  pending: '#8b5cf6',
  bad: '#ff5d73',
  strut: '#d9d5cb',
  dark: '#4a4a58',
  chainA: new Color('#2fd4ff'),
  chainB: new Color('#c56bff'),
  darkRun: '#ffb347',
  sketch: '#ffd166',
  sketchSel: '#2fd4ff',
};

/** Cylinder between two Z-up points, as position + quaternion + length in world space. */
export function between(a: Vec3, b: Vec3) {
  const A = toWorld(a);
  const B = toWorld(b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const length = dir.length();
  const q = new Quaternion().setFromUnitVectors(UP, dir.normalize());
  return { mid, q, length };
}

export function snapTo(v: number, step: number) {
  return step > 0 ? Math.round(v / step) * step : Math.round(v * 10) / 10;
}

/** An invisible, raycastable material for fat pick targets. */
export const pickMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
