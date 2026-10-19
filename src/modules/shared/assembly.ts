import type { AssemblyStep } from '../../types';

/**
 * Helpers for the `assembly` steps every Workbench system returns. Steps name the parts they
 * use by id; a step whose parts were not built this time (a feature switched off, or no
 * trimmed tiles) is dropped rather than shown empty.
 */

/** Ids of the built parts matching any of `tests`: an exact id, an id prefix ending in `-` or `*`, or a predicate. */
export function idsOf(parts: { id: string }[], ...tests: (string | ((id: string) => boolean))[]): string[] {
  const hit = (id: string) =>
    tests.some((t) => (typeof t === 'function' ? t(id) : t.endsWith('*') ? id.startsWith(t.slice(0, -1)) : t.endsWith('-') ? id.startsWith(t) : id === t));
  return parts.map((p) => p.id).filter(hit);
}

/** Millimetres for notes: at most two decimals, no trailing zeros. */
export const mm = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * Keep the steps that name at least one built part (or name none at all), in order. Part ids
 * that weren't built are dropped from each step.
 */
export function steps(parts: { id: string }[], list: (AssemblyStep | null | false | undefined)[]): AssemblyStep[] {
  const built = new Set(parts.map((p) => p.id));
  const out: AssemblyStep[] = [];
  for (const s of list) {
    if (!s) continue;
    if (!s.parts) {
      out.push(s);
      continue;
    }
    const ids = [...new Set(s.parts.filter((id) => built.has(id)))];
    if (ids.length) out.push({ ...s, parts: ids });
  }
  return out;
}
