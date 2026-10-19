import { Cards } from '../../shared/ui';
import { DEPTH_COLORS } from './Scene';
import { useFw } from './useFw';

/** Tools, driver switch and bulk actions. Presets are listed by the shell below this. */
export function FwPalette() {
  const kind = useFw((s) => s.design.driver.kind);
  const overrides = useFw((s) => Object.keys(s.design.overrides).length);
  const omitted = useFw((s) => s.design.omit.length);
  const hasWall = useFw((s) => s.design.areas.length > 0);
  const setDriver = useFw((s) => s.setDriver);
  const clearOverrides = useFw((s) => s.clearOverrides);
  const restoreAll = useFw((s) => s.restoreAll);

  return (
    <section>
      <h3>Facet wall</h3>
      <Cards
        cards={[
          { tool: 'select', code: 'SEL', name: 'Select & shape', key: 'v', tag: 'Click a facet to inspect it. Drag the yellow corners to reshape the outline.' },
          { tool: 'depth', code: 'DEP', name: 'Depth', key: 'd', tag: 'Click a facet to step it D1 → D2 → D3. Shift-click hands it back to the driver.' },
          { tool: 'knock', code: 'OUT', name: 'Knock out', key: 'k', tag: 'Click a facet to leave a gap in the wall; click again to put it back.' },
          {
            code: 'GRD',
            name: 'Gradient driver',
            tag: hasWall ? 'Depth rises along the orange arrow. Drag its tip to turn it.' : 'Draw a shape with the sketch tools to start a wall.',
            active: kind === 'gradient',
            onClick: () => setDriver({ kind: 'gradient' }),
          },
          { code: 'IMG', name: 'Picture driver', tag: 'Brighter areas of the depth picture stand further off the wall.', active: kind === 'image', onClick: () => setDriver({ kind: 'image' }) },
          { code: 'CLR', name: 'Clear depth overrides', tag: overrides ? `${overrides} facet${overrides === 1 ? '' : 's'} set by hand.` : 'No facets set by hand.', disabled: !overrides, onClick: clearOverrides },
          { code: 'RST', name: 'Restore knocked-out facets', tag: omitted ? `${omitted} facet${omitted === 1 ? '' : 's'} knocked out.` : 'Every facet is in.', disabled: !omitted, onClick: restoreAll },
        ]}
      />
      <p className="dim">
        Depth:{' '}
        {['D1 shallow', 'D2', 'D3 deep'].map((l, i) => (
          <span key={l} className="chip" style={{ borderColor: DEPTH_COLORS[i], color: DEPTH_COLORS[i] }}>
            {l}
          </span>
        ))}
      </p>
    </section>
  );
}
