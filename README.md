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

## How it fits together

- `src/pixels/`: the pixel library (nodes, PCBs, rings, jewels, strip) and the shared socket cutters. Changing a pixel type re-flows the geometry and the schedule.
- `src/fixtures/`: one file per fixture. Each `build()` returns parts (modelled in print orientation, with assembled-pose instances), pixel placements in data order, and schedule lines.
- `src/geom/`: a thin modelling vocabulary over [manifold-3d](https://github.com/elalish/manifold). Every part is guaranteed watertight.
- `src/schedule/`: the Lightwright-style schedule with patch, power roll-up, strand-lead and thermal checks, and CSV export.
- `src/export/`: plate packing per printer and the 3MF writer. Body, diffuser and baffle are material slots, and there is a plates mode and an assembly mode.
- `src/ui/`: React + react-three-fiber. Builds run in a web worker.

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
