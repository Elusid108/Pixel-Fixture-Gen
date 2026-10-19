/**
 * `npm run check:geom` — build every fixture at its defaults, at every numeric min and max,
 * and at every select/pixel option. Fails on any non-manifold or empty part, and on
 * default builds that don't fit a 256 mm bed.
 */
import { runBuild } from '../build/runBuild';
import { FIXTURES } from '../fixtures/registry';
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

if (failures) {
  console.error(`\n${failures} failing build(s).`);
  process.exit(1);
}
console.log('\nAll fixtures build clean.');
