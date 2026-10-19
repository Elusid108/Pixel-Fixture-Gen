import { Cards, type ToolCard } from '../../shared/ui';
import { fmt } from '../../shared/layout';
import { parseAnchorKey } from '../model';
import { usePc, usePcPlan } from './usePc';

/** Tools and quick actions for Pixel Chain. Presets are listed by the shell below this. */
export function PcPalette() {
  const selection = usePc((s) => s.selection);
  const addSwag = usePc((s) => s.addSwag);
  const extend = usePc((s) => s.extend);
  const toggle = usePc((s) => s.toggle);
  const plan = usePcPlan();
  const gid = selection?.kind === 'garland' ? selection.id : selection?.kind === 'anchor' ? (parseAnchorKey(selection.id)?.gid ?? null) : null;
  const gp = gid ? plan.garlands.find((g) => g.id === gid) : undefined;
  const garland = usePc((s) => (gid ? s.design.garlands.find((g) => g.id === gid) : undefined));
  const d = plan.dims;

  const cards: ToolCard[] = [
    { tool: 'garland', code: 'GAR', name: 'Garland', key: 'g', tag: 'Click anchors on the plane. Click the first anchor again to close a ring. Esc ends.' },
    { tool: 'select', code: 'SEL', name: 'Select & move', key: 'v', tag: 'Drag anchors across the bench. Hold Shift to raise or lower them.' },
    { code: 'SWG', name: 'Add a swag', tag: `Three anchors at ${fmt(600)} mm, two ${fmt(500)} mm swags.`, onClick: addSwag },
    {
      code: 'EXT',
      name: 'Extend garland',
      tag: gp ? `Add an anchor past the end of ${gp.id}.` : 'Select a garland to add an anchor at its end.',
      onClick: () => gid && extend(gid),
      disabled: !gid || !!garland?.closed,
    },
    {
      code: 'DIR',
      name: 'Feed from the other end',
      tag: gp ? `${gp.id} takes data at ${garland?.reverse ? 'its last' : 'its first'} anchor now.` : 'Select a garland to flip its data direction.',
      onClick: () => gid && toggle(gid, 'reverse'),
      disabled: !gid,
    },
  ];

  return (
    <section>
      <h3>Pixel Chain</h3>
      <Cards cards={cards} />
      <p className="dim">
        One {d.pixel.name} per link. Links are {fmt(d.leadMax)} mm or less pin to pin, so the {d.lead} mm lead always reaches with {d.slack} mm to spare.
      </p>
    </section>
  );
}
