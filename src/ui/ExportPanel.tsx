import { useState } from 'react';
import { build3mf } from '../export/threemf';
import { getFixture } from '../fixtures/registry';
import { scheduleCsv } from '../schedule/csv';
import { usePlates } from './PartsPanel';
import { useStore } from './store';

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function ExportPanel() {
  const result = useStore((s) => s.result);
  const { printer, plates } = usePlates();
  const [busy, setBusy] = useState<string | null>(null);
  if (!result) return null;
  const def = getFixture(result.fixtureId);
  const base = `${def.code}-${slug(def.name)}`;
  const title = `${def.code} ${def.name}`;

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const threeMf = (mode: 'plates' | 'assembly', plateIndex?: number) =>
    run(`${mode}${plateIndex ?? ''}`, async () => {
      const bytes = await build3mf({ title, parts: result.parts, mode, plates, plateIndex, printer });
      const suffix = mode === 'assembly' ? 'assembly' : plateIndex === undefined ? `${plates.length}-plates` : `plate-${plateIndex + 1}`;
      download(bytes, `${base}-${suffix}.3mf`, 'model/3mf');
    });

  return (
    <div className="export">
      <section>
        <h4>Print files · 3MF</h4>
        <p>
          Named parts with body / diffuser / baffle material slots, laid out for a {printer.name}. Map the slots to filaments in your
          slicer.
        </p>
        <div className="buttons">
          <button className="primary" disabled={!!busy || result.errors.length > 0} onClick={() => threeMf('plates')}>
            {busy === 'plates' ? 'Writing…' : `All ${plates.length} plate${plates.length === 1 ? '' : 's'}`}
          </button>
          {plates.length > 1 &&
            plates.map((_, i) => (
              <button key={i} disabled={!!busy} onClick={() => threeMf('plates', i)}>
                Plate {i + 1}
              </button>
            ))}
          <button disabled={!!busy} onClick={() => threeMf('assembly')} title="One multi-part object in the assembled pose, for checking fit">
            Assembly (multi-part)
          </button>
        </div>
      </section>
      <section>
        <h4>Paperwork</h4>
        <p>The instrument schedule with patch, power roll-up, checks and hardware, as CSV (opens in Lightwright or any spreadsheet).</p>
        <div className="buttons">
          <button disabled={!result.report.rows.length} onClick={() => download(scheduleCsv(result.report, title), `${base}-schedule.csv`, 'text/csv')}>
            Instrument schedule CSV
          </button>
          <button
            disabled={!result.pixels.length}
            onClick={() => {
              const lines = ['index,unit,x_mm,y_mm,z_mm'];
              result.pixels.forEach((p, i) => lines.push([i + 1, p.unit, ...p.pos.map((v) => v.toFixed(2))].join(',')));
              download(lines.join('\r\n'), `${base}-pixelmap.csv`, 'text/csv');
            }}
          >
            Pixel map CSV (x, y, z)
          </button>
        </div>
        <p className="dim">xLights custom model and WLED ledmap exports are on the roadmap. The CSV already carries data order and positions.</p>
      </section>
    </div>
  );
}
