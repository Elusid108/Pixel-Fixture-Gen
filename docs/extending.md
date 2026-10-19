# Extending Pixel Fixture Gen

How to add a catalogue fixture or a Workbench system. Concept rows (pixels, counts, story) are in [roadmap.md](roadmap.md).

## Ground rules

- Geometry is [manifold-3d](https://github.com/elalish/manifold) through `Geo` (`src/geom/geo.ts`), in mm, Z-up. Every part must come out manifold. `npm run check:geom` enforces that.
- Model each part in its **print orientation** resting on z=0. Its `instances` place the printed copies in the assembled fixture, and qty is `instances.length`. Use `layFlat` (`src/fixtures/util.ts`) when it's easier to model in place and lay down afterwards.
- Pixels are emitted **in data order**, at the point where their light reads (the diffuser face). `computeSchedule` patches them in that order.
- Pixel sockets come from `socketCutter` (`src/pixels/sockets.ts`), so the fit coupon proves them. Pixel types live in `src/pixels/library.ts`.
- The vector kit is `src/geom/vec.ts`; `src/geom/mat.ts` has matrix helpers (`T`, `Rx`, `Ry`, `Rz`, `mul`, `apply`).
- Identical parts should print as one part ×N. `src/graph/dedupe.ts` has `matchSockets` (same part up to rotation) and `cluster1D` (lengths within tolerance).

## Fit: every part must assemble straight off the printer

The exported 3MF is the product. Every mating pair must be modelled with its clearance, so parts go together without sanding.

- Spread `FIT_PARAMS` (`src/fit.ts`) into every fixture's and every Workbench module's params. The host fills `fit` and `seat` from the header, or from the fixture's override in the Fit group, and records both in the 3MF.
- **Fit gap** (`fitOf(params)`, default 0.4 mm) is the **total** gap between mating printed parts. Use `sideOf(params)` (half the gap) per side:
  - round fits (spigot in socket, pin in hole, sleeve over can): female diameter = male diameter + fit
  - prismatic fits (dovetail in slot, key in pocket, tab in slot, panel in groove): female width = male width + fit, and depth + fit/2 where the male bottoms out
  - sliding fits (shutters, gel frames, rails): the fit gap on each sliding face pair
  - press or snap fits that need interference: model the snap on top of the gap, and say so in a note
- **Seat clearance** (`seatOf(params)`, default 0.15 mm) is the radial clearance around a pixel in its socket. Pass it as `tol` to `socketCutter`.
- Hardware (heat-set inserts, magnets, screws, filament pins) keeps its own published hole sizes. Those are not part-to-part fits.
- Don't add per-fixture `tol` or `clearance` params; the Fit group replaces them.
- Return `assembly` steps in build order: title, the part ids involved, hardware and a note. They appear in the Parts tab.
- `check:geom` builds every fit-aware fixture at fit 0.2 and 0.8. Both must stay manifold.

## A catalogue fixture

1. Add `src/fixtures/<series>/<name>.ts` exporting a `FixtureDef` (see `swatchbook.ts`, `fresnel.ts`, `hive.ts`).
2. Register it in your series file only: `series-s.ts`, `series-l.ts` or `series-m.ts`. Move its row from `*_PLANNED` to `*_FIXTURES`. `registry.ts` just concatenates the series files.
3. Params:
   - `number` / `select` / `boolean` / `pixel` show in the inspector.
   - `image` is a user picture. Decode it with `decodeImage` and sample it with `sampleImage` from `src/fixtures/image.ts`. `''` means use a built-in default (make one with `imageFrom`).
   - To size parts to the user's bed, declare `{ key: 'printer', type: 'select', hidden: true, … }`. The app fills in the header printer, and `getPrinter(str(params, 'printer'))` gives you the bed.
4. `check:geom` picks it up automatically (defaults, every option, all-min, all-max). Defaults must fit a 256 mm bed, unless the fixture auto-splits to the printer. A fixture with the hidden `printer` param must also fit each `printer=…` variant.
5. Oversize parts: `splitToBed(g, solid, printer, opts)` in `src/geom/split.ts` cuts a print-oriented solid into keyed pieces that fit the bed (grid cuts, or radial arcs for rings) and returns per-piece instances; `splitParts` turns that into PartSpecs on top of your own instances. `src/fixtures/l/common.ts` has the shared `SPLIT_PARAMS` (auto-split, joint, pins, printer).

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
