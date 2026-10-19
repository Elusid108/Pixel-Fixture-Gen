import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import type { Bounds, BuildCtx, MeshData } from '../types';

let pending: Promise<ManifoldToplevel> | null = null;

/** Loads the manifold WASM once. Browsers pass `locateFile` (Vite `?url` import); Node finds it itself. */
export function loadManifold(locateFile?: () => string): Promise<ManifoldToplevel> {
  pending ??= Module(locateFile ? { locateFile } : undefined).then((wasm) => {
    wasm.setup();
    // ~60 segments on a full circle, never shorter than 0.6 mm: smooth enough for printed curves.
    wasm.setMinCircularAngle(6);
    wasm.setMinCircularEdgeLength(0.6);
    return wasm;
  });
  return pending;
}

/*
 * Manifold objects live in WASM memory and are never garbage collected. Rather than thread
 * `.delete()` through every fixture, every constructor/method result made inside `inArena`
 * is recorded and freed when the build finishes, the same approach manifoldCAD takes.
 */
type Deletable = { delete(): void; isDeleted?(): boolean };
let arena: Deletable[] | null = null;
let patched = false;

function track<T>(r: T): T {
  if (!arena) return r;
  if (Array.isArray(r)) r.forEach(track);
  else if (r && typeof (r as unknown as Deletable).delete === 'function') arena.push(r as unknown as Deletable);
  return r;
}

function wrapAll(target: Record<string, unknown>, skip: string[]) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (skip.includes(name)) continue;
    const desc = Object.getOwnPropertyDescriptor(target, name);
    if (!desc || typeof desc.value !== 'function' || !desc.writable) continue;
    const orig = desc.value as (...a: unknown[]) => unknown;
    target[name] = function (this: unknown, ...a: unknown[]) {
      return track(orig.apply(this, a));
    };
  }
}

function patchClasses(wasm: ManifoldToplevel) {
  if (patched) return;
  patched = true;
  for (const cls of [wasm.Manifold, wasm.CrossSection] as unknown as Record<string, unknown>[]) {
    wrapAll(cls, ['length', 'name', 'prototype']);
    wrapAll((cls as { prototype: Record<string, unknown> }).prototype, ['constructor', 'delete', 'isDeleted']);
  }
}

export function inArena<T>(wasm: ManifoldToplevel, fn: () => T): T {
  patchClasses(wasm);
  const outer = arena;
  arena = [];
  try {
    return fn();
  } finally {
    for (const o of arena) {
      try {
        if (!o.isDeleted?.()) o.delete();
      } catch {
        /* already freed */
      }
    }
    arena = outer;
  }
}

export function makeCtx(wasm: ManifoldToplevel): BuildCtx {
  return { wasm, Manifold: wasm.Manifold, CrossSection: wasm.CrossSection };
}

export function toMeshData(solid: Manifold): MeshData {
  const mesh = solid.getMesh();
  const stride = mesh.numProp;
  const nVert = mesh.vertProperties.length / stride;
  const positions = new Float32Array(nVert * 3);
  for (let i = 0; i < nVert; i++) {
    positions[i * 3] = mesh.vertProperties[i * stride];
    positions[i * 3 + 1] = mesh.vertProperties[i * stride + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * stride + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

export function boundsOf(solid: Manifold): Bounds {
  const b = solid.boundingBox();
  return { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] };
}
