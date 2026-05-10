/**
 * Normalize the `codes` JSON column on article/section records (declared as
 * `Array<Record<string, unknown>>` in the seed schema) into a deduped list of
 * code strings. Older seeds may have stored plain strings; both shapes are
 * handled.
 *
 * Lives in a non-client file so server components (page.tsx) can call it
 * during projection without React's RSC boundary erroring.
 */
export function extractCodeStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let s: string | null = null;
    if (typeof item === 'string') s = item;
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      if (typeof o.code === 'string') s = o.code;
      else if (typeof o.id === 'string') s = o.id;
    }
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
