/**
 * Stable, content-derived identifiers for articles and sections.
 *
 * Background: every "article-like" collection in this app
 * (`consolidatedArticles`, `newArticleSuggestions`,
 * `articleUpdateSuggestions`, `consolidatedSections`) gets wiped +
 * re-inserted on every consolidation re-run and every seed re-import.
 * PocketBase assigns fresh row ids on each insert, so anything that
 * references those rows by `id` — reviews, backlog entries, comments —
 * silently rots into zombies after the next cycle.
 *
 * The fix is to attach a deterministic `articleKey` / `sectionKey` to
 * each producer row at insert time and to point all foreign references
 * (articleReviews, sectionReviews, articleBacklog, reviewComments) at
 * the key instead of the PB id. The key is computed purely from the
 * row's *content*, so re-running consolidation or re-seeding produces
 * the same key as long as the canonical identifying fields don't
 * change (`articleTitle` for new articles; CMS `articleId` for
 * updates).
 *
 * Format (kept readable so DB inspection stays painless):
 *   articleKey
 *     new::<specialtySlug>::<normalize(articleTitle)>
 *     upd::<articleId>
 *   sectionKey
 *     sec::<specialtySlug>::<normalize(articleTitle)>::<normalize(sectionName)>
 *     sec-upd::<articleId>::<sectionId>
 *
 * `normalize` is aggressive on purpose — the LLM rephrases titles
 * across consolidation runs (extra punctuation, parenthesised acronyms,
 * capitalisation drift). Collapsing all non-alphanumerics to `-`
 * absorbs most of that without merging articles whose canonical
 * meaning differs.
 */

/**
 * Lowercase, replace any run of non-alphanumeric chars with `-`, strip
 * leading/trailing `-`. Idempotent.
 */
export function normalizeForKey(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      // Drop diacritics that NFKD broke out so "café" and "cafe" match.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

/** Sentinel used by callers (UI filters, data joins) to detect rows
 *  whose key could not be computed at backfill time — typically zombie
 *  rows whose referent has been deleted. */
export const EMPTY_KEY = '';

/**
 * Compute the stable key for a new or update article. Returns
 * `EMPTY_KEY` when there's nothing usable — caller decides whether
 * that's a hard error or a silent skip (most code skips).
 *
 * Precedence: `articleId` wins (it's the CMS-side stable id, the only
 * truly canonical identifier we have). Falls back to slug + title for
 * new articles where no CMS row exists yet.
 */
export function computeArticleKey(args: {
  specialtySlug: string;
  articleTitle?: string | null;
  /** CMS article id when this row is an update to an existing AMBOSS
   *  article. Empty / undefined for new-article suggestions. */
  articleId?: string | null;
}): string {
  const articleId = args.articleId?.trim();
  if (articleId) return `upd::${articleId}`;

  const title = args.articleTitle?.trim();
  if (!title) return EMPTY_KEY;
  const slug = args.specialtySlug.trim();
  if (!slug) return EMPTY_KEY;

  return `new::${slug}::${normalizeForKey(title)}`;
}

/**
 * Compute the stable key for a section row.
 *
 * Same precedence: if both `articleId` and `sectionId` are present,
 * we're updating a known CMS section — use those directly. Otherwise
 * derive from the parent article title + the section name (scoped to
 * the specialty so two specialties can have the same "Definition"
 * section under articles that share a title).
 */
export function computeSectionKey(args: {
  specialtySlug: string;
  articleTitle?: string | null;
  articleId?: string | null;
  sectionName?: string | null;
  sectionId?: string | null;
}): string {
  const articleId = args.articleId?.trim();
  const sectionId = args.sectionId?.trim();
  if (articleId && sectionId) return `sec-upd::${articleId}::${sectionId}`;

  const articleTitle = args.articleTitle?.trim();
  const sectionName = args.sectionName?.trim();
  const slug = args.specialtySlug.trim();
  if (!articleTitle || !sectionName || !slug) return EMPTY_KEY;

  return `sec::${slug}::${normalizeForKey(articleTitle)}::${normalizeForKey(sectionName)}`;
}
