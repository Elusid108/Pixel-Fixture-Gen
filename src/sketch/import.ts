import { textStrokes } from '../geom/font';
import { fromPlane, nestLoops, bounds2, dedupeConsecutive } from './geom';
import type { SketchPath, SketchPlane, SketchRegion, SketchSource, Vec2 } from './types';

/**
 * Turning outside artwork into sketch entities. Everything here works on plain 2D loops, so
 * it is unit-tested in Node. The browser-only steps (SVGLoader, manifold outlines for bold
 * text) live in ui/sketch and hand their loops to these functions.
 */

export interface Artwork {
  /** Filled loops, any winding; nesting decides holes. */
  fills: Vec2[][];
  /** Open or closed stroked polylines. */
  strokes: { pts: Vec2[]; closed: boolean }[];
}

export interface PlaceOpts {
  plane: SketchPlane;
  /** Scale so the artwork is this wide, mm. */
  width: number;
  /** Centre of the artwork on the plane, plane coords. */
  at?: Vec2;
  /** Flip vertically (SVG and screen coordinates point y down). */
  flipY?: boolean;
  source: SketchSource;
}

/** Scale, centre and flip artwork, then emit regions (from fills) and paths (from strokes). */
export function placeArtwork(art: Artwork, opts: PlaceOpts, ids: { path: () => string; region: () => string }): { paths: SketchPath[]; regions: SketchRegion[] } {
  const all = [...art.fills.flat(), ...art.strokes.flatMap((s) => s.pts)];
  if (!all.length) return { paths: [], regions: [] };
  const b = bounds2(all);
  const w = Math.max(1e-9, b.max[0] - b.min[0]);
  const k = opts.width / w;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const [ax, ay] = opts.at ?? [0, 0];
  const fy = opts.flipY ? -1 : 1;
  const map = (p: Vec2): Vec2 => [ax + (p[0] - cx) * k, ay + fy * (p[1] - cy) * k];

  const regions: SketchRegion[] = nestLoops(art.fills.map((l) => l.map(map))).map((r) => ({
    id: ids.region(),
    outer: r.outer,
    holes: r.holes,
    plane: opts.plane,
    source: opts.source,
  }));
  const paths: SketchPath[] = art.strokes
    .map((s) => ({ ...s, pts: dedupeConsecutive(s.pts.map(map).map((p) => fromPlane(p, opts.plane))) }))
    .filter((s) => s.pts.length >= 2)
    .map((s) => ({ id: ids.path(), pts: s.pts, closed: s.closed, plane: opts.plane, source: opts.source }));
  return { paths, regions };
}

/** Single-line text from the engraving font as stroked artwork (y up, baseline at 0). */
export function textArtwork(text: string, height: number): Artwork {
  const { strokes } = textStrokes(text, height);
  return { fills: [], strokes: strokes.filter((s) => s.length >= 2).map((pts) => ({ pts: pts as Vec2[], closed: false })) };
}
