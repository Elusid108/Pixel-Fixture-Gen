import { useSketch } from '../../sketch/store';
import { useBench } from '../../workbench/store';
import { getCore } from '../../workbench/cores';
import { sketchActions, TOUCH_HINTS, TURN_PLANE } from '../sketch/actions';
import { useStore } from '../store';
import { pressKey, useTouchMods } from '../touch';
import { benchTools } from './BenchToolbar';

/** "Click" → "Tap" for hints shown to fingers. */
const tapped = (hint: string) => hint.replace(/\bClick/g, 'Tap').replace(/\bclick/g, 'tap');

/**
 * Buttons over the bench view for what the keyboard does: finish, close, undo a point, cancel
 * and the X / Y / Z plane turn while drawing. On the compact shell it also carries the active
 * tool's hint, Enter / Esc for multi-tap system tools, delete for the selection, and a sticky
 * Shift for the gestures that need it.
 */
export function CanvasActions({ phone }: { phone: boolean }) {
  const tool = useBench((s) => s.tool);
  const system = useBench((s) => s.system);
  const pending = useBench((s) => s.pending);
  const selection = useBench((s) => s.selection);
  const setTool = useBench((s) => s.setTool);
  const view = useStore((s) => s.view);
  const draft = useSketch((s) => s.draft);
  const picked = useSketch((s) => s.selected.length);
  const canUndo = useSketch((s) => s.past.length > 0);
  const canRedo = useSketch((s) => s.future.length > 0);
  const planeKind = useSketch((s) => s.planeKind);
  const shift = useTouchMods((s) => s.shift);
  const toggleShift = useTouchMods((s) => s.toggleShift);
  if (view !== 'assembled') return null;

  const drawing = tool.startsWith('draw:');
  if (!drawing && !phone) return null;
  const n = draft?.pts.length ?? 0;
  const line = draft?.tool === 'draw:line';
  const active = benchTools(system).find((t) => t.id === tool);
  const hint = phone ? (drawing ? TOUCH_HINTS[tool] : active && tapped(active.hint)) : null;
  const canRemove = !!selection && !!getCore(system).remove;

  return (
    <div className="canvas-actions" role="toolbar" aria-label={drawing ? 'Drawing' : 'Bench'}>
      {hint && <p className="ca-hint">{hint}</p>}
      <div className="ca-row">
        {drawing && draft && (
          <>
            <button onClick={sketchActions.undoPoint} title="Undo the last point (Backspace)">
              Undo point
            </button>
            {line && (
              <button className="primary" disabled={n < 2} onClick={sketchActions.finish} title="End the line here (Enter)">
                Finish
              </button>
            )}
            {line && (
              <button disabled={n < 3} onClick={sketchActions.close} title="Join back to the first point">
                Close shape
              </button>
            )}
            <button onClick={sketchActions.cancel} title="Drop this shape (Esc)">
              Cancel
            </button>
            {line && (
              <div className="seg" aria-label="Turn onto a plane through the last point">
                {(['x', 'y', 'z'] as const).map((a) => (
                  <button
                    key={a}
                    className={planeKind === TURN_PLANE[a] ? 'on' : ''}
                    aria-pressed={planeKind === TURN_PLANE[a]}
                    onClick={() => sketchActions.turn(a)}
                    title={`Turn onto the ${TURN_PLANE[a]} plane through the last point (${a.toUpperCase()})`}
                  >
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {drawing && !draft && (
          <>
            <button disabled={!canUndo} onClick={() => useSketch.getState().undo()} title="Undo the last shape (Ctrl+Z)">
              Undo
            </button>
            <button disabled={!canRedo} onClick={() => useSketch.getState().redo()} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            {tool === 'draw:select' && picked > 0 && <button onClick={() => useSketch.getState().removeSelected()}>Delete</button>}
            <button onClick={() => setTool('select')} title="Leave drawing (Esc)">
              Done drawing
            </button>
          </>
        )}
        {phone && !drawing && pending && (
          <>
            <button onClick={() => pressKey('Enter')} title="Finish the run (Enter)">
              Finish
            </button>
            <button onClick={() => pressKey('Escape')} title="End or cancel the run (Esc)">
              End
            </button>
          </>
        )}
        {phone && !drawing && !pending && canRemove && (
          <>
            <button onClick={() => useBench.getState().removeSelection()} title="Remove the selection (Del)">
              Delete
            </button>
            <button onClick={() => useBench.getState().select(null)}>Deselect</button>
          </>
        )}
        {phone && (
          <button className={`shift${shift ? ' on' : ''}`} aria-pressed={shift} onClick={toggleShift} title="Acts as a held Shift key: lift a hub, flip a strip, add to a selection">
            ⇧ Shift
          </button>
        )}
      </div>
    </div>
  );
}
