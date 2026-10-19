/**
 * A single-stroke font for engraving part labels. Glyphs live on a 4×6 grid;
 * each polyline becomes capsule strokes, which print cleanly at 0.4 mm nozzle widths.
 */
const GLYPHS: Record<string, string> = {
  '0': '0,0 4,0 4,6 0,6 0,0;0,1 4,5',
  '1': '1,5 2,6 2,0;1,0 3,0',
  '2': '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  '3': '0,6 4,6 2,4 3,4 4,3 4,1 3,0 1,0 0,1',
  '4': '3,0 3,6 0,2 4,2',
  '5': '4,6 0,6 0,3.5 3,3.5 4,2.5 4,1 3,0 0,0',
  '6': '4,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.5 3,3.5 0,3.5',
  '7': '0,6 4,6 1.5,0',
  '8': '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  '9': '0,0 3,0 4,1 4,5 3,6 1,6 0,5 0,3.5 1,2.5 4,2.5',
  A: '0,0 0,4 2,6 4,4 4,0;0,3 4,3',
  B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3;3,3 4,2 4,1 3,0 0,0',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0',
  E: '4,0 0,0 0,6 4,6;0,3 3,3',
  F: '0,0 0,6 4,6;0,3 3,3',
  G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3',
  H: '0,0 0,6;4,0 4,6;0,3 4,3',
  I: '1,0 3,0;2,0 2,6;1,6 3,6',
  J: '0,1 1,0 2,0 3,1 3,6;1,6 4,6',
  K: '0,0 0,6;4,6 0,2;1.3,3.3 4,0',
  L: '0,6 0,0 4,0',
  M: '0,0 0,6 2,3 4,6 4,0',
  N: '0,0 0,6 4,0 4,6',
  O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0;2.5,1.5 4,0',
  R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3;2,3 4,0',
  S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6;2,6 2,0',
  U: '0,6 0,1 1,0 3,0 4,1 4,6',
  V: '0,6 2,0 4,6',
  W: '0,6 1,0 2,3 3,0 4,6',
  X: '0,0 4,6;0,6 4,0',
  Y: '0,6 2,3 4,6;2,3 2,0',
  Z: '0,6 4,6 0,0 4,0',
  '-': '1,3 3,3',
  '.': '2,0 2,0.3',
  '/': '0,0 4,6',
  '+': '0,3 4,3;2,1 2,5',
};

const ADVANCE = 5.5;

export type Stroke = [number, number][];

/** Strokes for a string, scaled to `height` mm, anchored bottom-left. */
export function textStrokes(text: string, height: number): { strokes: Stroke[]; width: number } {
  const s = height / 6;
  const strokes: Stroke[] = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch];
    if (g) {
      for (const poly of g.split(';')) {
        strokes.push(
          poly
            .trim()
            .split(/\s+/)
            .map((pt) => {
              const [px, py] = pt.split(',').map(Number);
              return [(x + px) * s, py * s] as [number, number];
            }),
        );
      }
    }
    x += ADVANCE;
  }
  return { strokes, width: Math.max(0, (x - (ADVANCE - 4)) * s) };
}
