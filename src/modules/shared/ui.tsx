import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_PRINTER_ID } from '../../printers';
import { formatAddress, type ScheduleReport } from '../../schedule/schedule';
import type { ParamSpec, Params } from '../../types';
import { Field } from '../../ui/Inspector';
import { useStore } from '../../ui/store';
import { useBench } from '../../workbench/store';
import { resolveSpecs } from './params';

/**
 * React pieces shared by the M-series Palettes, Inspectors and Data tabs, so every system
 * reads the same. Class names are the shell's (styles.css): fixture-card, stats, buttons,
 * xyz, table.mini, chip.
 */

const EMPTY: Params = {};

/** A system's params resolved with defaults and the header's printer, as the worker sees them. */
export function useSystemParams(systemId: string, specs: ParamSpec[]): Params {
  const params = useBench((s) => s.params[systemId] ?? EMPTY);
  const printerId = useStore((s) => s.printerId);
  return useMemo(() => resolveSpecs(specs, { ...params, printer: printerId ?? DEFAULT_PRINTER_ID }), [params, printerId, specs]);
}

/** The latest built schedule for a module, or null while it builds or for another system. */
export function useBuiltReport(moduleId: string): ScheduleReport | null {
  return useStore((s) => (s.result?.fixtureId === moduleId ? s.result.report : null));
}

export function Stat({ k, v, tone }: { k: string; v: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={tone}>{v}</dd>
    </>
  );
}

export function NumInput({ value, onCommit, label, step = 1 }: { value: number; onCommit: (v: number) => void; label: string; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="xyz">
      <span>{label}</span>
      <input type="number" step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

/** Editable design name, committed on blur or Enter. */
export function NameInput({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  return (
    <input
      className="title-input"
      value={text}
      aria-label="Design name"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== name && onRename(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Visible system params as grouped fieldsets, plus a reset button. Hidden and json params are skipped. */
export function ParamGroups({ specs, values }: { specs: ParamSpec[]; values: Params }) {
  const setParam = useBench((s) => s.setParam);
  const reset = useBench((s) => s.resetParams);
  const groups = new Map<string, ParamSpec[]>();
  for (const p of specs) {
    if (p.hidden || p.type === 'json') continue;
    const g = p.group ?? 'Settings';
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return (
    <>
      {[...groups.entries()].map(([g, list]) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {list.map((s) => (
            <Field key={s.key} spec={s} value={values[s.key]} onChange={(v) => setParam(s.key, v)} />
          ))}
        </fieldset>
      ))}
      <button className="ghost" onClick={reset}>
        Reset system settings
      </button>
    </>
  );
}

export interface ToolCard {
  /** Tool id to activate, or omit for an action card. */
  tool?: string;
  code: string;
  name: string;
  tag: string;
  /** Key shown next to the name. */
  key?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}

/** Palette cards: tools (pressed when active) and one-shot actions. Wrap in your own <section>. */
export function Cards({ cards }: { cards: ToolCard[] }) {
  const tool = useBench((s) => s.tool);
  const setTool = useBench((s) => s.setTool);
  return (
    <>
      {cards.map((c) => {
        const on = c.active ?? (c.tool !== undefined && tool === c.tool);
        return (
          <button
            key={c.code + c.name}
            className={`fixture-card${on ? ' active' : ''}`}
            disabled={c.disabled}
            aria-pressed={c.tool !== undefined || c.active !== undefined ? on : undefined}
            onClick={() => (c.onClick ? c.onClick() : c.tool && setTool(c.tool))}
          >
            <span className="code">{c.code}</span>
            <span className="body">
              <span className="name">
                {c.name} {c.key && <kbd>{c.key.toUpperCase()}</kbd>}
              </span>
              <span className="tag">{c.tag}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}

/** Power roll-up cards from the built schedule (the bottom of a Data tab). */
export function PowerRoll({ report }: { report: ScheduleReport | null }) {
  if (!report) return null;
  return (
    <div className="roll">
      {report.power.map((g) => (
        <div className="power" key={g.volts}>
          <div className="big">
            {g.volts} V<span>{g.px} px</span>
          </div>
          <dl>
            <dt>Universes</dt>
            <dd>{report.totals.universes}</dd>
            <dt>Max draw</dt>
            <dd>
              {g.watts.toFixed(1)} W · {g.amps.toFixed(2)} A
            </dd>
            <dt>Inject every</dt>
            <dd>{g.injections > 1 ? `${Math.ceil(g.px / g.injections)} px (${g.injections} points)` : 'one feed at the controller'}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

/** Patch range for a schedule unit, from the built report: "1/1–1/57". Empty while building. */
export function patchOf(report: ScheduleReport | null, unit: string): string {
  const row = report?.rows.find((r) => r.unit === unit);
  return row ? `${formatAddress(row.start)}–${formatAddress(row.end)}` : '';
}
