import { Matrix4, Vector3 } from 'three';
import type { Mat4, Vec3 } from '../types';

const D2R = Math.PI / 180;

export const I = (): Mat4 => new Matrix4().elements.slice();
export const T = (x: number, y: number, z: number): Mat4 => new Matrix4().makeTranslation(x, y, z).elements.slice();
export const Rx = (deg: number): Mat4 => new Matrix4().makeRotationX(deg * D2R).elements.slice();
export const Ry = (deg: number): Mat4 => new Matrix4().makeRotationY(deg * D2R).elements.slice();
export const Rz = (deg: number): Mat4 => new Matrix4().makeRotationZ(deg * D2R).elements.slice();

/** mul(A, B, C) = A·B·C — the rightmost transform applies first. */
export function mul(...ms: Mat4[]): Mat4 {
  const out = new Matrix4();
  for (const m of ms) out.multiply(new Matrix4().fromArray(m));
  return out.elements.slice();
}

export function apply(m: Mat4, p: Vec3): Vec3 {
  const v = new Vector3(...p).applyMatrix4(new Matrix4().fromArray(m));
  return [v.x, v.y, v.z];
}

export function applyDir(m: Mat4, d: Vec3): Vec3 {
  const v = new Vector3(...d).transformDirection(new Matrix4().fromArray(m));
  return [v.x, v.y, v.z];
}
