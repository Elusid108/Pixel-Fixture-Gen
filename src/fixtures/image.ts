/**
 * Image params: a picture reduced to a small 8-bit grayscale grid so it can ride in params,
 * localStorage and the worker message. Encoded as JSON `{w, h, d}` with `d` base64 of w·h bytes,
 * row-major, top row first, 0 = black and 255 = white. Pure TS; runs in the worker and Node.
 */

export interface GrayImage {
  w: number;
  h: number;
  /** w·h luminance bytes, row-major from the top. */
  data: Uint8Array;
}

/** Longest side, px. 256² keeps a param under ~90 kB as base64. */
export const IMAGE_MAX = 256;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export function encodeImage(img: GrayImage): string {
  return JSON.stringify({ w: img.w, h: img.h, d: toBase64(img.data) });
}

/** Null for '' or anything malformed, so fixtures fall back to their built-in image. */
export function decodeImage(param: string): GrayImage | null {
  if (!param) return null;
  try {
    const j = JSON.parse(param) as { w: number; h: number; d: string };
    const data = fromBase64(j.d);
    if (!(j.w > 0 && j.h > 0) || data.length < j.w * j.h) return null;
    return { w: j.w, h: j.h, data: data.subarray(0, j.w * j.h) };
  } catch {
    return null;
  }
}

/** Bilinear luminance 0–1 at normalised (u, v), u left→right and v top→bottom, clamped. */
export function sampleImage(img: GrayImage, u: number, v: number): number {
  const x = Math.min(img.w - 1, Math.max(0, u * (img.w - 1)));
  const y = Math.min(img.h - 1, Math.max(0, v * (img.h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(img.w - 1, x0 + 1);
  const y1 = Math.min(img.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => img.data[yy * img.w + xx] / 255;
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** Build an image from a function of (u, v) → 0–1; fixtures use this for built-in defaults. */
export function imageFrom(w: number, h: number, f: (u: number, v: number) => number): GrayImage {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, f(x / (w - 1), y / (h - 1)))));
  return { w, h, data };
}
