# Pixel Fixture Gen — concept catalogue & roadmap

## Context
The nine original concept sheets live in `concepts/` (honeycomb tile, linear bar, matrix tile, halo panel, iris, low-poly relief, lattice screen, sunburst fan, spiral tower). The goal is a browser app that turns fixture designs into printable parts plus the paperwork a lighting person expects. It needs three fixture families: single-bed, large multi-part assemblies such as centerpieces and chandeliers, and modular systems built on a workbench. Each fixture needs an **instrument schedule** that names its pixel form (node/strand, module, strip), count, size and power. The modular systems export a **multi-part 3MF**.

Portfolio context (chrismoore.me): The Orb, Pixel Louver Lights, the Pyramid matrix, WiFi VIP tables, Madrix/WLED/xLights-era pixel mapping, and browser tools LithoLab, BorderBuilder and TangiPix. BorderBuilder's stack (Vite + TS + three + jszip, GitHub Pages deploy, a `check:geom` self-check script) is the house pattern, so we follow it. TangiPix's "schematic + BOM" approach carries over to the paperwork.

---

## Part 1 — Concept catalog

Schedule shorthand: **px** = pixels, **ch** = DMX channels (RGB=3, RGBW=4), **W** = max draw at full white. Power assumptions: 5050/node ≈ 0.3 W/px, RGBW ≈ 0.4 W/px, 12 V 3-LED module ≈ 0.72 W/px. Universe = 170 RGB or 128 RGBW px.

