import { formatAddress } from '../schedule/schedule';
import { useStore } from './store';

const fmt = (v: number, d = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(d));

export function SchedulePanel() {
  const report = useStore((s) => s.result?.report);
  if (!report) return null;
  if (!report.rows.length) {
    return <p className="empty">No pixels on this one. It's shop tooling. Print it, test the fit, move on.</p>;
  }
  return (
    <div className="schedule">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Position</th>
              <th>Purpose</th>
              <th>Pixel form</th>
              <th>Pixel</th>
              <th>Spec</th>
              <th className="num">Qty</th>
              <th className="num">Px</th>
              <th className="num">Ch</th>
              <th>Patch (U/Ch)</th>
              <th className="num">Max W</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.unit}>
                <td className="mono strong">{r.unit}</td>
                <td>{r.position}</td>
                <td>{r.purpose}</td>
                <td>
                  <span className="chip">{r.form}</span>
                </td>
                <td>{r.pixelName}</td>
                <td className="mono dim">{r.spec}</td>
                <td className="num">{r.qty}</td>
                <td className="num">{r.px}</td>
                <td className="num">{r.channels}</td>
                <td className="mono">
                  {formatAddress(r.start)}–{formatAddress(r.end)}
                </td>
                <td className="num">{fmt(r.maxW)}</td>
                <td className="dim">{r.notes}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>Totals</td>
              <td className="num">{report.totals.px}</td>
              <td className="num">{report.totals.channels}</td>
              <td className="mono">
                {report.totals.universes} univ.
              </td>
              <td className="num">{fmt(report.totals.watts)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="roll">
        {report.power.map((g) => (
          <div className="power" key={g.volts}>
            <div className="big">
              {g.volts} V<span>{g.px} px</span>
            </div>
            <dl>
              <dt>Max draw</dt>
              <dd>
                {fmt(g.watts)} W · {g.amps.toFixed(2)} A
              </dd>
              <dt>PSU (80% rule)</dt>
              <dd>{g.psuW} W</dd>
              <dt>Injection points</dt>
              <dd>{g.injections}</dd>
              <dt>Feed ≤ 2 m</dt>
              <dd>{g.gauge}</dd>
            </dl>
          </div>
        ))}
        <ul className="checks">
          {report.checks.map((c, i) => (
            <li key={i} className={c.level}>
              {c.text}
            </li>
          ))}
        </ul>
        {report.hardware.length > 0 && (
          <div className="hardware">
            <h4>Hardware</h4>
            <ul>
              {report.hardware.map((h) => (
                <li key={h.item}>
                  <b>{h.qty}</b> {h.item}
                  {h.note && <span> · {h.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
