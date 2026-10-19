import type { CrossSection, Manifold } from 'manifold-3d';
import type { Geo, P2 } from '../../geom/geo';
import { distToPolygon, pointInPolygon } from '../../sketch/geom';
import type { BuildCtx, Vec3 } from '../../types';
import { sampleImage, type GrayImage } from '../image';

/**
 * Shared S-series helpers: contours from images (marching squares), heightfield solids,
 * point tests against cross-sections and node placement. Pure geometry, no fixture policy.
 */

/** A scalar field sampled on a regular grid, row j along +y, column i along +x. */
export interface Field {
  nx: number;
  ny: number;
  v: Float32Array;
}

/** Centre-crop an image to a square and sample it, so it fills a square area without stretching. */
export function squareSample(img: GrayImage, u: number, v: number): number {
  const k = img.w / img.h;
  return k > 1 ? sampleImage(img, 0.5 + (u - 0.5) / k, v) : sampleImage(img, u, 0.5 + (v - 0.5) * k);
}

/** Resample an image (centre-cropped square) onto a grid in plane coords (y up), so the image top lands at +y. */
export function fieldFromImage(img: GrayImage, nx: number, ny: number): Field {
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = squareSample(img, i / (nx - 1), 1 - j / (ny - 1));
  }
  return { nx, ny, v };
}

/** Separable box blur, `passes` times. Softens pixel stairs before contouring. */
export function blurField(fd: Field, r: number, passes = 2): Field {
  const { nx, ny } = fd;
  let a = Float32Array.from(fd.v);
  let b = new Float32Array(nx * ny);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const ii = Math.min(nx - 1, Math.max(0, i + k));
          s += a[j * nx + ii];
          n++;
        }
        b[j * nx + i] = s / n;
      }
    }
    [a, b] = [b, a];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const jj = Math.min(ny - 1, Math.max(0, j + k));
          s += a[jj * nx + i];
          n++;
        }
        b[j * nx + i] = s / n;
      }
    }
    [a, b] = [b, a];
  }
  return { nx, ny, v: a };
}

/**
 * Marching squares: closed loops where the field crosses `level`, in mm. The grid spans
 * [x0, x0 + w] × [y0, y0 + h]. Values outside the grid count as below the level, so every loop
 * closes along the border. Saddles resolve by the cell centre. Loops are unoriented; fill them
 * with the EvenOdd rule.
 */
