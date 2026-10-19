import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { runBuild } from '../src/build/runBuild';
import { packPlates } from '../src/export/plates';
import { build3mf, to3mfTransform } from '../src/export/threemf';
import { hiveCells } from '../src/fixtures/hive';
import { loadManifold } from '../src/geom/manifold';
import { mul, T, Rz } from '../src/geom/mat';
import { getPrinter } from '../src/printers';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

const count = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;

describe('3MF export', () => {
  it('writes one object per unique part and one build item per printed copy', async () => {
    const r = runBuild(wasm, 'swatchbook', { numbers: false, leaves: 8 });
    const printer = getPrinter('bambu-256');
    const plates = packPlates(
      r.parts.map((p) => ({ id: p.id, bounds: p.bounds, count: p.instances.length })),
      printer,
    );
    const bytes = await build3mf({ title: 'Swatchbook', parts: r.parts, mode: 'plates', plates, printer });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']));
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(count(xml, 'object')).toBe(r.parts.length);
    expect(count(xml, 'item')).toBe(r.parts.reduce((s, p) => s + p.instances.length, 0));
    expect(count(xml, 'base')).toBe(3);
    expect(xml).toContain('name="Leaf" pid="1" pindex="1"');
  });

  it('exports the assembly as one multi-part component object', async () => {
    const r = runBuild(wasm, 'hive');
    const xml = await (await JSZip.loadAsync(await build3mf({ title: 'Hive', parts: r.parts, mode: 'assembly' })))
      .file('3D/3dmodel.model')!
      .async('string');
    expect(count(xml, 'object')).toBe(r.parts.length + 1);
    expect(count(xml, 'component')).toBe(r.parts.reduce((s, p) => s + p.instances.length, 0));
    expect(count(xml, 'item')).toBe(1);
  });

  it('converts column-major matrices to 3MF row-vector order', () => {
    expect(to3mfTransform(T(1, 2, 3))).toBe('1 0 0 0 1 0 0 0 1 1 2 3');
    const m = to3mfTransform(mul(T(5, 0, 0), Rz(90)));
    expect(m).toBe('0 1 0 -1 0 0 0 0 1 5 0 0');
  });
});

describe('plates', () => {
  it('splits onto more plates when the bed is small, and flags parts that never fit', () => {
    const big = { min: [0, 0, 0] as [number, number, number], max: [120, 120, 10] as [number, number, number] };
    const huge = { min: [0, 0, 0] as [number, number, number], max: [400, 50, 10] as [number, number, number] };
    const mini = packPlates([{ id: 'a', bounds: big, count: 4 }], getPrinter('bambu-a1mini'));
    expect(mini.length).toBe(4);
    const x1 = packPlates([{ id: 'a', bounds: big, count: 4 }], getPrinter('bambu-256'));
    expect(x1.length).toBe(1);
    const over = packPlates([{ id: 'h', bounds: huge, count: 1 }], getPrinter('bambu-256'));
    expect(over[0].items[0].oversize).toBe(true);
  });
});

describe('fixtures', () => {
  it('orders Hive cells serpentine so every hop is one pitch', () => {
    const cells = hiveCells(2, 30);
    expect(cells.length).toBe(19);
    for (let i = 1; i < cells.length; i++) {
      const d = Math.hypot(cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]);
      expect(d).toBeCloseTo(30, 5);
    }
  });

  it('every default fixture builds manifold and schedules its pixels', () => {
    for (const id of ['swatchbook', 'fresnel', 'hive']) {
      const r = runBuild(wasm, id);
      expect(r.errors).toEqual([]);
      expect(r.pixels.length).toBe(r.report.totals.px);
    }
  });
});
