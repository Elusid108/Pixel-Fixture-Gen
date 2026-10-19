import type { ComponentType } from 'react';

/**
 * A Workbench system, React half. The shell owns the canvas, camera, built parts, pixels,
 * plates view, toolbar, undo and keys; a system supplies its tools and the pieces below.
 */

export interface ToolDef {
  id: string;
  label: string;
  /** Single lowercase key that selects the tool. */
  key: string;
  hint: string;
  /** Show the "Plane Z" control while this tool is active. */
  plane?: boolean;
}

export interface SceneProps {
  /** Built parts are showing: draw handles as translucent pick targets. */
  ghost: boolean;
  /** Something is being dragged: built parts are hidden until the rebuild lands. */
  hideStale: boolean;
}

export interface SystemUI {
  tools: ToolDef[];
  /** Handles, overlays and the work plane, rendered in the shared canvas (three.js Y-up world). */
  Scene: ComponentType<SceneProps>;
  /** Left panel below the system list: components, toggles. Presets are listed by the shell. */
  Palette: ComponentType;
  /** Right panel. */
  Inspector: ComponentType;
  /** "Data & power" drawer tab, when the system has a data path worth showing. */
  Data?: ComponentType;
  /** Size cue for pixel glows, mm. Called as a hook inside the canvas (the shell remounts on system change). */
  usePixelSize?: () => number;
  /** Which overlay toggles the toolbar offers. */
  overlays?: { chain?: boolean; labels?: boolean };
}