export function isoLoops(fd: Field, level: number, x0: number, y0: number, w: number, h: number): P2[][] {
  const { nx, ny, v } = fd;
  const dx = w / (nx - 1);
  const dy = h / (ny - 1);
  const OUT = level - 1e6;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? OUT : v[j * nx + i]);
  const posX = (i: number) => x0 + Math.min(nx - 1, Math.max(0, i)) * dx;
  const posY = (j: number) => y0 + Math.min(ny - 1, Math.max(0, j)) * dy;
  const pts = new Map<string, P2>();
  const segs: [string, string][] = [];
  const lerp = (va: number, vb: number) => Math.min(0.999, Math.max(0.001, (level - va) / (vb - va)));
  const edgeH = (i: number, j: number): string => {
    const k = `h${i},${j}`;
    if (!pts.has(k)) {
      const t = lerp(at(i, j), at(i + 1, j));
      pts.set(k, [posX(i) + (posX(i + 1) - posX(i)) * t, posY(j)]);
    }
    return k;
  };
  const edgeV = (i: number, j: number): string => {
    const k = `v${i},${j}`;
    if (!pts.has(k)) {
      const t = lerp(at(i, j), at(i, j + 1));
      pts.set(k, [posX(i), posY(j) + (posY(j + 1) - posY(j)) * t]);
    }
    return k;
  };

  for (let j = -1; j < ny; j++) {
    for (let i = -1; i < nx; i++) {
      const a = at(i, j) >= level;
      const b = at(i + 1, j) >= level;
      const c = at(i + 1, j + 1) >= level;
      const d = at(i, j + 1) >= level;
      const cross: string[] = [];
      const B = a !== b ? edgeH(i, j) : '';
      const R = b !== c ? edgeV(i + 1, j) : '';
      const T = d !== c ? edgeH(i, j + 1) : '';
      const L = a !== d ? edgeV(i, j) : '';
      for (const e of [B, R, T, L]) if (e) cross.push(e);
      if (cross.length === 2) segs.push([cross[0], cross[1]]);
      else if (cross.length === 4) {
        const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= level;
        if (centre === a) segs.push([B, R], [T, L]);
        else segs.push([L, B], [R, T]);
      }
    }
  }

  const byKey = new Map<string, number[]>();
  segs.forEach(([p, q], s) => {
    for (const k of [p, q]) {
      const l = byKey.get(k);
      if (l) l.push(s);
      else byKey.set(k, [s]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops: P2[][] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const start = segs[s0][0];
    const loop: P2[] = [pts.get(start)!];
    let key = segs[s0][1];
    let guard = segs.length + 2;
    while (key !== start && guard-- > 0) {
      loop.push(pts.get(key)!);
      const next = (byKey.get(key) ?? []).find((t) => !used[t]);
      if (next === undefined) break;
      used[next] = 1;
      key = segs[next][0] === key ? segs[next][1] : segs[next][0];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** The region where the field is at or above `level`, as a cross-section (holes included). */
export function isoRegion(g: Geo, fd: Field, level: number, x0: number, y0: number, w: number, h: number): CrossSection {
  const loops = isoLoops(fd, level, x0, y0, w, h);
  if (!loops.length) return g.CS.ofPolygons([]);
  return g.CS.ofPolygons(loops, 'EvenOdd').simplify(0.02);
}

/** Drop pieces smaller than `minArea` mm² (crumbs from noisy art), keeping holes in the rest. */
export function dropCrumbs(g: Geo, cs: CrossSection, minArea: number): CrossSection {
  const keep = cs.decompose().filter((p) => p.area() >= minArea);
  return keep.length ? g.CS.compose(keep) : g.CS.ofPolygons([]);
}

/** Even-odd point test against a cross-section's loops. */
export function inside(loops: P2[][], p: P2): boolean {
  let k = 0;
  for (const l of loops) if (pointInPolygon(p, l)) k++;
  return k % 2 === 1;
}

export function edgeDist(loops: P2[][], p: P2): number {
  let d = Infinity;
  for (const l of loops) d = Math.min(d, distToPolygon(p, l));
  return d;
}

export const loopsOf = (cs: CrossSection): P2[][] => cs.toPolygons() as unknown as P2[][];

/**
 * Pick up to `n` points from `cands` by farthest-point sampling, seeded nearest the centroid,
 * keeping at least `minGap` between picks. Spreads nodes evenly over an irregular area.
 */
export function spreadPoints(cands: P2[], n: number, minGap: number): P2[] {
  if (!cands.length || n <= 0) return [];
  const cx = cands.reduce((s, p) => s + p[0], 0) / cands.length;
  const cy = cands.reduce((s, p) => s + p[1], 0) / cands.length;
  let first = 0;
  let best = Infinity;
  cands.forEach((p, i) => {
    const d = Math.hypot(p[0] - cx, p[1] - cy);
    if (d < best) {
      best = d;
      first = i;
    }
  });
  const picks: P2[] = [cands[first]];
  const dmin = cands.map((p) => Math.hypot(p[0] - cands[first][0], p[1] - cands[first][1]));
  while (picks.length < n) {
    let bi = -1;
    let bd = minGap;
    dmin.forEach((d, i) => {
      if (d >= bd) {
        bd = d;
        bi = i;
      }
    });
    if (bi < 0) break;
    const q = cands[bi];
    picks.push(q);
    cands.forEach((p, i) => (dmin[i] = Math.min(dmin[i], Math.hypot(p[0] - q[0], p[1] - q[1]))));
  }
  // A few Lloyd steps pull the picks off the edges toward the middle of their share of the area.
  for (let it = 0; it < 4 && picks.length > 1; it++) {
    const sum = picks.map(() => [0, 0, 0]);
    for (const p of cands) {
      let bi = 0;
      let bd = Infinity;
      picks.forEach((q, i) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      sum[bi][0] += p[0];
      sum[bi][1] += p[1];
      sum[bi][2]++;
    }
    const moved = picks.map((q, i) => {
      if (!sum[i][2]) return q;
      const c: P2 = [sum[i][0] / sum[i][2], sum[i][1] / sum[i][2]];
      // Snap to the nearest candidate so the point stays inside the allowed area.
      return cands.reduce((b, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(b[0] - c[0], b[1] - c[1]) ? p : b), cands[0]);
    });
    const ok = moved.every((p, i) => moved.every((q, j) => i === j || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minGap));
    if (!ok) break;
    picks.splice(0, picks.length, ...moved);
  }
  return picks;
}

/** Order points into a short open path (nearest neighbour from the left-most), for data order. */
export function shortPath(pts: P2[]): P2[] {
  if (pts.length < 3) return [...pts].sort((a, b) => a[0] - b[0]);
  const left = pts.reduce((m, p, i) => (p[0] < pts[m][0] ? i : m), 0);
  const rest = pts.map((_, i) => i).filter((i) => i !== left);
  const out = [pts[left]];
  while (rest.length) {
    const last = out[out.length - 1];
    let bi = 0;
    rest.forEach((i, k) => {
      if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) < Math.hypot(pts[rest[bi]][0] - last[0], pts[rest[bi]][1] - last[1])) bi = k;
    });
    out.push(pts[rest[bi]]);
    rest.splice(bi, 1);
  }
  return out;
}

/**
 * A closed heightfield slab: flat bottom at z=0, top at `top(i, j)` over an nx × ny grid that
 * spans [x0, x0 + w] × [y0, y0 + h]. Built as a mesh directly (a refined box would carry
 * millions of wasted side triangles), so it is exact and quick.
 */
export function heightfield(ctx: BuildCtx, nx: number, ny: number, x0: number, y0: number, w: number, h: number, top: (i: number, j: number) => number): Manifold {
  const n = nx * ny;
  const vp = new Float32Array(n * 2 * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + (w * i) / (nx - 1);
      const y = y0 + (h * j) / (ny - 1);
      vp.set([x, y, top(i, j)], k * 3);
      vp.set([x, y, 0], (n + k) * 3);
    }
  }
  const T = (i: number, j: number) => j * nx + i;
  const B = (i: number, j: number) => n + j * nx + i;
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      tris.push(T(i, j), T(i + 1, j), T(i + 1, j + 1), T(i, j), T(i + 1, j + 1), T(i, j + 1));
      tris.push(B(i, j), B(i + 1, j + 1), B(i + 1, j), B(i, j), B(i, j + 1), B(i + 1, j + 1));
    }
  }
  for (let i = 0; i < nx - 1; i++) {
    // y = y0 side, outward -y
    tris.push(B(i, 0), B(i + 1, 0), T(i + 1, 0), B(i, 0), T(i + 1, 0), T(i, 0));
    // y = y0 + h side, outward +y
    const j = ny - 1;
    tris.push(B(i + 1, j), B(i, j), T(i, j), B(i + 1, j), T(i, j), T(i + 1, j));
  }
  for (let j = 0; j < ny - 1; j++) {
    // x = x0 side, outward -x
    tris.push(B(0, j + 1), B(0, j), T(0, j), B(0, j + 1), T(0, j), T(0, j + 1));
    // x = x0 + w side, outward +x
    const i = nx - 1;
    tris.push(B(i, j), B(i, j + 1), T(i, j + 1), B(i, j), T(i, j + 1), T(i, j));
  }
  const mesh = new ctx.wasm.Mesh({ numProp: 3, vertProperties: vp, triVerts: new Uint32Array(tris) });
  return ctx.Manifold.ofMesh(mesh);
}

/** Annular sector in the XY plane, angles in degrees, CCW from +X. */
export function sector(g: Geo, r0: number, r1: number, a0: number, a1: number, steps = 6): CrossSection {
  const pts: P2[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = ((a0 + ((a1 - a0) * k) / steps) * Math.PI) / 180;
    pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
  }
  for (let k = steps; k >= 0; k--) {
    const a = ((a0 + ((a1 - a0) * k) / steps) * Math.PI) / 180;
    pts.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
  }
  return g.poly(pts);
}

/** Points along a straight strip run from a to b at `pitch`, first pixel half a pitch in. */
export function stripRun(a: Vec3, b: Vec3, count: number, pitch: number): Vec3[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const u: Vec3 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
  const s0 = (L - count * pitch) / 2 + pitch / 2;
  return Array.from({ length: count }, (_, i) => [a[0] + u[0] * (s0 + i * pitch), a[1] + u[1] * (s0 + i * pitch), a[2] + u[2] * (s0 + i * pitch)] as Vec3);
}

/** A deterministic PRNG (mulberry32) so seeded patterns rebuild identically. */
export function rng(seed: number): () => number {
  let a = Math.floor(seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
