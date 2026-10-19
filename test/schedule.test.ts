import { describe, expect, it } from 'vitest';
import { computeSchedule, gaugeFor, psuFor } from '../src/schedule/schedule';
import { scheduleCsv } from '../src/schedule/csv';
import type { PixelPlacement } from '../src/types';

const line = (px: number, pixelId = 'node-12-bullet', unit = 'U1') => ({ unit, position: 'p', purpose: 'q', pixelId, units: px, px });
const row = (n: number, gap: number, unit = 'U1'): PixelPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ pos: [i * gap, 0, 0], normal: [0, 0, 1], unit }));

describe('instrument schedule', () => {
  it('packs RGB pixels 170 to a universe without splitting a pixel', () => {
    const r = computeSchedule([line(180)], row(180, 30), []);
    expect(r.totals.channels).toBe(540);
    expect(r.totals.universes).toBe(2);
    expect(r.rows[0].start).toEqual({ universe: 1, channel: 1 });
    // 170 px fill 1/510; pixel 171 starts universe 2 rather than straddling 511–513.
    expect(r.rows[0].end).toEqual({ universe: 2, channel: 30 });
  });

  it('packs RGBW pixels 128 to a universe', () => {
    const r = computeSchedule([line(129, 'pcb-9-sk6812-rgbw')], [], []);
    expect(r.totals.universes).toBe(2);
    expect(r.rows[0].end).toEqual({ universe: 2, channel: 4 });
  });

  it('continues addressing across rows', () => {
    const r = computeSchedule([line(24, 'ring-24-ws2812b', 'A'), line(7, 'jewel-7-ws2812b', 'B')], [], []);
    expect(r.rows[1].start).toEqual({ universe: 1, channel: 73 });
    expect(r.totals.px).toBe(31);
  });

  it('sizes power with the 80% rule and picks injection points', () => {
    const r = computeSchedule([line(180)], row(180, 30), []);
    const g = r.power[0];
    expect(g.watts).toBeCloseTo(54);
    expect(g.amps).toBeCloseTo(10.8);
    expect(g.psuW).toBe(75); // 54 / 0.8 = 67.5 → 75 W
    expect(g.injections).toBe(3);
    expect(psuFor(9.3)).toBe(15);
    expect(gaugeFor(1.9)).toBe('24 AWG');
    expect(gaugeFor(10.8)).toBe('14 AWG');
  });

  it('flags node spacing longer than the factory lead', () => {
    const ok = computeSchedule([line(5)], row(5, 90), []);
    expect(ok.checks.some((c) => c.level === 'ok' && c.text.includes('inside the 100 mm lead'))).toBe(true);
    const bad = computeSchedule([line(5)], row(5, 140), []);
    expect(bad.checks.some((c) => c.level === 'warn' && c.text.includes('140 mm'))).toBe(true);
  });

  it('reports strand counts and spares', () => {
    const r = computeSchedule([line(180)], [], []);
    expect(r.checks.some((c) => c.text.includes('4 strands of 50, 20 spare'))).toBe(true);
  });

  it('warns on enclosed heat density', () => {
    const r = computeSchedule([line(31, 'pcb-9-ws2812b')], [], [], { enclosureCm3: 500 });
    expect(r.checks.some((c) => c.level === 'warn' && c.text.includes('PETG'))).toBe(true);
  });

  it('exports CSV with quoted cells', () => {
    const r = computeSchedule([{ ...line(3), notes: 'has, comma' }], [], [{ item: 'Magnet', qty: 12 }]);
    const csv = scheduleCsv(r, 'Test');
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('1/001,1/009');
    expect(csv).toContain('Magnet,12');
  });
});