### S-series: single-bed (fit 180 mm beds where noted, every one fits 256 mm)
| # | Fixture | Idea | Default schedule |
|---|---|---|---|
| S1 | **Swatchbook** | A Roscolux swatchbook made of light. 12 translucent leaves stack on a hollow pivot post; each leaf carries one pixel PCB in a cup behind its show face. The chase fans out like flipping gels. ESP32 sits in the spine. | 12× Ø9.5 mm pixel PCB (WS2812B; RGBW option) · 12 px · 36 ch · 3.6 W |
| S2 | **Fresnel** | Desk-scale Fresnel with a computed stepped-ring lens face in natural PETG, a vented can, yoke and mini C-clamp, and print-in-place barn doors. Rings ripple outward. | 1× 24-px ring (WS2812B, Ø66) + 1× 7-px jewel · 31 px · 93 ch · 9.3 W |
| S3 | **Leko Jr.** | 1:3 ERS with four sliding shutters and an A-size template slot. The app generates printable "gobo" plates (breakup, window, stars, custom SVG). It backlights the gobo rather than projecting it (no real optics), and we say so plainly. | 7-px jewel (gobo) + 8-px ring (lamp-cap glow) · 15 px · 45 ch · 4.5 W |
| S4 | **Scrim Box** | The scrim trick in a box. A printed 0.4 mm-thread mesh "scrim" sits in front of 3 parallax scene layers. Front-light pixels make the scrim opaque, and backlight pixels make it vanish to reveal the scene. | 8-px strip (front lip, 60/m) + 3 zones × 4-px strip behind layers · 20 px · 60 ch · 6 W |
| S5 | **Litho Relight** | Imports a LithoLab pack (reusing BorderBuilder's `litholabPack.ts` approach), frames it, and sets it over a baffled grid so the photo can be relit: sunrise sweep, candle, lightning. | 6×6 @ 33.3 mm, 30/m strip serpentine · 36 px · 108 ch · 10.8 W (alt 8×8 nodes) |
| S6 | **Louver Sconce** | Descendant of Pixel Louver Lights. Stacked angled louvers (15–45° param) form one pixel cell per gap, with independent up and down wash. | 10 cells + 3 up + 3 down, 60/m strip · 16 px · 48 ch · 4.8 W |
| S7 | **Moiré Lantern** | Two nested slotted shells (Ø150×200). Moving color between them creates walking moiré parallax as people pass, with no moving parts. | 1 m of 60/m strip spiralled on core · 60 px · 180 ch (1 univ.) · 18 W |
| S8 | **Contour** | Upload a heightmap (or pick a peak) to get 6–10 stacked topo bands. Each band is a diffused zone, and the default effect is "rising water". The app sizes node count per band by area. | ~32× 12 mm nodes (2–6 per band, auto) · 32 px · 96 ch · 9.6 W |

### L-series: large multi-piece (centerpieces + chandeliers; parts auto-split to the bed)
| # | Fixture | Idea | Default schedule |
|---|---|---|---|
| L1 | **The Orb** | Geodesic sphere (2V/3V/4V, Ø300–900) with one diffused panel per face. Identical faces are deduped into print counts ("A ×60, B ×120"). The top hub has an eyebolt and strain relief and brings power down the hoist line. | 3V full: 180× 12 mm nodes (4 strands of 50 → note 20-node remainder) · 180 px · 2 univ. · 54 W @5 V = 10.8 A, inject every 50 |
| L2 | **Cascade** | Rain chandelier. A segmented crown ring (dovetailed arcs) carries vase-mode diffuser drop tubes, with lengths set by a pattern: cone, wave, spiral, random. Tubes longer than the bed's Z split at spigot joints. | 24 tubes × 10 px (60/m) · 240 px · 2 univ. · 72 W → recommend WS2815 12 V |
| L3 | **Gasolier** | Classic chandelier. A lathe-profile column (baluster/urn/bobeche presets), 6/8/12 S-arms keyed to the hub, flame diffusers, and clear-PETG pendalogue drops. Default pixel is RGBWW, because RGB-only candle flicker reads as "fake". | 8 flames × 3 px + 7-px jewel down + 16-px ring up · 47 px · SK6812 RGBW · 188 ch · 19 W |
| L4 | **Armillary** | Interlocking great circles (equator, meridian, and the ecliptic at 23.4°), Ø500, each split into 4–6 keyed arcs with snap diffusers. A small geodesic "sun" hangs at the center. | 3 rings × 94 px (60/m, 1.57 m) + 19-px sun · 301 px · 2 univ. · 90 W → 12 V |
| L5 | **Bloom** | Table centerpiece: 3 tiers of keyed translucent petals (6/8/10) around a stamen cluster. Height is capped below the 14″ sightline rule. A battery base (2×18650 + ESP32) covers table service. The app estimates runtime from average level. | 24 petals × 1 node + 7 center · 31 px · 9.3 W max · ~10 h @20% avg |
| L6 | **Helix** | DNA pendant made of two helical ribbons with pixel-bar "base pair" rungs, stacked as 120 mm segments on a central rod up to 1.2 m. | 20 rungs × 3 px + 2 backbones × 20 px · 100 px · 30 W |

### M-series: modular systems (the Workbench)
| # | System | Components | Per-unit schedule |
|---|---|---|---|
| M1 | **Hive** (from concept 1) | Hex tiles in sizes S/M/L (7/19/37 cells), half tiles, edge trims, wall cleat rail, foot. Edges carry a printed bowtie key, 6×3 magnet pockets and a JST-SM pass-through notch. | M tile: 19× 12 mm nodes · 57 ch · 5.7 W |
| M2 | **Linea** (from concept 2) | Straights of 100/150/200/250 mm; corners at 30/45/60/90/120/135°; T, X, end caps, wall clips and aircraft-cable clips. Diffusers come in flat, dome or louvered profiles. Cell dividers lock to strip pitch. | 200 mm @60/m: 12 px · 3.6 W |
| M3 | **Mini Rig** (1:6) | 1:6 F34 box truss (48 mm square; sections of 0.5/1/1.5 m scale) with 2/3/4/6-way corners, base plates, pick points and mini chain hoists. Clip-on instruments: Fresnel (S2), Leko Jr (S3), PAR, static mover, 2-lite/4-lite blinder, batten. Wiring runs through hollow chords. **Build your rig on your desk.** | Per instrument (e.g. PAR: 7-px jewel · 2.1 W) |
| M4 | **Strut & Node** | Draw a wireframe on the bench. The app generates **each hub with its exact socket angles** and engraved labels (H07, "S12 – 240 mm"). Struts are vase-mode diffuser tubes over strip or nodes. | Per strut: length × strip density |
| M5 | **Facet Wall** (from concept 6) | Triangular backer tiles with snap-in facets at 3 depths. A painted gradient on the bench maps to depth. | 1 node / facet |
| M6 | **Column Stack** (from concept 9) | Base (PSU + controller bay), a segment library (helix dots, ring band, lattice, louver, pixel ring) and caps (dome, Fresnel cap, finial). Stacks can also hang as chandelier drops. | Per segment, e.g. ring band: 16 px |
| M7 | **Pixel Chain** | Hinged diffuser links, one pixel each, that drape in catenary garlands. Link pitch is checked against the strand lead length. | 1 node / link |

---

## Part 2 — App design

### Core idea: fixture × pixel library → parts + pixels + paperwork
- Every fixture is a **`FixtureDef`**: `build(params, pixelType) → { parts, pixels, ports }`. Geometry is parametric, so changing the pixel type swaps the socket geometry and re-flows the pitch.
- **`PixelType` library** (`src/pixels/`):
  - **Node** (12 mm bullet, 12 mm flat-back) with lead length.
  - **Module** (3-LED 12 V injection, 30/45 mm square, Ø9.5 pixel PCB).
  - **Strip** (30/60/144 per m; 5/10/12 mm; WS2815, FCOB).
  - **Ring/jewel/matrix PCBs** (7/8/12/16/24; 8×8, 16×16).
  - Each type carries IC, voltage, ch/px, W/px, dimensions and a **socket generator** that returns the clip or pocket geometry with a tolerance param.
- **`PixelPlacement`** stores position, normal, part and chain index. From these placements the app derives pixel maps, data order and the "magic sheet" plot.

### Instrument schedule (Lightwright-style)
Columns: **Unit · Part/Position · Purpose · Pixel form · Spec (IC/V/size/pitch) · Qty · ch/px · Channels · Univ/Addr · Max W · A @ V · Notes**.
The schedule ends with roll-ups:
- Total px, channels and universes.
- PSU recommendation at 80% derate.
- Injection points.
- Wire gauge for the run.
- **Strand-lead check**: is the node spacing at most the lead length?
- **Thermal warning**: high W per enclosed volume in PLA → suggest PETG/ASA.
- Hardware BOM: M3 heat-sets and SHCS, 6×3 magnets, JST-SM pigtails.

Exports: CSV, a printable sheet, and pixel maps for **xLights custom model (.xmodel)**, **WLED 2D `ledmap.json`**, and generic x/y/z CSV for Madrix and Resolume.

### Workbench (modular builder)
- **Left:** catalog by system.
- **Center:** three.js bench on a cutting-mat grid, using port-based snapping (each `ModuleDef` declares typed ports: position, orientation, gender, data in/out).
- **Right:** inspector with params and pixel type.
- **Bottom drawer tabs:**
  - **Schedule**
  - **Plates**: parts packed onto N beds for the chosen printer
  - **Data & Power**: chain order drawn on the model, universe splits, injection points
  - **Preview**: emissive pixels with bloom running chase, ripple and rainbow over the real pixel positions
- The assembly graph is walked from the controller port to set pixel order.

### Print + export pipeline
- **Geometry:** `manifold-3d` (WASM) handles booleans and extrude/revolve, which guarantees watertight meshes. three.js handles display only. Heavy builds run in a Web Worker.
- **Joints library:** dovetail arc keys, spigots, bowtie keys, magnet pockets, heat-set bosses, and labels engraved on parts.
- **Printer presets:** A1 mini 180, Bambu 256, MK4 250×210, Core One 250×220, Ender 220, H2D 350×320, XL 360. Oversized parts **auto-split** with a joint, and every part gets a print orientation and a bed-fit check.
- **3MF writer** (jszip + hand-written XML):
  - One named `<object>` per unique part, plus `<basematerials>` roles: body black, diffuser natural, baffle black.
  - Two modes: **Loose parts** packed per plate, or **Grouped** (a fixture's parts as `<components>`, so multi-material print-in-place diffusers import as one multi-part object).
  - Stretch: Bambu/Orca plate metadata (`Metadata/model_settings.config`).
- **Fit-test coupon:** a socket coupon at 3 tolerances for the chosen pixel type. Print it first.

### Stack + layout
Vite + TS + three (BorderBuilder pattern), React + react-three-fiber + zustand for the workbench UI, `manifold-3d`, jszip, vitest, and a GitHub Pages Action.
```
src/pixels/     library.ts, sockets.ts
src/geom/       manifold.ts, primitives.ts, joints.ts, split.ts, validate.ts, selfcheck.ts
src/fixtures/   <id>/index.ts  (S*, L*)
src/modules/    <system>/      (M*, with ports)
src/assembly/   graph.ts, snap.ts, dataPath.ts, power.ts
src/schedule/   schedule.ts, csv.ts, sheet.tsx
src/export/     threemf.ts, plates.ts, pixelmap/{xlights,wled,csv}.ts
src/ui/         Catalog, Workbench, Inspector, ScheduleTable, PlatesView, Preview
src/printers.ts
concepts/       existing 9 sheets + new SVG sheets for S/L/M series (same visual style)
```

### Decisions (from Q&A)
- **Flagship workbench system: M4 Strut & Node.**
- **Printers:** ship every preset with no strong default. The first run asks which printer you use and remembers it (localStorage, wrapped in try/catch). 3MF always carries material roles, and slicers without multi-material simply ignore them.
- **UI:** React + react-three-fiber + zustand on Vite + TS.
- **Phases 1–2 are built** (foundation + S1, S2, M1, T0). **Phase 3's Strut & Node half is built** (the Workbench plus M4 end to end). Port-based snapping for Hive and Linea, and phases 4–5, are next.

### Strut & Node design notes (Phase 3 flagship)
- **Bench:** place nodes in 3D (grid snap plus free drag) and drag to connect struts. Presets: tetra, cube, octa, icosa, 2V geodesic, branching tree.
- **Hub generator:** a core sphere plus one socket per incident strut, aimed along the exact strut vector.
  - Validates minimum inter-socket angle, which depends on tube Ø, and flags collisions.
  - Auto-splits each hub into two halves on the plane that best divides socket directions, so both halves print without supports. Alignment pins and an M3 bolt join them.
  - Engraves the hub ID next to each socket's strut ID.
- **Strut generator:** cut length = node distance − socket offsets.
  - Vase-mode single-wall diffuser tube (wall thickness param in layers), plus a printed spine with a strip/node cradle and a wire channel.
  - Struts taller than the bed's Z split at a spigot coupler.
  - A "dark" strut option is wire-only.
- **Data path:**
  - Greedy DFS from the controller hub suggests an order that minimizes dark backtracks.
  - The user can click struts to override the order and flip strip direction per strut.
  - Universe splits and injection points come from the resulting chain.

### Phases
1. **Foundation (done):**
   - Scaffold: Vite/React/R3F, vitest, GitHub Pages Action, `.claude/launch.json` dev config.
   - Pixel library with socket generators, the `manifold-3d` wrapper running in a worker, and the joints library (magnet pocket, bowtie key, heat-set boss, engraved label).
   - Printer presets and a bed-fit check.
   - Schedule engine with roll-ups and a CSV export.
   - 3MF writer (loose and grouped modes, material roles) and a simple shelf packer for plates.
   - Fit-test coupon.
   - Catalog page: fixture view + inspector + schedule table + export.
2. **First fixtures (done):** S1 Swatchbook, S2 Fresnel, M1 Hive M-tile, each with params, schedule and 3MF.
3. **Workbench + Strut & Node:** ports and snapping, data & power planner drawer, plates view, Strut & Node end-to-end. Then Hive and Linea on the same bench.
   - *Done:* Workbench mode (catalog, bench, inspector; drawer with schedule, plates, data & power and export). M4 has grid-snapped hubs and drag, six presets, exact-angle hubs with angle and collision checks, support-free split halves with dowels and an M3 bolt, wrapped engraving, cut-to-length vase tubes with keyed spines and couplers, dark struts, a greedy-DFS data path with click override and flips, and dedupe into print counts.
   - *Not yet:* typed ports and port snapping (`ModuleDef`) for Hive and Linea on the bench.
   - *Overhang rule:* hubs count as support-free at ≤ 60° from vertical by default (a slicer support threshold of 30°). The worst preset hub is the icosahedron's at about 40°.
4. **Large assemblies:** L1 Orb, L2 Cascade, L5 Bloom with auto-split and identical-part dedupe.
5. **Exports and preview:** xLights `.xmodel`, WLED `ledmap.json` and x/y/z CSV; bloom effect preview; Bambu/Orca plate metadata; the remaining S/L/M catalog; and SVG concept sheets for the new concepts in the existing style.

## Verification
- `npm run check:geom`: every fixture and module builds a manifold at default and extreme params, every part fits the selected bed, and there are no zero-volume parts.
- vitest: schedule math (universes, amps, 80% PSU, injection, strand-lead check), port snapping and data-path order, and a 3MF round-trip (unzip, parse XML, count objects and materials).
- `npm run build` passes (tsc + vite).
- Manual: run the dev server in the browser pane, then build Swatchbook, Fresnel and a Hive tile at several params. Export the 3MF, and open it in Bambu Studio / Orca / PrusaSlicer to confirm named parts and materials. Print the fit-test coupon and one S1 leaf to check socket tolerance.
