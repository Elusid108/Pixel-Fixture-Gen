import type { CrossSection, Manifold } from 'manifold-3d';
import type { BuildCtx, Mat4 } from '../types';
import { textStrokes } from './font';

export type P2 = [number, number];

/**
 * Thin modelling vocabulary over manifold, in mm and Z-up.
 * Everything a fixture needs, so fixture files read like a build description.
 */
export class Geo {
  readonly M: typeof Manifold;
  readonly CS: typeof CrossSection;

  constructor(ctx: BuildCtx) {
    this.M = ctx.Manifold;
    this.CS = ctx.CrossSection;
  }

  box(min: [number, number, number], max: [number, number, number]): Manifold {
    return this.M.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).translate(min);
  }

  /** Cylinder along Z from z0 to z1. */
  cylZ(r: number, z0: number, z1: number, x = 0, y = 0, segs?: number): Manifold {
    return this.M.cylinder(z1 - z0, r, r, segs ?? 0).translate([x, y, z0]);
  }

  coneZ(r0: number, r1: number, z0: number, z1: number, x = 0, y = 0): Manifold {
    return this.M.cylinder(z1 - z0, r0, r1).translate([x, y, z0]);
  }

  /** Cylinder along X from x0 to x1, centred on (y, z). */
  cylX(r: number, x0: number, x1: number, y = 0, z = 0): Manifold {
    return this.M.cylinder(x1 - x0, r).rotate([0, 90, 0]).translate([x0, y, z]);
  }

  /** Cylinder along Y from y0 to y1, centred on (x, z). */
  cylY(r: number, y0: number, y1: number, x = 0, z = 0): Manifold {
    return this.M.cylinder(y1 - y0, r).rotate([-90, 0, 0]).translate([x, y0, z]);
  }

  tubeZ(rOut: number, rIn: number, z0: number, z1: number): Manifold {
    return this.cylZ(rOut, z0, z1).subtract(this.cylZ(rIn, z0 - 1, z1 + 1));
  }

  /** Simple polygon in either winding (manifold's Positive fill rule needs CCW). */
  poly(points: P2[]): CrossSection {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      area += x0 * y1 - x1 * y0;
    }
    return this.CS.ofPolygons([area < 0 ? [...points].reverse() : points]);
  }

  circle(r: number, x = 0, y = 0): CrossSection {
    return this.CS.circle(r).translate([x, y]);
  }

  rect(w: number, h: number, x = 0, y = 0): CrossSection {
    return this.CS.square([w, h], true).translate([x, y]);
  }

  roundRect(w: number, h: number, r: number, x = 0, y = 0): CrossSection {
    const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01);
    return this.CS.square([w - 2 * rr, h - 2 * rr], true).offset(rr, 'Round').translate([x, y]);
  }

  extrude(cs: CrossSection, z0: number, z1: number): Manifold {
    return cs.extrude(z1 - z0).translate([0, 0, z0]);
  }

  /** Revolve an (r, z) profile around Z. */
  revolve(profile: P2[], segs?: number): Manifold {
    return this.M.revolve(this.poly(profile), segs ?? 0);
  }

  union(parts: (Manifold | null | undefined | false)[]): Manifold {
    const list = parts.filter(Boolean) as Manifold[];
    return list.length === 1 ? list[0] : this.M.union(list);
  }

  cut(base: Manifold, cutters: (Manifold | null | undefined | false)[]): Manifold {
    const list = cutters.filter(Boolean) as Manifold[];
    return list.length ? base.subtract(this.M.union(list)) : base;
  }

  place(solid: Manifold, m: Mat4): Manifold {
    return solid.transform(m as unknown as Parameters<Manifold['transform']>[0]);
  }

  /* ---- 2D vocabulary ---- */

  /** Regular hexagon by apothem. Flat-top puts vertices on ±X. */
  hexPts(apothem: number, flatTop = true, cx = 0, cy = 0): P2[] {
    const R = apothem / Math.cos(Math.PI / 6);
    const start = flatTop ? 0 : 30;
    return Array.from({ length: 6 }, (_, i) => {
      const a = ((start + i * 60) * Math.PI) / 180;
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)] as P2;
    });
  }

  hex(apothem: number, flatTop = true, cx = 0, cy = 0): CrossSection {
    return this.poly(this.hexPts(apothem, flatTop, cx, cy));
  }

  /** Engraving text as a 2D region, centred on the origin. */
  text(str: string, height: number, stroke = 0.6): CrossSection {
    const { strokes, width } = textStrokes(str, height);
    const r = stroke / 2;
    const caps: CrossSection[] = [];
    for (const s of strokes) {
      for (let i = 0; i < s.length - 1; i++) {
        const [a, b] = [s[i], s[i + 1]];
        caps.push(this.CS.hull([this.CS.circle(r, 8).translate(a), this.CS.circle(r, 8).translate(b)]));
      }
      if (s.length === 1) caps.push(this.CS.circle(r, 8).translate(s[0]));
    }
    return this.CS.union(caps).translate([-width / 2, -height / 2]);
  }

  /* ---- Joints & hardware cutters (all "into the part" along -Z from z=0 unless noted) ---- */

  /** 6×3 disc magnet pocket, opening at z=0, going down. */
  magnetPocket(d = 6, depth = 3, tol = 0.15): Manifold {
    return this.cylZ(d / 2 + tol, -depth - 0.2, 0.01);
  }

  /** Heat-set insert hole (M3: Ø4.0×5.5, M4: Ø5.6×8) opening at z=0, going down. */
  heatSet(size: 3 | 4 = 3): Manifold {
    return size === 3 ? this.cylZ(2.0, -5.7, 0.01) : this.cylZ(2.8, -8.2, 0.01);
  }

  /** Half-bowtie (butterfly key) outline, waist on y=0 widening toward +y. */
  halfBowtie(waist: number, wide: number, len: number): CrossSection {
    return this.poly([
      [-waist / 2, 0],
      [waist / 2, 0],
      [wide / 2, len],
      [-wide / 2, len],
    ]);
  }

  /** Full bowtie key outline centred on the origin, waist along X. */
  bowtie(waist: number, wide: number, len: number): CrossSection {
    return this.poly([
      [-wide / 2, -len],
      [wide / 2, -len],
      [waist / 2, 0],
      [wide / 2, len],
      [-wide / 2, len],
      [-waist / 2, 0],
    ]);
  }

  /** Keyhole slot through a plate of `t`, entry circle at origin, slot toward +y. */
  keyhole(t: number, head = 9, shank = 4.6, slot = 10): Manifold {
    const cs = this.CS.union([this.circle(head / 2), this.rect(shank, slot, 0, slot / 2), this.circle(shank / 2, 0, slot)]);
    return this.extrude(cs, -1, t + 1);
  }
}
