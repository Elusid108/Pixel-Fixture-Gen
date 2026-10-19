/**
 * `npm run check:geom` — build every fixture at its defaults, at every numeric min and max,
 * and at every select/pixel option. Fails on any non-manifold or empty part, and on
 * default builds that don't fit a 256 mm bed.
 *
 * Workbench systems build every preset the same way: defaults, each select/pixel option,
 * a small printer (forces strut splits) and all-min / all-max. Fit is checked against the
 * printer each variant targets, so split tubes must come out short enough for it.
 */
import { runBuild } from '../build/runBuild';
import { FIXTURES } from '../fixtures/registry';
import { PRESETS, SN_PARAMS } from '../modules/strut-node';
import { boundsFit, getPrinter } from '../printers';
import type { Params } from '../types';
import { loadManifold } from './manifold';

const wasm = await loadManifold();
const printer = getPrinter('bambu-256');
let failures = 0;

for (const def of FIXTURES) {
  const variants: [string, Params][] = [['defaults', {}]];
  const mins: Params = {};
  const maxs: Params = {};
  for (const s of def.params) {
    if (s.type === 'number') {
      mins[s.key] = s.min ?? s.default;
      maxs[s.key] = s.max ?? s.default;
    }
    const options = s.type === 'pixel' ? s.pixels : s.type === 'select' ? s.options?.map((o) => o.value) : s.type === 'boolean' ? [true, false] : [];
    for (const o of options ?? []) if (o !== s.default) variants.push([`${s.key}=${o}`, { [s.key]: o }]);
  }
  variants.push(['all min', mins], ['all max', maxs]);

  for (const [label, params] of variants) {
    try {
      const r = runBuild(wasm, def.id, params);
      const misfits = label === 'defaults' ? r.parts.filter((p) => !boundsFit(p.bounds, printer)).map((p) => p.name) : [];
      const bad = r.errors.length > 0 || misfits.length > 0;
      if (bad) failures++;
      const tris = r.parts.reduce((s, p) => s + p.triangles * p.instances.length, 0);
      console.log(
        `${bad ? 'FAIL' : ' ok '} ${def.code.padEnd(3)} ${label.padEnd(28)} ${String(r.parts.length).padStart(2)} parts ${String(r.report.totals.px).padStart(4)} px ${String(tris).padStart(7)} tris ${r.ms.toFixed(0).padStart(5)} ms`,
      );
      for (const e of r.errors) console.log(`       ${e}`);
      for (const m of misfits) console.log(`       does not fit ${printer.name}: ${m}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${def.code.padEnd(3)} ${label.padEnd(28)} threw: ${(e as Error).message}`);
    }
  }
}

/* ---- Workbench: M4 Strut & Node, every preset ---- */
for (const preset of PRESETS) {
  const made = preset.make();
  const design = JSON.stringify(made);
  const small = made.nodes.length <= 12;
  const variants: [string, Params][] = [['defaults', {}]];
  const mins: Params = {};
  const maxs: Params = {};
  for (const s of SN_PARAMS) {
    if (s.type === 'number') {
      mins[s.key] = s.min ?? s.default;
      maxs[s.key] = s.max ?? s.default;
    }
    if (s.hidden) continue;
    const options = s.type === 'pixel' ? s.pixels : s.type === 'select' ? s.options?.map((o) => o.value) : [];
    for (const o of options ?? []) {
      // Unique engraving makes every hub its own part; keep that to the smaller presets.
      if (o === s.default || (o === 'ids' && !small)) continue;
      variants.push([`${s.key}=${o}`, { [s.key]: o }]);
    }
  }
  variants.push(['printer=bambu-a1mini', { printer: 'bambu-a1mini' }], ['all min', mins], ['all max', maxs]);

  for (const [label, given] of variants) {
    const params: Params = { ...given, design };
    const target = getPrinter(String(params.printer ?? 'bambu-256'));
    const name = `${preset.id} ${label}`;
    try {
      const r = runBuild(wasm, 'strut-node', params);
      const misfits = label.startsWith('all') ? [] : r.parts.filter((p) => !boundsFit(p.bounds, target)).map((p) => p.name);
      const empty = r.parts.length === 0 || r.pixels.length === 0;
      const bad = r.errors.length > 0 || misfits.length > 0 || empty;
      if (bad) failures++;
      const tris = r.parts.reduce((s, p) => s + p.triangles * p.instances.length, 0);
      const copies = r.parts.reduce((s, p) => s + p.instances.length, 0);
      console.log(
        `${bad ? 'FAIL' : ' ok '} M4  ${name.padEnd(34)} ${String(r.parts.length).padStart(2)} parts ${String(copies).padStart(4)} prints ${String(r.report.totals.px).padStart(4)} px ${String(tris).padStart(8)} tris ${r.ms.toFixed(0).padStart(5)} ms`,
      );
      for (const e of r.errors) console.log(`       ${e}`);
      if (empty) console.log('       no parts or no pixels');
      for (const m of misfits) console.log(`       does not fit ${target.name}: ${m}`);
    } catch (e) {
      failures++;
      console.log(`FAIL M4  ${name.padEnd(34)} threw: ${(e as Error).message}`);
    }
  }
}

if (failures) {
  console.error(`\n${failures} failing build(s).`);
  process.exit(1);
}
console.log('\nAll fixtures and workbench presets build clean.');
