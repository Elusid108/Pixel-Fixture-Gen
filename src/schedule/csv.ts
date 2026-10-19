import { formatAddress, type ScheduleReport } from './schedule';

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function line(values: (string | number)[]): string {
  return values.map(cell).join(',');
}

/** Lightwright-friendly CSV: one row per unit, then power roll-up, checks and hardware. */
export function scheduleCsv(report: ScheduleReport, title: string): string {
  const out: string[] = [];
  out.push(line([title]));
  out.push('');
  out.push(
    line([
      'Unit',
      'Position',
      'Purpose',
      'Pixel form',
      'Pixel',
      'Spec',
      'Qty',
      'Pixels',
      'Ch/px',
      'Channels',
      'Start (U/Ch)',
      'End (U/Ch)',
      'Volts',
      'Max W',
      'Max A',
      'Notes',
    ]),
  );
  for (const r of report.rows) {
    out.push(
      line([
        r.unit,
        r.position,
        r.purpose,
        r.form,
        r.pixelName,
        r.spec,
        r.qty,
        r.px,
        r.chPerPx,
        r.channels,
        formatAddress(r.start),
        formatAddress(r.end),
        r.volts,
        r.maxW.toFixed(1),
        r.amps.toFixed(2),
        r.notes,
      ]),
    );
  }
  out.push('');
  out.push(line(['Totals', '', '', '', '', '', '', report.totals.px, '', report.totals.channels, '', `${report.totals.universes} univ.`, '', report.totals.watts.toFixed(1)]));
  out.push('');
  out.push(line(['Power', 'Pixels', 'Max W', 'Max A', 'PSU (80% rule)', 'Injection points', 'Feed wire (≤2 m)']));
  for (const g of report.power) {
    out.push(line([`${g.volts} V`, g.px, g.watts.toFixed(1), g.amps.toFixed(2), `${g.psuW} W`, g.injections, g.gauge]));
  }
  out.push('');
  out.push(line(['Checks']));
  for (const c of report.checks) out.push(line([c.level.toUpperCase(), c.text]));
  out.push('');
  out.push(line(['Hardware', 'Qty', 'Note']));
  for (const h of report.hardware) out.push(line([h.item, h.qty, h.note ?? '']));
  return out.join('\r\n');
}
