import { useSketch } from '../../sketch/store';
import { useBench } from '../../workbench/store';
import { finishDraft } from './SketchLayer';

/**
 * Drawing-engine commands shared by the keyboard (Enter, Backspace, Esc, X / Y / Z) and the
 * on-screen buttons over the view, so a phone can do everything a keyboard can.
 */
export const sketchActions = {
  /** Enter, double-click: end the line in progress, open. */
  finish: () => finishDraft(false),
  /** End the line in progress as a closed shape. */
  close: () => finishDraft(true),
  /** Backspace: drop the last placed point (the whole draft when it's the only one). */
  undoPoint: () => {
    const st = useSketch.getState();
    const d = st.draft;
    if (!d?.pts.length) return false;
    st.setDraft(d.pts.length > 1 ? { ...d, pts: d.pts.slice(0, -1), planes: d.planes.slice(0, -1) } : null);
    return true;
  },
  /** Esc: drop the draft, then the selection, then leave drawing. */
  cancel: () => {
    const st = useSketch.getState();
    if (st.draft) st.setDraft(null);
    else if (st.selected.length) st.clearSelection();
    else useBench.getState().setTool('select');
  },
  /** X / Y / Z: turn the line onto a new plane through its last point (3D sketching). */
  turn: (axis: 'x' | 'y' | 'z') => {
    const st = useSketch.getState();
    const d = st.draft;
    if (d?.tool !== 'draw:line' || !d.pts.length) return false;
    const last = d.pts[d.pts.length - 1];
    if (axis === 'z') st.setPlane('XY', last[2]);
    if (axis === 'y') st.setPlane('XZ', last[1]);
    if (axis === 'x') st.setPlane('YZ', last[0]);
    return true;
  },
};

/** Which plane a turn key lands on, for highlighting the active one. */
export const TURN_PLANE = { x: 'YZ', y: 'XZ', z: 'XY' } as const;

/** The drawing tools' hints, for fingers. */
export const TOUCH_HINTS: Record<string, string> = {
  'draw:select': 'Tap shapes to select · Shift adds · drag orbits',
  'draw:line': 'Tap points · tap the first point or Close to shut it · X / Y / Z turn the plane',
  'draw:rect': 'Tap two corners',
  'draw:circle': 'Tap the centre, then the edge',
  'draw:polygon': 'Tap the centre, then a corner',
  'draw:arc': 'Tap the start, the end, then a point on the arc',
  'draw:free': 'Drag one finger to draw · pinch still zooms',
};
