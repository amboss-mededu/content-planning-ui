/**
 * Per-code mapping info embedded in an article/section's `codes` JSON array.
 * Each entry is the LLM's per-code output for that row (description,
 * previous suggestion, coverage / importance scores) — it's NOT the global
 * code-table metadata.
 */
export type EmbeddedCode = {
  code: string;
  description?: string;
  category?: string;
  previouslySuggestedArticleTitle?: string;
  coverageScore?: string | number;
  importance?: string | number;
};

/** Lightweight code → full source-ontology category lookup, used as a
 * fallback when the embedded code object on an article/section row
 * doesn't carry its own category. Built once per page from the global
 * codes table. */
export type CategoryLookup = Record<string, string | undefined>;

/**
 * Origin of a title that appeared in an article's
 * `previousArticleTitleSuggestions` list. The pipeline emits flat
 * strings, so we join post-hoc against the 1st-pass article + section
 * tables to recover whether each title was an article on its own or a
 * section nested under one.
 */
export type TitleOrigin =
  | { kind: 'article' }
  | { kind: 'section'; inArticle: string }
  | { kind: 'both'; inArticle: string };

export type TitleOriginLookup = Record<string, TitleOrigin>;

export function buildTitleOriginLookup(
  articles: Array<{ articleTitle?: string }>,
  sections: Array<{ sectionName?: string; articleTitle?: string }>,
): TitleOriginLookup {
  const out: TitleOriginLookup = {};
  for (const a of articles) {
    if (a.articleTitle) out[a.articleTitle] = { kind: 'article' };
  }
  for (const s of sections) {
    if (!s.sectionName) continue;
    const inArticle = s.articleTitle ?? '(unknown article)';
    const existing = out[s.sectionName];
    if (!existing) {
      out[s.sectionName] = { kind: 'section', inArticle };
    } else if (existing.kind === 'article') {
      out[s.sectionName] = { kind: 'both', inArticle };
    }
    // existing 'section'/'both' stays — first article wins for the inArticle hint.
  }
  return out;
}

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
      category: typeof o.category === 'string' ? o.category : undefined,
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
