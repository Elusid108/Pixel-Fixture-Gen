import { bool, num, str } from '../../fixtures/util';
import { getPixel, type PixelType } from '../../pixels/library';
import type { ParamSpec, Params } from '../../types';
import { DESIGN_PARAM, PRINTER_PARAM, resolveSpecs } from '../shared/params';

export const FW_PIXELS = ['node-12-bullet', 'node-12-bullet-12v'];

/** System parameters. The design (outline, driver, overrides) rides in `design`. */
export const FW_PARAMS: ParamSpec[] = [
  DESIGN_PARAM,
  PRINTER_PARAM,
  { key: 'pixel', label: 'Node', type: 'pixel', default: 'node-12-bullet', pixels: FW_PIXELS, group: 'Pixels', help: 'One node per facet, pushed into the backer from the front.' },
  { key: 'side', label: 'Triangle side', type: 'number', default: 60, min: 45, max: 100, step: 1, unit: 'mm', group: 'Grid', help: 'Edge length of one facet. Node spacing is side ÷ √3, so keep it well inside the strand lead.' },
  { key: 'patch', label: 'Max tile size', type: 'number', default: 8, min: 1, max: 8, step: 1, unit: 'tri/side', group: 'Grid', help: 'Backer tiles are big triangles this many facets on a side, or fewer if your printer is smaller.' },
  { key: 'image', label: 'Depth picture', type: 'image', default: '', group: 'Depth', help: 'Used when the depth driver is "Picture": brighter stands further off the wall. Empty uses a built-in ripple.' },
  { key: 'base', label: 'Shallow stand-off', type: 'number', default: 14, min: 10, max: 30, step: 1, unit: 'mm', group: 'Depth', help: 'Face height of the shallowest facets above the backer. Lower than ~12 mm shows a hot spot.' },
  { key: 'step', label: 'Depth step', type: 'number', default: 10, min: 4, max: 24, step: 1, unit: 'mm', group: 'Depth', help: 'Added per depth level. Three levels: shallow, middle, deep.' },
  { key: 'face', label: 'Facet face', type: 'number', default: 1.2, min: 0.8, max: 2.4, step: 0.2, unit: 'mm', group: 'Facets', help: 'Translucent face thickness. Printed face down for a smooth front.' },
  { key: 'wall', label: 'Facet wall', type: 'number', default: 1.2, min: 0.8, max: 2, step: 0.2, unit: 'mm', group: 'Facets' },
  { key: 'depth', label: 'Backer depth', type: 'number', default: 32, min: 30, max: 50, step: 1, unit: 'mm', group: 'Backer', help: 'Wiring space behind the face plate. A 12 mm bullet node is 28 mm long.' },
  { key: 'plate', label: 'Face plate', type: 'number', default: 2.4, min: 1.6, max: 3, step: 0.2, unit: 'mm', group: 'Backer', help: 'Bullet nodes clip into 1.5–3 mm.' },
  { key: 'magnets', label: 'Magnet pockets', type: 'boolean', default: true, group: 'Backer', help: 'Two 6×3 mm magnets per tile edge pull neighbouring tiles into line.' },
  { key: 'tol', label: 'Node hole clearance', type: 'number', default: 0.1, min: 0, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit' },
  { key: 'fit', label: 'Snap clearance', type: 'number', default: 0.2, min: 0.1, max: 0.4, step: 0.05, unit: 'mm', group: 'Fit', help: 'Slot clearance around the facet snap tabs. More is easier to fit and holds less.' },
];

export const fwParams = (given: Params = {}): Params => resolveSpecs(FW_PARAMS, given);

/** Physical dimensions shared by the layout, the build and the bench preview. */
export interface FwDims {
  pixel: PixelType;
  side: number;
  /** Face stand-off above the backer front, per depth level. */
  heights: [number, number, number];
  face: number;
  wall: number;
  /** Backer depth (wall to front face) and its face plate. */
  depth: number;
  plate: number;
  magnets: boolean;
  tol: number;
  fit: number;
  /** Lead between nodes on a factory strand, mm. */
  lead: number;
  /** Seam gaps, mm: each facet and each backer outline is inset by these from the grid lines. */
  facetGap: number;
  tileGap: number;
  rim: number;
}

export function fwDims(p: Params): FwDims {
  const pixel = getPixel(str(p, 'pixel'));
  const base = num(p, 'base');
  const step = num(p, 'step');
  return {
    pixel,
    side: num(p, 'side'),
    heights: [base, base + step, base + 2 * step],
    face: num(p, 'face'),
    wall: num(p, 'wall'),
    depth: num(p, 'depth'),
    plate: num(p, 'plate'),
    magnets: bool(p, 'magnets'),
    tol: num(p, 'tol'),
    fit: num(p, 'fit'),
    lead: pixel.leadLength ?? 100,
    facetGap: 0.4,
    tileGap: 0.15,
    rim: 2,
  };
}
