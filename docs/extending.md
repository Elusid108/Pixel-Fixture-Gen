# Extending Pixel Fixture Gen

How to add a catalogue fixture or a Workbench system. Concept rows (pixels, counts, story) are in [roadmap.md](roadmap.md).

## Ground rules

- Geometry is [manifold-3d](https://github.com/elalish/manifold) through `Geo` (`src/geom/geo.ts`), in mm, Z-up. Every part must come out manifold. `npm run check:geom` enforces that.
- Model each part in its **print orientation** resting on z=0. Its `instances` place the printed copies in the assembled fixture, and qty is `instances.length`. Use `layFlat` (`src/fixtures/util.ts`) when it's easier to model in place and lay down afterwards.
- Pixels are emitted **in data order**, at the point where their light reads (the diffuser face). `computeSchedule` patches them in that order.
- Pixel sockets come from `socketCutter` (`src/pixels/sockets.ts`), so the fit coupon proves them. Pixel types live in `src/pixels/library.ts`.
- The vector kit is `src/geom/vec.ts`; `src/geom/mat.ts` has matrix helpers (`T`, `Rx`, `Ry`, `Rz`, `mul`, `apply`).
- Identical parts should print as one part ×N. `src/graph/dedupe.ts` has `matchSockets` (same part up to rotation) and `cluster1D` (lengths within tolerance).

## A catalogue fixture

1. Add `src/fixtures/<series>/<name>.ts` exporting a `FixtureDef` (see `swatchbook.ts`, `fresnel.ts`, `hive.ts`).
2. Register it in your series file only: `series-s.ts`, `series-l.ts` or `series-m.ts`. Move its row from `*_PLANNED` to `*_FIXTURES`. `registry.ts` just concatenates the series files.
3. Params:
   - `number` / `select` / `boolean` / `pixel` show in the inspector.
   - `image` is a user picture. Decode it with `decodeImage` and sample it with `sampleImage` from `src/fixtures/image.ts`. `''` means use a built-in default (make one with `imageFrom`).
   - To size parts to the user's bed, declare `{ key: 'printer', type: 'select', hidden: true, … }`. The app fills in the header printer, and `getPrinter(str(params, 'printer'))` gives you the bed.
4. `check:geom` picks it up automatically (defaults, every option, all-min, all-max). Defaults must fit a 256 mm bed, unless the fixture auto-splits to the printer.

## A Workbench system

A system has a **pure half** and a **React half**:

| Piece | Where | What |
|---|---|---|
| `SystemCore<D>` | `src/modules/<sys>/system.ts` | Design type, `parse`/`empty`, presets, `buildParams`, `frame`, `remove`, sketch adapters. No React or three.js. |
| Module build | `src/modules/<sys>/build.ts` | A `FixtureDef` with a `design` json param (plus a hidden `printer` param). It turns the design into parts, pixels and schedule. |
| `SystemUI` | `src/modules/<sys>/ui/index.ts` | Tools, `Scene` (handles and overlays in the shared canvas), `Palette`, `Inspector`, optional `Data`, and `usePixelSize`. |

Register the system in three lists: `src/modules/index.ts` (`MODULES`), `src/workbench/cores.ts` (`SYSTEM_CORES`; remove it from `PLANNED_SYSTEMS`) and `src/workbench/uis.ts` (`SYSTEM_UIS`).

Then:
- The store (`src/workbench/store.ts`, `useBench`) keeps one design, param set and undo history per system. Edit by calling `useBench.getState().commit(newDesign, extra)`. `src/modules/strut-node/ui/useSn.ts` shows a typed facade with system actions.
- The shell (`src/ui/bench/*`) owns the canvas, camera, built parts, pixel preview, plates, toolbar, undo/redo, Delete (`core.remove`) and tool keys. `WorkPlane` turns clicks into snapped points. `toWorld`/`toLocal` convert Z-up mm to three's Y-up.
- **Sketch adapters** are how the drawing engine drives your system. The engine offers your system as a target for each adapter you implement:
  - `fromPaths(paths, design, params)`: open or closed polylines on a plane, for bars, chains and truss runs. Use `resample`, `cornerAngles` and `segments` from `src/sketch/geom.ts`.
  - `fromRegions(regions, design, params)`: outer loop plus holes in plane coords, for tile and facet fills. Use `pointInRegion`, `distToPolygon` and `bounds2`, and clip exactly in the worker build with `CrossSection.intersect`.
  - `fromPaths3D(paths, design, params)`: free 3D polylines, for wireframes.
  - Each adapter merges into the existing design and returns the new one.
- `check:geom` builds every preset of every registered system: defaults, each option, the A1 mini (to force splits), all-min and all-max. Every variant must fit its target printer and produce pixels.
