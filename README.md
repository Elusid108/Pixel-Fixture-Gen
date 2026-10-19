# Pixel Fixture Gen

Printable LED pixel fixtures, generated in the browser. Pick a fixture, set its parameters and pixel type, and get print-ready multi-part 3MF files plus an instrument schedule. The schedule covers pixel form, count, DMX patch, power, PSU, injection points, wire gauge and hardware.

The full concept catalogue (8 single-bed fixtures, 6 large assemblies, 7 modular systems) and the roadmap are in [docs/roadmap.md](docs/roadmap.md). The original concept sheets are in [concepts/](concepts/).

## Built so far

| Code | Fixture | Pixels |
|---|---|---|
| S1 | **Swatchbook**: leaves fan on a hollow post. Fan it to chase, close it to mix like stacked gels. | 12× Ø9.5 mm pixel PCB |
| S2 | **Fresnel**: computed stepped lens, colour-frame guides, gel frames, four-leaf barn doors, yoke and stand | 24-px ring + 7-px jewel |
| M1 | **Hive tile**: shell, carrier, honeycomb baffle and diffuser. Magnets, bowtie keys and wire notches on all six edges. | 7 / 19 / 37× 12 mm bullet nodes |
| T0 | **Socket fit coupon**: any pixel socket at three engraved clearances. Print this first. | — |
| M4 | **Strut & Node** (Workbench): place hubs, connect struts, get every hub at its exact socket angles, split for support-free printing, engraved, and deduped into print counts. Presets: tetra, cube, octa, icosa, 2V dome, branching tree. | Strip (30/60/144 per m, WS2815) or 12 mm nodes per strut |

### Workbench: Strut & Node

Switch to **Workbench** in the header. Pick a preset or start empty, then use the tools (keys in brackets):

- **Hub (N)** places a hub on the work plane, snapped to the grid. With a hub selected, the new one is strutted to it.
- **Strut (C)** connects two hubs. Keep clicking to draw a chain.
- **Select (V)** drags hubs on the grid. Shift-drag changes height. Del removes the selection, and Ctrl+Z / Ctrl+Shift+Z undo and redo.
- **Order (O)** sets the data path: click struts in order, click the last one again to drop it, and shift-click to flip a strip. The greedy DFS suggestion fills in the rest from the controller hub.

What it generates:

- **Hubs**: a core sphere plus one spigot per strut, aimed down the exact strut vector. Sockets push out until neighbouring tubes clear, and anything tighter than the tube allows at the max offset is flagged. Each hub splits on the plane that keeps both halves under the overhang limit, with two Ø3 dowels and an M3 bolt and captive nut. Collars carry the hub ID and strut ID, wrapped around the cylinder.
- **Struts**: cut length = hub distance minus both socket offsets. A vase-mode diffuser tube goes over a spine with the strip recess (or node trough) on top and a wire channel underneath. The spine keys into slots in the spigots, so the strip always faces outward. Tubes taller than the printer split at spigot couplers. Dark struts are wire-only.
- **Paperwork**: pixels follow the data path, so the instrument schedule patches strut by strut. The Data & power tab lists every lit run and dark run.
- **Dedupe**: hubs that are rotations of each other (never mirror images) and struts within 0.3 mm print as one part ×N. Engraving type IDs (HA · SA) keeps that; unique IDs (H07 · S12) make every hub its own part.

## How it fits together

- `src/pixels/`: the pixel library (nodes, PCBs, rings, jewels, strip) and the shared socket cutters. Changing a pixel type re-flows the geometry and the schedule.
- `src/fixtures/`: one file per fixture. Each `build()` returns parts (modelled in print orientation, with assembled-pose instances), pixel placements in data order, and schedule lines.
- `src/geom/`: a thin modelling vocabulary over [manifold-3d](https://github.com/elalish/manifold). Every part is guaranteed watertight.
- `src/schedule/`: the Lightwright-style schedule with patch, power roll-up, strand-lead and thermal checks, and CSV export.
- `src/export/`: plate packing per printer and the 3MF writer. Body, diffuser and baffle are material slots, and there is a plates mode and an assembly mode.
- `src/modules/strut-node/`: the M4 workbench system. `analyze.ts` covers socket aims, offsets, angle checks, cut lengths, dedupe and the hub split plan. `dataPath.ts` is the chain, `presets.ts` the starting shapes, `build.ts` the geometry. The analysis has no geometry kernel, so the bench and inspector use exactly what the worker builds.
- `src/ui/`: React + react-three-fiber. Builds run in a web worker. `Workbench*.tsx` is the modular builder.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run check:geom
```

`check:geom` builds every fixture at its defaults, at every min and max, and at every option. It fails on any non-manifold part. Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.
