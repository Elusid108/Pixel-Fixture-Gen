import { decodeImage, encodeImage, IMAGE_MAX } from '../fixtures/image';

/** Browser side of image params: read a file, fit it into IMAGE_MAX², convert to luminance. */
export async function imageFileToParam(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, IMAGE_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Rec. 709 luma; transparent pixels read as white (paper).
    const a = rgba[i * 4 + 3] / 255;
    const y = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    data[i] = Math.round(y * a + 255 * (1 - a));
  }
  bitmap.close();
  return encodeImage({ w, h, data });
}

export function imageParamInfo(param: string): { w: number; h: number } | null {
  const img = decodeImage(param);
  return img ? { w: img.w, h: img.h } : null;
}
