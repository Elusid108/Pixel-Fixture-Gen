import { resolveParams } from '../../fixtures/util';
import type { FixtureDef, Params, Vec3 } from '../../types';
import { analyze, pixelSlots, type Analysis, type StrutInfo } from './analyze';
import { planChain, type Chain } from './dataPath';
import { add, norm, scale, sub, type SnDesign } from './model';
import { snDims, SN_PARAMS, type SnDims } from './params';

export interface SnPlan {
  dims: SnDims;
  an: Analysis;
  chain: Chain;
}

/** Defaults for the system params, in the shape `resolveParams` produces. */
export function snParams(given: Params = {}): Params {
  return resolveParams({ params: SN_PARAMS } as FixtureDef, given);
}

/** Analysis plus data path: everything the bench, the inspector and the build share. */
export function planDesign(design: SnDesign, params: Params): SnPlan {
  const dims = snDims(params);
  const an = analyze(design, dims);
  const positions = new Map(design.nodes.map((n) => [n.id, n.pos]));
  const controller = an.hubs.find((h) => h.controller)?.id ?? design.controller;
  const chain = planChain(
    an.struts.map((s) => ({ id: s.id, a: s.a, b: s.b, dark: s.dark || s.px === 0, flip: s.flip, length: s.length })),
    controller,
    design.order,
    positions,
  );
  return { dims, an, chain };
}

/** Pixel positions along one strut run, from its DIN end, on the tube surface the strip faces. */
export function strutPixels(dims: SnDims, s: StrutInfo, from: Vec3, to: Vec3, fromIsA: boolean): Vec3[] {
  const u = norm(sub(to, from));
  const start = (fromIsA ? s.offA : s.offB) + dims.insert;
  return pixelSlots(dims, s.litLength).map((t) => add(add(from, scale(u, start + t)), scale(s.face, dims.tubeR)));
}
