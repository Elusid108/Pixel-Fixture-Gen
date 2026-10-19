import { useMemo } from 'react';
import { Cards, type ToolCard } from '../../shared/ui';
import { CAP_KINDS, CAPS, KINDS, SEG_KINDS } from '../model';
import { stackLabel } from '../plan';
import { targetStack, useColumn } from './useColumn';

const TOOLS: ToolCard[] = [
  { tool: 'stack', code: 'STK', name: 'Stack', key: 't', tag: 'Click the bench to stand a column: base, one ring band, dome.' },
  { tool: 'drop', code: 'DRP', name: 'Drop', key: 'h', tag: 'Click to hang a drop from a ceiling canopy at Plane Z.' },
  { tool: 'select', code: 'SEL', name: 'Select & move', key: 'v', tag: 'Click a segment to edit it. Drag a base or canopy to move its stack.' },
];

/** Tools, the segment library, caps and the base/canopy toggle. Library cards act on the target stack. */
export function CsPalette() {
  const design = useColumn((s) => s.design);
  const selection = useColumn((s) => s.selection);
  const target = useMemo(() => targetStack(design, selection), [design, selection]);
  const label = target ? stackLabel(design.stacks.indexOf(target)) : null;
  const act = useColumn.getState;

  const segCards: ToolCard[] = SEG_KINDS.map((k) => ({
    code: KINDS[k].code,
    name: KINDS[k].name,
    tag: KINDS[k].blurb,
    disabled: !target,
    onClick: () => target && act().appendSegment(target.id, k),
  }));
  const capCards: ToolCard[] = CAP_KINDS.map((c) => ({
    code: CAPS[c].code,
    name: `${CAPS[c].name} cap`,
    tag: CAPS[c].blurb,
    disabled: !target,
    active: target?.cap === c,
    onClick: () => target && act().setCap(target.id, c),
  }));
  const mountCards: ToolCard[] = [
    { code: 'BAS', name: 'On a base', tag: 'PSU and controller bay with vents, gland, bottom plate and feet.', disabled: !target, active: target?.mount === 'floor', onClick: () => target && act().setMount(target.id, 'floor') },
    { code: 'CAN', name: 'From a canopy', tag: 'Hangs as a chandelier drop: canopy, cable, hanger. Data runs down.', disabled: !target, active: target?.mount === 'hang', onClick: () => target && act().setMount(target.id, 'hang') },
  ];

  return (
    <>
      <section>
        <h3>Stacks</h3>
        <Cards cards={TOOLS} />
      </section>
      <section>
        <h3>Segments</h3>
        <p className="hint">{label ? `Adds to ${label}, just under its cap.` : 'Place a stack first.'}</p>
        <Cards cards={segCards} />
      </section>
      <section>
        <h3>Cap & mount{label ? ` · ${label}` : ''}</h3>
        <Cards cards={capCards} />
        <Cards cards={mountCards} />
      </section>
    </>
  );
}
