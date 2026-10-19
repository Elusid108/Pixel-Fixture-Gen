import { Matrix4 } from 'three';
import type { Manifold } from 'manifold-3d';
import type { Geo } from '../geom/geo';
import { mul, T } from '../geom/mat';
import type { FixtureDef, Mat4, ParamSpec, Params } from '../types';

export const num = (p: Params, k: string): number => Number(p[k]);
export const str = (p: Params, k: string): string => String(p[k]);
export const bool = (p: Params, k: string): boolean => p[k] === true || p[k] === 'true';

/** Fill in defaults, clamp numbers into range, drop unknown keys. */
export function resolveParams(def: FixtureDef, given: Params = {}): Params {
  const out: Params = {};
  for (const s of def.params) out[s.key] = coerce(s, given[s.key]);
  return out;
}

function coerce(s: ParamSpec, v: Params[string] | undefined): Params[string] {
  if (v === undefined) return s.default;
  if (s.type === 'number') {
    let n = Number(v);
    if (!Number.isFinite(n)) return s.default;
    if (s.min !== undefined) n = Math.max(s.min, n);
    if (s.max !== undefined) n = Math.min(s.max, n);
    return n;
  }
  if (s.type === 'boolean') return v === true || v === 'true';
  const allowed = s.type === 'pixel' ? s.pixels : s.options?.map((o) => o.value);
  return allowed && !allowed.includes(String(v)) ? s.default : String(v);
}

/**
 * Model a part where it sits in the fixture, then lay it on the bed with `printRot`.
 * Returns the print-oriented solid (centred in XY, resting on z=0) and the instance
 * transform that puts the printed part back where it was modelled.
 */
export function layFlat(g: Geo, assembled: Manifold, printRot: Mat4, placeAt: Mat4 = T(0, 0, 0)) {
  const rotated = g.place(assembled, printRot);
  const b = rotated.boundingBox();
  const norm = T(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
  const solid = g.place(rotated, norm);
  const toBed = mul(norm, printRot);
  const back = new Matrix4().fromArray(toBed).invert().elements.slice();
  return { solid, instance: mul(placeAt, back) };
}
