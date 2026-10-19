import { Cards } from '../../shared/ui';
import { topology } from '../topology';
import { useMemo } from 'react';
import { useLinea } from './useLinea';

/** The run a selection belongs to: the run itself, a bar's run, or the first run through a joint. */
export function useSelectedRun(): string | null {
  const selection = useLinea((s) => s.selection);
  const design = useLinea((s) => s.design);
  return useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'run') return design.runs.some((r) => r.id === selection.id) ? selection.id : null;
    const topo = topology(design);
    if (selection.kind === 'bar') return topo.edges.find((e) => e.id === selection.id)?.run ?? null;
    if (selection.kind === 'joint') return topo.nodes.find((n) => n.id === selection.id)?.verts[0]?.run ?? null;
    return null;
  }, [selection, design]);
}

export function LineaPalette() {
  const run = useSelectedRun();
  const feed = useLinea((s) => s.design.feed);
  const first = useLinea((s) => s.design.runs[0]?.id ?? '');
  const runs = useLinea((s) => s.design.runs.length);
  const isFeed = run !== null && (feed || first) === run;
  const act = useLinea.getState;

  return (
    <section>
      <h3>Components</h3>
      <Cards
        cards={[
          { tool: 'run', code: 'RUN', name: 'Bar run', key: 'b', tag: 'Click points on the grid. Click the last point again (or Enter) to end, the first to close. Start on a bar or joint for a T.' },
          { tool: 'select', code: 'SEL', name: 'Select & move', key: 'v', tag: 'Click a bar or joint to inspect it. Drag a vertex; it re-locks to the pixel pitch on release.' },
          {
            code: 'REV',
            name: 'Reverse run',
            tag: run ? `${run}: data and strip direction run the other way.` : 'Select a bar or run first.',
            disabled: !run,
            onClick: () => run && act().reverseRun(run),
          },
          {
            code: 'IN',
            name: 'Feed here',
            tag: run ? (isFeed ? `${run} already takes the feed at its start.` : `Data and power enter at the start of ${run}.`) : 'Select a run to feed it.',
            disabled: !run || isFeed,
            onClick: () => run && act().setFeed(run),
          },
          {
            code: 'LCK',
            name: 'Re-lock all runs',
            tag: 'After changing the pixel: snap every segment to whole pixels of the new pitch, angles unchanged.',
            disabled: !runs,
            onClick: () => act().relockAll(),
          },
          {
            code: 'FLP',
            name: 'Flip light side',
            tag: run ? `${run}: bars face the other side of their plane.` : 'For runs on a ceiling or the back of a wall.',
            disabled: !run,
            onClick: () => run && act().flipFace(run),
          },
        ]}
      />
      <p className="dim">Draw on the wall or any plane with the drawing tools, then send the lines to Linea. Straights lock to whole pixels; corners keep the exact drawn angle.</p>
    </section>
  );
}
