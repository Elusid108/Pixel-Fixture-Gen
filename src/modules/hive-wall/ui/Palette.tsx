import { Cards } from '../../shared/ui';
import { useHw, useHwLayout } from './useHw';

export function HwPalette() {
  const actions = useHw.getState;
  const overrides = useHw((s) => s.design.on.length + s.design.off.length);
  const hasArea = useHw((s) => s.design.areas.length > 0);
  const rot = useHw((s) => s.design.lattice.rot);
  const layout = useHwLayout();
  const { size, D } = layout.dims;
  return (
    <section>
      <h3>Hive wall</h3>
      <Cards
        cards={[
          { tool: 'select', code: 'SEL', name: 'Select & shape', key: 'v', tag: 'Click a tile to inspect it. Drag the yellow outline points to reshape the wall.' },
          { tool: 'tile', code: 'TIL', name: 'Tile on/off', key: 't', tag: 'Click a slot to switch its tile off, or an empty slot to place a whole tile there.' },
          {
            code: 'CTR',
            name: 'Centre the lattice',
            tag: hasArea ? 'Put a tile in the middle of the outline so edge tiles trim evenly.' : 'Draw a closed shape first, then generate a Hive wall from it.',
            disabled: !hasArea,
            onClick: () => actions().centreLattice(),
          },
          {
            code: rot === 0 ? 'PT' : 'FT',
            name: rot === 0 ? 'Pointy-top lattice' : 'Flat-top lattice',
            tag: rot === 0 ? 'Turn the tiling 30° so tiles stand on a corner (keyholes then need screws).' : 'Back to flat-top rows that hang on the rail by gravity.',
            onClick: () => actions().turnLattice(),
          },
          {
            code: 'RST',
            name: 'Clear tile overrides',
            tag: overrides ? `${overrides} slot${overrides === 1 ? '' : 's'} set by hand. Go back to what the outline says.` : 'No slots set by hand.',
            disabled: !overrides,
            onClick: () => actions().clearOverrides(),
          },
        ]}
      />
      <p className="dim">
        {size} tiles, {Math.round(D)} mm apart. Draw any closed shape (rectangle, ellipse, polygon, text) and generate a Hive wall to fill it; shapes inside become windows.
      </p>
    </section>
  );
}
