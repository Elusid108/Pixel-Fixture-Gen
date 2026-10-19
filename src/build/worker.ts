/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadManifold } from '../geom/manifold';
import type { Params } from '../types';
import { runBuild } from './runBuild';

export interface BuildRequest {
  id: number;
  fixtureId: string;
  params: Params;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { id, fixtureId, params } = e.data;
  try {
    const wasm = await loadManifold(() => wasmUrl);
    const result = runBuild(wasm, fixtureId, params);
    const transfer = result.parts.flatMap((p) => [p.mesh.positions.buffer, p.mesh.indices.buffer]);
    ctx.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
