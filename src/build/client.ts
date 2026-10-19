import type { Params } from '../types';
import type { BuildResult } from './runBuild';
import type { BuildRequest } from './worker';

type Reply = { id: number; ok: true; result: BuildResult } | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (r: BuildResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.result);
      else w.reject(new Error(e.data.error));
    };
  }
  return worker;
}

/** Builds run off the main thread so sliders stay smooth while booleans grind. */
export function requestBuild(fixtureId: string, params: Params): Promise<BuildResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, fixtureId, params } satisfies BuildRequest);
  });
}
