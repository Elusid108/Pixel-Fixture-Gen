import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { Artwork } from '../../sketch/import';
import type { Vec2 } from '../../sketch/types';

/**
 * Browser-only artwork sources: SVG files through three's SVGLoader, and bold (filled) text
 * through manifold's 2D booleans, loaded on demand on the UI thread.
 */

const CURVE_DIVISIONS = 16;

export function svgArtwork(text: string): Artwork {
  const data = new SVGLoader().parse(text);
  const art: Artwork = { fills: [], strokes: [] };
  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as { fill?: string; stroke?: string };
    const filled = style.fill !== undefined && style.fill !== 'none' && style.fill !== 'transparent';
    const stroked = style.stroke !== undefined && style.stroke !== 'none' && style.stroke !== 'transparent';
    if (filled) {
      for (const shape of SVGLoader.createShapes(path)) {
        art.fills.push(shape.getPoints(CURVE_DIVISIONS).map((v) => [v.x, v.y] as Vec2));
        for (const hole of shape.holes) art.fills.push(hole.getPoints(CURVE_DIVISIONS).map((v) => [v.x, v.y] as Vec2));
      }
    }
    if (stroked || !filled) {
      for (const sub of path.subPaths) {
        const pts = sub.getPoints(CURVE_DIVISIONS).map((v) => [v.x, v.y] as Vec2);
        if (pts.length >= 2) art.strokes.push({ pts, closed: sub.autoClose });
      }
    }
  }
  return art;
}

/** Bold text: the engraving font's strokes thickened into filled outlines. */
export async function boldTextArtwork(text: string, height: number, weight: number): Promise<Artwork> {
  const [{ loadManifold, inArena, makeCtx }, { Geo }] = await Promise.all([import('../../geom/manifold'), import('../../geom/geo')]);
  const wasm = await loadManifold(() => wasmUrl);
  return inArena(wasm, () => {
    const cs = new Geo(makeCtx(wasm)).text(text, height, weight);
    // Geo.text centres on the origin with y up, which is what placeArtwork expects.
    return { fills: cs.toPolygons().map((poly) => poly.map((p) => [p[0], p[1]] as Vec2)), strokes: [] };
  });
}
