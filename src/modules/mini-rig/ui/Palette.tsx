import { Cards, type ToolCard } from '../../shared/ui';
import { KIND_LIST, KINDS } from '../model';
import { useRig, useRigTool } from './useRig';

export function RigPalette() {
  const tool = useRig((s) => s.tool);
  const setTool = useRig((s) => s.setTool);
  const selection = useRig((s) => s.selection);
  const controller = useRig((s) => s.design.controller);
  const kind = useRigTool((s) => s.kind);
  const setKind = useRigTool((s) => s.setKind);
  const node = selection?.kind === 'node' ? selection.id : null;

  const tools: ToolCard[] = [
    { tool: 'truss', code: 'TRS', name: 'Truss', key: 't', tag: 'Click the plane or blocks to run truss from block to block. Esc ends the run.' },
    { tool: 'instrument', code: 'INS', name: 'Instrument', key: 'i', tag: `Click a span to clip on a ${KINDS[kind].label}. Click near the chord you want it on.` },
    { tool: 'select', code: 'SEL', name: 'Select & move', key: 'v', tag: 'Drag a block across the grid. Set its height in the inspector.' },
  ];
  const kinds: ToolCard[] = KIND_LIST.map((k) => ({
    code: KINDS[k].code,
    name: KINDS[k].label,
    tag: KINDS[k].blurb,
    active: tool === 'instrument' && kind === k,
    onClick: () => {
      setKind(k);
      setTool('instrument');
    },
  }));

  return (
    <>
      <section>
        <h3>Rig</h3>
        <Cards cards={tools} />
        <Cards
          cards={[
            {
              code: 'DAT',
              name: 'Data feed here',
              tag: node ? `Feed data and power into ${node}; instruments chain from there.` : `Now ${controller || 'unset'}. Select a block to move the feed.`,
              disabled: !node || node === controller,
              onClick: () => node && useRig.getState().setController(node),
            },
          ]}
        />
      </section>
      <section>
        <h3>Instruments</h3>
        <Cards cards={kinds} />
      </section>
    </>
  );
}
