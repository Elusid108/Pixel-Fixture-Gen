import { FORM_LABEL, getPixel, pixelSpec, type PixelType } from '../pixels/library';
import type { HardwareLine, PixelPlacement, ScheduleLine } from '../types';

/**
 * The instrument schedule: a Lightwright-style sheet for pixels.
 * Fixtures declare lines; everything derived (addresses, power, checks) is computed here.
 */

export interface Address {
  universe: number;
  channel: number;
}

export interface ScheduleRow {
  unit: string;
  position: string;
  purpose: string;
  form: string;
  pixelName: string;
  spec: string;
  qty: string;
  px: number;
  chPerPx: number;
  channels: number;
  start: Address;
  end: Address;
  volts: number;
  maxW: number;
  amps: number;
  notes: string;
}

export interface PowerGroup {
  volts: number;
  px: number;
  watts: number;
  amps: number;
  /** Next standard PSU size with the 80% continuous-load rule applied. */
  psuW: number;
  injections: number;
  /** Feed wire for a run of 2 m or less. */
  gauge: string;
}

export interface ScheduleCheck {
  level: 'ok' | 'warn' | 'info';
  text: string;
}

export interface ScheduleReport {
  rows: ScheduleRow[];
  totals: { px: number; channels: number; universes: number; watts: number };
  power: PowerGroup[];
  checks: ScheduleCheck[];
  hardware: HardwareLine[];
}

export const UNIVERSE_SIZE = 512;
const PSU_SIZES = [10, 15, 25, 36, 50, 60, 75, 100, 150, 200, 250, 300, 350, 400, 500, 600, 800, 1000];
/** Pixels per injection point before brightness sags visibly at full white. */
const INJECT_EVERY: Record<number, number> = { 5: 60, 12: 150, 24: 300 };
const GAUGE: [number, string][] = [
  [2, '24 AWG'],
  [3.5, '22 AWG'],
  [5, '20 AWG'],
  [7, '18 AWG'],
  [10, '16 AWG'],
  [15, '14 AWG'],
  [20, '12 AWG'],
  [30, '10 AWG'],
];
/** Thermal guideline for enclosed printed fixtures at full white. */
const PLA_W_PER_LITRE = 8;
/** WS281x protocol: 1.25 µs per bit, 24 bits per RGB pixel. */
const US_PER_PX = 30;

function qtyLabel(p: PixelType, line: ScheduleLine): string {
  switch (p.form) {
    case 'strip':
      return `${(line.units / 1000).toFixed(2)} m`;
    case 'node':
      return `${line.units} node${line.units === 1 ? '' : 's'}`;
    case 'pcb':
      return `${line.units} PCB${line.units === 1 ? '' : 's'}`;
    default:
      return `${line.units}×`;
  }
}

export function psuFor(watts: number): number {
  const need = watts / 0.8;
  return PSU_SIZES.find((s) => s >= need) ?? Math.ceil(need / 100) * 100;
}

export function gaugeFor(amps: number): string {
  return GAUGE.find(([a]) => amps <= a)?.[1] ?? 'split the feed';
}

