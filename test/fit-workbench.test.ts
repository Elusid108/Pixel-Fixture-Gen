import type { ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/runBuild';
import { declaresFit } from '../src/fit';
import { getFixture } from '../src/fixtures/registry';
import { loadManifold } from '../src/geom/manifold';
import { csDims, csParams } from '../src/modules/column-stack/params';
import { fwDims, fwParams } from '../src/modules/facet-wall/params';
import { HIVE_POCKET } from '../src/modules/hive-wall/build';
import { hwDims } from '../src/modules/hive-wall/layout';
import { linDims, lineaParams } from '../src/modules/linea/params';
import { keyOutline, keyPocket } from '../src/modules/linea/profile';
import { instDims } from '../src/modules/mini-rig/instruments';
import { rigDims, rigParams } from '../src/modules/mini-rig/params';
import { pcDims, PIN_PRESS } from '../src/modules/pixel-chain/dims';
import { pcParams } from '../src/modules/pixel-chain/plan';
import { buildParamsWith } from '../src/modules/shared/params';
import { snDims } from '../src/modules/strut-node/params';
import { snParams } from '../src/modules/strut-node/plan';
import { SYSTEM_CORES } from '../src/workbench/cores';

/**
 * Every Workbench system models its mating printed parts with the global fit gap: a female
 * feature is the male feature plus the gap (round fits across the diameter, prismatic fits across
 * the width, plus half the gap where the male bottoms out). Each check runs at two gaps, so a
 * feature that ignores the setting fails.
 */

const FITS = [0.2, 0.8];
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('Workbench fit: every system declares the fit params', () => {
  it('spreads FIT_PARAMS into each module and drops its own clearance params', () => {
    for (const core of SYSTEM_CORES) {
      const def = getFixture(core.moduleId);
      expect(declaresFit(def), core.id).toBe(true);
      const keys = def.params.map((p) => p.key);
      for (const old of ['tol', 'gap', 'snapFit']) expect(keys, `${core.id} still has ${old}`).not.toContain(old);
      for (const k of ['fit', 'seat']) expect(def.params.find((p) => p.key === k)?.hidden, `${core.id}.${k}`).toBe(true);
    }
  });

  it("leaves fit and seat to the host unless the system overrides them", () => {
    for (const core of SYSTEM_CORES) {
      const specs = getFixture(core.moduleId).params;
      const plain = buildParamsWith(specs, core.empty(), {}, 'bambu-256');
      expect(plain.fit, core.id).toBeUndefined();
      expect(plain.seat, core.id).toBeUndefined();
      const own = core.buildParams(core.empty(), { fit: 0.3 }, 'bambu-256');
      expect(own.fit, core.id).toBe(0.3);
      expect(own.seat, core.id).toBeUndefined();
    }
  });
});

describe('Workbench fit: female = male + fit', () => {
  it('M4 Strut & Node: tube over spigot, coupler, spine slot, dowel holes', () => {
    const seen: number[] = [];
    for (const fit of FITS) {
      const d = snDims(snParams({ fit }));
      close(2 * d.tubeIR - 2 * d.spigR, fit);
      close(2 * d.tubeIR - 2 * d.coupler.plugR, fit);
      close(2 * d.pinR, 3 + fit);
      // Spine key: the slot is the spine section plus the gap, and it stops half a gap short of each slot floor.
      close(d.keyGap, fit / 2);
      seen.push(d.spigR);
    }
    expect(seen[0]).toBeGreaterThan(seen[1]);
  });

  it('M1 Hive wall: tile seams, bowtie keys, stacked layers and rail studs', () => {
    for (const fit of FITS) {
      const d = hwDims({ fit });
      close(d.gap, fit);
      close(d.D - 2 * d.A, fit);
    }
  });

  it('M2 Linea: key pockets, cover legs, part ends at each seam', () => {
    const pockets: number[] = [];
    for (const fit of FITS) {
      const D = linDims(lineaParams({ fit }));
      // Key pocket at a seam: neck and wide ends are the key plus the gap, and half a gap deeper.
      const key = keyOutline(D);
      const pocket = keyPocket(D, 0, 1, 0);
      const keyNeck = key[4][1] - key[1][1];
      const pocketNeck = pocket[4][1] - pocket[1][1];
      close(pocketNeck - keyNeck, fit);
      const keyLen = key[2][0];
      const pocketLen = pocket[2][0];
      close(pocketLen - keyLen, fit / 2);
      close(D.key.pocket - D.key.thick, fit / 2);
      // Cover legs to channel walls and part ends to the seam: half the gap each side.
      close(2 * D.clr, fit);
      // The diffuser barb snaps a fixed amount past the wall on top of the gap.
      close(D.barb - D.clr, D.snap);
      pockets.push(pocketNeck);
    }
    expect(pockets[1] - pockets[0]).toBeCloseTo(FITS[1] - FITS[0], 6);
  });

  it('M3 Mini Rig: chord couplers, snap clamps, yokes, batten diffuser', () => {
    for (const fit of FITS) {
      const d = rigDims(rigParams({ fit }));
      close(2 * d.sockR - 2 * d.couplerR, fit);
      close(2 * d.sockDepth - d.couplerLen, fit);
      const par = instDims('par', d);
      close(2 * par.clampRi - d.chordD, fit);
      close(par.yokeWi - 2 * (par.par!.R + 1.5), fit);
      const bat = instDims('batten', d).batten!;
      close(bat.grooveW - bat.diffW, fit);
      close(bat.grooveH - bat.diffT, fit);
    }
  });

  it('M5 Facet Wall: facet and tile seams, snap barbs', () => {
    for (const fit of FITS) {
      const d = fwDims(fwParams({ fit }));
      close(2 * d.facetGap, fit);
      close(2 * d.tileGap, fit);
      close(2 * d.half, fit);
      expect(d.barb).toBeGreaterThan(d.half);
    }
  });

  it('M6 Column Stack: spigot in socket, carrier discs and ridge', () => {
    const rs: number[] = [];
    for (const fit of FITS) {
      const d = csDims(csParams({ fit }));
      close(2 * d.Ri - 2 * d.rs, fit);
      close(d.ridgeZ - (d.J + d.carrierT), fit / 2);
      rs.push(d.rs);
    }
    expect(rs[0] - rs[1]).toBeCloseTo((FITS[1] - FITS[0]) / 2, 6);
  });

  it('M7 Pixel Chain: knuckle between the cheeks, printed pin in the knuckle and cheeks', () => {
    for (const fit of FITS) {
      const d = pcDims(pcParams({ fit, hinge: 'printed' }));
      close(2 * d.yc0 - d.tK, fit);
      close(2 * d.holeK - 2 * d.pin.r, fit);
      close(d.holeC, d.pin.r + fit / 2 - PIN_PRESS);
      // A 1.75 mm filament pin is hardware: its holes don't follow the fit gap.
      const f = pcDims(pcParams({ fit, hinge: 'filament' }));
      close(f.holeK, 0.875 + 0.15);
    }
  });

  it('pixel seats follow the seat clearance, not the fit gap', () => {
    for (const seat of [0.1, 0.35]) {
      expect(csDims(csParams({ seat, fit: 0.6 })).tol).toBe(seat);
      expect(linDims(lineaParams({ seat })).seatW - linDims(lineaParams({ seat: 0 })).seatW).toBeCloseTo(2 * seat, 6);
      expect(pcDims(pcParams({ seat })).rBore - pcDims(pcParams({ seat: 0 })).rBore).toBeCloseTo(seat, 6);
    }
  });
});

describe('Workbench fit: built geometry', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    wasm = await loadManifold();
  });

  const hivePreset = () => JSON.stringify(SYSTEM_CORES.find((c) => c.id === 'hive-wall')!.presets[0].make());

  it('M1 Hive wall: layers are the fit gap smaller than the shell, keys half a gap thinner than their pockets', () => {
    const across: number[] = [];
    for (const fit of FITS) {
      const r = runBuild(wasm, 'hive-wall', { design: hivePreset(), fit });
      expect(r.errors).toEqual([]);
      const d = hwDims({ fit });
      const span = (id: string, axis: number) => {
        const b = r.parts.find((p) => p.id === id)!.bounds;
        return b.max[axis] - b.min[axis];
      };
      // Flat-top hexes: across the flats is along Y. The shell's inner hex is 2·Ai.
      for (const id of ['carrier', 'baffle', 'diffuser']) expect(span(id, 1)).toBeCloseTo(2 * d.Ai - fit, 3);
      expect(span('bowtie', 2)).toBeCloseTo(HIVE_POCKET.depth - fit / 2, 3);
      // Pocket to pocket across a seam is 2·len + seam; the key is that less the gap.
      expect(span('bowtie', 1)).toBeCloseTo(2 * HIVE_POCKET.len + d.gap - fit, 3);
      across.push(span('carrier', 1));
    }
    expect(across[0] - across[1]).toBeCloseTo(FITS[1] - FITS[0], 3);
  });

  it('every system returns assembly steps that name its built parts', () => {
    for (const core of SYSTEM_CORES) {
      const design = JSON.stringify(core.presets[0].make());
      const r = runBuild(wasm, core.moduleId, { design });
      expect(r.errors, core.id).toEqual([]);
      expect(r.assembly.length, core.id).toBeGreaterThanOrEqual(2);
      const ids = new Set(r.parts.map((p) => p.id));
      const used = new Set<string>();
      for (const s of r.assembly) {
        expect(s.title, core.id).toBeTruthy();
        for (const id of s.parts ?? []) {
          expect(ids.has(id), `${core.id}: step "${s.title}" names ${id}`).toBe(true);
          used.add(id);
        }
      }
      // Every printed part goes in somewhere.
      for (const id of ids) expect(used.has(id), `${core.id}: ${id} is in no assembly step`).toBe(true);
    }
  }, 60000);
});
