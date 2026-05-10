/**
 * Per-code mapping info embedded in an article/section's `codes` JSON array.
 * Each entry is the LLM's per-code output for that row (description,
 * previous suggestion, coverage / importance scores) — it's NOT the global
 * code-table metadata.
 */
export type EmbeddedCode = {
  code: string;
  description?: string;
  previouslySuggestedArticleTitle?: string;
  coverageScore?: string | number;
  importance?: string | number;
};

/**
 * Normalize the `codes` JSON column on article/section records (declared as
 * `Array<Record<string, unknown>>` in the seed schema) into a deduped list
 * of EmbeddedCode entries. Older seeds may have stored plain code strings;
 * those become entries with no description.
 *
 * Lives in a non-client module so server components can call it during
 * projection without crossing the RSC boundary.
 */
export function extractCodes(raw: unknown): EmbeddedCode[] {
  if (!Array.isArray(raw)) return [];
  const out: EmbeddedCode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === 'string') {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push({ code: item });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const code = typeof o.code === 'string' ? o.code : null;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      description: typeof o.description === 'string' ? o.description : undefined,
      previouslySuggestedArticleTitle:
        typeof o.previouslySuggestedArticleTitle === 'string'
          ? o.previouslySuggestedArticleTitle
          : undefined,
      coverageScore:
        typeof o.coverageScore === 'string' || typeof o.coverageScore === 'number'
          ? o.coverageScore
          : undefined,
      importance:
        typeof o.importance === 'string' || typeof o.importance === 'number'
          ? o.importance
          : undefined,
    });
  }
  return out;
}
