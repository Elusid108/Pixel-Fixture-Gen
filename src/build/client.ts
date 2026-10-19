import type { Params } from '../types';
import type { BuildResult } from './runBuild';
import type { BuildRequest } from './worker';

type Reply = { id: number; ok: true; result: BuildResult } | { id: number; ok: false; error: string };

interface Job {
  fixtureId: string;
  params: Params;
  resolve: (r: BuildResult) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, Job>();
/** One build runs at a time; only the newest request waits behind it. */
let busy = false;
let pending: Job | null = null;

/** Rejection reason for a request replaced by a newer one before it started. */
export const SUPERSEDED = 'superseded';

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      busy = false;
      if (e.data.ok) job.resolve(e.data.result);
      else job.reject(new Error(e.data.error));
      pump();
    };
  }
  return worker;
}

function pump() {
  if (busy || !pending) return;
  const job = pending;
  pending = null;
  busy = true;
  const id = ++seq;
  waiting.set(id, job);
  getWorker().postMessage({ id, fixtureId: job.fixtureId, params: job.params } satisfies BuildRequest);
}

/**
 * Builds run off the main thread so sliders stay smooth while booleans grind. Rapid edits
 * (dragging a slider, placing hubs) don't pile up: a request that hasn't started yet is
 * replaced by the next one and rejected with SUPERSEDED.
 */
export function requestBuild(fixtureId: string, params: Params): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    pending?.reject(new Error(SUPERSEDED));
    pending = { fixtureId, params, resolve, reject };
    pump();
  });
}
