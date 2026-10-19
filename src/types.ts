import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';

/** Millimetres, Z-up — the slicer's frame. The viewer rotates to three.js Y-up. */
export type Vec3 = [number, number, number];
/** 4x4 column-major (three.js `Matrix4.elements` / manifold `Mat4` layout). */
export type Mat4 = number[];

export type MaterialRole = 'body' | 'diffuser' | 'baffle';

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  /**
   * `pixel` is a select whose options come from the pixel library. `json` carries structured
   * data (a workbench design). `image` is a user picture, stored as a small grayscale grid
   * (see src/fixtures/image.ts); '' means "use the fixture's built-in default".
   */
  type: 'number' | 'select' | 'boolean' | 'pixel' | 'json' | 'image';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Pixel ids allowed for a `pixel` param. */
  pixels?: string[];
  group?: string;
  help?: string;
  /** Set by the host rather than shown as a control (e.g. the printer for a workbench build). */
  hidden?: boolean;
}

/**
 * A printable part. `solid` is modelled in its print orientation, resting on z=0.
 * `instances` place each printed copy in the assembled fixture, so qty = instances.length.
 */
export interface PartSpec<S> {
  id: string;
  name: string;
  role: MaterialRole;
  solid: S;
  instances: Mat4[];
  /** Direction (assembled frame) this part slides out along in the exploded view. */
  explode?: Vec3;
  note?: string;
}

export interface PixelPlacement {
  /** Assembled-frame point where the pixel's light reads (on the diffuser or lens face), mm. */
  pos: Vec3;
  /** Direction the emitter faces. */
  normal: Vec3;
  /** Schedule unit this pixel belongs to. Array order is data order. */
  unit: string;
}

/** One line of the instrument schedule, as declared by a fixture. */
export interface ScheduleLine {
  unit: string;
  position: string;
  purpose: string;
  pixelId: string;
  /** Physical items: nodes, PCBs, or millimetres of strip. */
  units: number;
  px: number;
  notes?: string;
}

export interface HardwareLine {
  item: string;
  qty: number;
  note?: string;
}

export interface Port {
  id: string;
  pos: Vec3;
  /** Outward normal of the mating face. */
  normal: Vec3;
  kind: string;
}

export interface FixtureOutput<S = Manifold> {
  parts: PartSpec<S>[];
  pixels: PixelPlacement[];
  schedule: ScheduleLine[];
  hardware: HardwareLine[];
  warnings: string[];
  ports?: Port[];
  /** Enclosed air volume around the emitters, for the thermal check. */
  enclosureCm3?: number;
  /** Assembly order, first step first. Shown in the Parts tab. */
  assembly?: AssemblyStep[];
}

export interface AssemblyStep {
  title: string;
  /** Part ids used in this step. */
  parts?: string[];
  /** Hardware or consumables for this step ("2× M3 heat-set", "CA glue"). */
  hardware?: string;
  note?: string;
}

export interface BuildCtx {
  wasm: ManifoldToplevel;
  Manifold: typeof Manifold;
  CrossSection: typeof CrossSection;
}

export type Family = 'single' | 'assembly' | 'modular' | 'utility';

export interface FixtureDef {
  id: string;
  code: string;
  name: string;
  family: Family;
  tagline: string;
  description: string;
  params: ParamSpec[];
  build(ctx: BuildCtx, params: Params): FixtureOutput;
}

/* ---- Serializable build results (worker → UI) ---- */

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface BuiltPart {
  id: string;
  name: string;
  role: MaterialRole;
  mesh: MeshData;
  instances: Mat4[];
  explode: Vec3;
  bounds: Bounds;
  volumeCm3: number;
  triangles: number;
  note?: string;
}
