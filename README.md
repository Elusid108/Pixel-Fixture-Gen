# Pixel Fixture Gen

Printable LED pixel fixtures, generated in the browser. Pick a fixture, set its parameters and pixel type, and get print-ready multi-part 3MF files plus an instrument schedule. The schedule covers pixel form, count, DMX patch, power, PSU, injection points, wire gauge and hardware.

The concept catalogue and roadmap are in [docs/roadmap.md](docs/roadmap.md); how to add fixtures and Workbench systems is in [docs/extending.md](docs/extending.md). The original concept sheets are in [concepts/](concepts/).

## The catalogue

Every concept from the brainstorm is built. All fixtures size their parts to the printer picked in the header, and the large assemblies auto-split oversize parts at keyed joints.

**Single bed (S)**

| Code | Fixture | Default pixels |
|---|---|---|
| S1 | **Swatchbook**: leaves fan on a hollow post. Fan it to chase, close it to mix like stacked gels. | 12 pixel PCBs |
| S2 | **Fresnel**: computed stepped lens, colour-frame guides, gel frames, four-leaf barn doors, yoke and stand. | 24-px ring + 7-px jewel |
| S3 | **Leko Jr.**: 1:3 ERS with four shutters, an A-size template slot and printable gobo plates (or your own image). It backlights the gobo; it doesn't project. | 7-px jewel + 8 PCBs |
| S4 | **Scrim Box**: printed gauze over three silhouette layers. Front light makes it opaque; back light reveals the scene. | 20 px in 4 zones |
| S5 | **Litho Relight**: your picture as a lithophane over a baffled 6×6 grid. Relight the photo. | 36 px (64 with nodes) |
| S6 | **Louver Sconce**: angled louvers, one pixel per gap, separate up and down wash. | 16 px |
| S7 | **Moiré Lantern**: two counter-twisted slotted shells over a helical strip core. | 60 px |
| S8 | **Contour**: a heightmap as stacked translucent topo bands. | 31 nodes |

**Centrepieces and chandeliers (L)**

| Code | Fixture | Default pixels |
|---|---|---|
| L1 | **The Orb**: 2V/3V/4V geodesic in two pixel types: nodes in the faces and PCB "stars" in the vertex caps. Panels dedupe into print counts (3V: A×60, B×120). | 180 nodes + 91 stars |
| L2 | **Cascade**: keyed crown arcs carrying vase-mode drop tubes, with a cone, wave, spiral or seeded pattern. | 240 px |
| L3 | **Gasolier**: lathe-turned column, S-arms, RGBW candle flames, prism drops. | 47 RGBW px |
| L4 | **Armillary**: equator, meridian and the ecliptic at 23.4°, in keyed arcs, with a geodesic sun. | 262 px |
| L5 | **Bloom**: tiered keyed petals under the 14″ sightline, with a battery base and runtime estimate. | 31 px |
| L6 | **Helix**: DNA pendant of twin backbones and pixel-bar base pairs. | 100 px |
| L7 | **Dome**: 2V/4V geodesic hemisphere on a base ring, with face nodes plus a rim strip. | 40 nodes + 94 px |
| L8 | **Drum**: faceted cylinder of identical panel rings (straight, taper or barrel), with panel nodes plus seam strips. | 30 nodes + 156 px |
| L9 | **Polyhedra**: football, dodecahedron or icosahedron panel shell, with face nodes plus vertex stars. | 32 nodes + 59 stars |

**Modular (M)**: on the Workbench. M1 Hive tile is also in the catalogue as a single unit.

| Code | System | Driven by drawing |
|---|---|---|
| M1 | **Hive wall**: hex tiles fill an outline, with edge tiles trimmed exactly, magnets, bowtie keys and cleat rails. | regions |
| M2 | **Linea**: pitch-locked straights, exact-angle corners, T and X joints, three diffuser profiles. | paths |
| M3 | **Mini Rig 1:6**: F34 truss with 2/3/4/6-way corners and clip-on PAR, blinder, mover and batten. | paths, 3D paths |
| M4 | **Strut & Node**: wireframes with every hub generated at its exact socket angles. | paths, 3D paths, regions |
| M5 | **Facet Wall**: triangle facets at three depths from a gradient or image, on bed-sized backers. | regions |
| M6 | **Column Stack**: base or canopy, a segment library and caps. | — |
| M7 | **Pixel Chain**: hinged links on a true catenary, with pitch checked against the strand lead. | paths, 3D paths |

T0 **Socket fit coupon**: any pixel socket at three engraved clearances. Print this first.
T1 **Fit gap coupon**: round, dovetail, key, sliding-tab and hinge joints, each at fit −0.1, fit and fit +0.1. Print it to choose your fit gap.

## Fit: straight off the printer

Every exported part is modelled to assemble without sanding:
- **Fit gap** (header, default **0.4 mm**): the total gap between mating printed parts. It covers spigots, dovetails, keys, sleeves, grooves, hinges and the auto-split joints on large assemblies.
- **Seat** (header, default 0.15 mm): the clearance around each pixel in its socket.
- Any fixture or Workbench system can override either value in its Fit group.
- The exported 3MF records the printer, fit gap and seat clearance it was modelled with.
- Each fixture's Parts tab lists its assembly steps in build order.

## On a phone

Below about 980 px the app switches to a touch layout:
- The 3D view fills the screen above a bottom tab bar (View · Fixtures · Params · Schedule · Parts · Export), and each tab opens a sheet you swipe up or down.
- One finger orbits; two fingers pinch and pan.
- On-screen buttons replace the keyboard while drawing: Finish, Close, Undo point, Cancel and the X/Y/Z plane turns.

## Drawing engine

On the Workbench, the **Draw** panel works for every system:

- **Tools**: Line (L), Rect (R), Circle (E), Polygon (P), Arc (A), Free (F), Pick (S). They snap to the grid, to endpoints and midpoints, and to 15° angles, and you can type a segment length.
- **Planes**: draw on XY, XZ or YZ at any offset, or on a plane through three points. While drawing a line, **X / Y / Z** turns onto a new plane through the last point. That's how you sketch in 3D.
- **Text & SVG**: type a word as single-line paths or filled outlines, or import an SVG. Fills become regions and strokes become paths.
- **Arrange**: mirror across X/Y/Z, and linear or polar arrays.
- **Generate**: sends the drawing to a system. Closed shapes become regions (for tile and facet fills), lines become paths (for bars, chains and truss), and 3D sketches become wireframes. Ctrl+Z on the bench undoes it.

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
- `src/workbench/`: the system contracts (`SystemCore` + `SystemUI`), the per-system store and the registries. `src/ui/bench/` is the shared canvas, toolbar and keys.
- `src/sketch/` and `src/ui/sketch/`: the drawing engine (pure geometry, tools, text/SVG import, arrange, generate) and its canvas layer and panel.
- `src/modules/<system>/`: one folder per Workbench system. `src/modules/strut-node/` is the M4 system. `analyze.ts` covers socket aims, offsets, angle checks, cut lengths, dedupe and the hub split plan. `dataPath.ts` is the chain, `presets.ts` the starting shapes, `build.ts` the geometry. The analysis has no geometry kernel, so the bench and inspector use exactly what the worker builds.
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
