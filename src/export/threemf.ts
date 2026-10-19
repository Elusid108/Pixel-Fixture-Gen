import JSZip from 'jszip';
import { mul, T } from '../geom/mat';
import type { Printer } from '../printers';
import type { BuiltPart, Mat4, MaterialRole } from '../types';
import { plateTransform, type Plate } from './plates';

/**
 * 3MF writer. Every unique part is one named mesh <object> tagged with a base material for
 * its role, so a multi-material slicer can map body/diffuser/baffle to filaments in one step.
 *
 * - `plates`: print-ready. Every instance laid out on the bed; extra plates sit to the right.
 * - `assembly`: one multi-part object (3MF components) in the assembled pose, for checking
 *   fit in a slicer or CAD. It is not meant to be sliced as-is.
 */

export const ROLE_MATERIAL: Record<MaterialRole, { name: string; color: string }> = {
  body: { name: 'Body (black)', color: '#1F1F22FF' },
  diffuser: { name: 'Diffuser (natural / opal)', color: '#F1EEE6FF' },
  baffle: { name: 'Baffle (black or white)', color: '#3A3A40FF' },
};
const ROLES: MaterialRole[] = ['body', 'diffuser', 'baffle'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const f = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Column-major Mat4 → 3MF's row-vector "m00 m01 m02 m10 … m32". */
export function to3mfTransform(m: Mat4): string {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]].map(f).join(' ');
}

function meshXml(p: BuiltPart): string {
  const { positions, indices } = p.mesh;
  const out: string[] = ['<mesh><vertices>'];
  for (let i = 0; i < positions.length; i += 3) {
    out.push(`<vertex x="${f(positions[i])}" y="${f(positions[i + 1])}" z="${f(positions[i + 2])}"/>`);
  }
  out.push('</vertices><triangles>');
  for (let i = 0; i < indices.length; i += 3) {
    out.push(`<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`);
  }
  out.push('</triangles></mesh>');
  return out.join('');
}

export interface ThreeMfInput {
  title: string;
  parts: BuiltPart[];
  mode: 'plates' | 'assembly';
  plates?: Plate[];
  /** Plates mode: export only this plate (0-based). Omit for all plates. */
  plateIndex?: number;
  printer?: Printer;
}

export function build3mfXml(input: ThreeMfInput): string {
  const objects: string[] = [];
  const ids = new Map<string, number>();
  let next = 2; // 1 is the material group
  const used = new Set<string>();

  const items: { id: string; m: Mat4 }[] = [];
  if (input.mode === 'plates') {
    const plates = input.plates ?? [];
    const pitchX = (input.printer?.x ?? 256) + 30;
    plates.forEach((plate, pi) => {
      if (input.plateIndex !== undefined && input.plateIndex !== pi) return;
      const offset = input.plateIndex !== undefined ? 0 : pi * pitchX;
      for (const it of plate.items) used.add(it.partId);
      for (const it of plate.items) {
        const part = input.parts.find((p) => p.id === it.partId)!;
        items.push({ id: part.id, m: mul(T(offset, 0, 0), plateTransform(part.bounds, it)) });
      }
    });
  } else {
    for (const p of input.parts) used.add(p.id);
  }

  for (const p of input.parts) {
    if (!used.has(p.id)) continue;
    const id = next++;
    ids.set(p.id, id);
    objects.push(`<object id="${id}" type="model" name="${esc(p.name)}" pid="1" pindex="${ROLES.indexOf(p.role)}">${meshXml(p)}</object>`);
  }

  const build: string[] = [];
  if (input.mode === 'plates') {
    for (const { id, m } of items) {
      build.push(`<item objectid="${ids.get(id)}" transform="${to3mfTransform(m)}" printable="1"/>`);
    }
  } else {
    const asmId = next++;
    const comps = input.parts.flatMap((p) => p.instances.map((m) => `<component objectid="${ids.get(p.id)}" transform="${to3mfTransform(m)}"/>`));
    objects.push(`<object id="${asmId}" type="model" name="${esc(input.title)} (assembly)"><components>${comps.join('')}</components></object>`);
    build.push(`<item objectid="${asmId}" printable="0"/>`);
  }

  const materials = ROLES.map((r) => `<base name="${esc(ROLE_MATERIAL[r].name)}" displaycolor="${ROLE_MATERIAL[r].color}"/>`).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Title">${esc(input.title)}</metadata>`,
    '<metadata name="Application">Pixel Fixture Gen</metadata>',
    `<resources><basematerials id="1">${materials}</basematerials>${objects.join('')}</resources>`,
    `<build>${build.join('')}</build>`,
    '</model>',
  ].join('\n');
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

export async function build3mf(input: ThreeMfInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('3D/3dmodel.model', build3mfXml(input));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