function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function computeSchedule(
  lines: ScheduleLine[],
  pixels: PixelPlacement[],
  hardware: HardwareLine[],
  opts: { enclosureCm3?: number } = {},
): ScheduleReport {
  const rows: ScheduleRow[] = [];
  const checks: ScheduleCheck[] = [];
  let universe = 1;
  let channel = 1;

  for (const line of lines) {
    const p = getPixel(line.pixelId);
    let start: Address | null = null;
    let end: Address = { universe, channel };
    for (let i = 0; i < line.px; i++) {
      if (channel + p.chPerPx - 1 > UNIVERSE_SIZE) {
        universe++;
        channel = 1;
      }
      if (!start) start = { universe, channel };
      end = { universe, channel: channel + p.chPerPx - 1 };
      channel += p.chPerPx;
    }
    const maxW = line.px * p.wattsPerPx;
    rows.push({
      unit: line.unit,
      position: line.position,
      purpose: line.purpose,
      form: FORM_LABEL[p.form],
      pixelName: p.name,
      spec: pixelSpec(p),
      qty: qtyLabel(p, line),
      px: line.px,
      chPerPx: p.chPerPx,
      channels: line.px * p.chPerPx,
      start: start ?? end,
      end,
      volts: p.volts,
      maxW,
      amps: maxW / p.volts,
      notes: line.notes ?? '',
    });

    if (p.form === 'node' && p.strandLength) {
      const strands = Math.ceil(line.px / p.strandLength);
      const spare = strands * p.strandLength - line.px;
      checks.push({
        level: 'info',
        text: `${line.unit}: ${line.px} nodes → ${strands} strand${strands === 1 ? '' : 's'} of ${p.strandLength}${spare ? `, ${spare} spare (chain into the next fixture or cut and seal)` : ''}.`,
      });
    }

    if (p.leadLength) {
      const own = pixels.filter((px) => px.unit === line.unit);
      let worst = 0;
      for (let i = 1; i < own.length; i++) worst = Math.max(worst, dist(own[i - 1].pos, own[i].pos));
      if (own.length > 1) {
        checks.push(
          worst > p.leadLength
            ? {
                level: 'warn',
                text: `${line.unit}: node spacing reaches ${worst.toFixed(0)} mm but factory leads are ${p.leadLength} mm. Order longer leads or re-pitch.`,
              }
            : {
                level: 'ok',
                text: `${line.unit}: longest node-to-node run is ${worst.toFixed(0)} mm, inside the ${p.leadLength} mm lead.`,
              },
        );
      }
    }
  }

  const px = rows.reduce((s, r) => s + r.px, 0);
  const channels = rows.reduce((s, r) => s + r.channels, 0);
  const watts = rows.reduce((s, r) => s + r.maxW, 0);

  const byVolts = new Map<number, ScheduleRow[]>();
  for (const r of rows) byVolts.set(r.volts, [...(byVolts.get(r.volts) ?? []), r]);
  const power: PowerGroup[] = [...byVolts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([volts, rs]) => {
      const gpx = rs.reduce((s, r) => s + r.px, 0);
      const w = rs.reduce((s, r) => s + r.maxW, 0);
      const amps = w / volts;
      return {
        volts,
        px: gpx,
        watts: w,
        amps,
        psuW: psuFor(w),
        injections: Math.max(1, Math.ceil(gpx / (INJECT_EVERY[volts] ?? 60))),
        gauge: gaugeFor(amps),
      };
    });

  for (const g of power) {
    if (g.volts === 5 && g.amps > 10) {
      checks.push({
        level: 'warn',
        text: `${g.amps.toFixed(1)} A at 5 V. Consider 12 V pixels (WS2815/12 V nodes) to cut current and voltage drop.`,
      });
    }
  }

  if (opts.enclosureCm3 && opts.enclosureCm3 > 0) {
    const wpl = watts / (opts.enclosureCm3 / 1000);
    checks.push(
      wpl > PLA_W_PER_LITRE
        ? {
            level: 'warn',
            text: `${wpl.toFixed(1)} W per litre enclosed at full white. Print the enclosure in PETG or ASA, or set WLED's brightness limiter (ABL).`,
          }
        : { level: 'ok', text: `${wpl.toFixed(1)} W per litre enclosed. PLA is fine.` },
    );
  }

  if (px > 0) {
    const fps = Math.min(Math.floor(1e6 / (px * US_PER_PX + 300)), 250);
    checks.push({
      level: px > 800 ? 'warn' : 'info',
      text: `One data line refreshes ${px} px at about ${fps} fps${px > 800 ? '. Split across outputs for smooth chases.' : '.'}`,
    });
  }

  return {
    rows,
    totals: { px, channels, universes: rows.length ? rows[rows.length - 1].end.universe : 0, watts },
    power,
    checks,
    hardware,
  };
}

export function formatAddress(a: Address): string {
  return `${a.universe}/${String(a.channel).padStart(3, '0')}`;
}
