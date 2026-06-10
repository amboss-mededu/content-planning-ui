import 'server-only';

import { computeOverallCoverageFromCodes } from '@/lib/data/article-coverage';
import { computeArticleKey } from '@/lib/data/article-keys';
import { createAdminClient } from '@/lib/pb/server';
import type {
  ArticleBacklogRecord,
  ConsolidatedArticleRecord,
  ReviewCommentRecord,
} from '@/lib/pb/types';

/**
 * Manual editor mutations on consolidated articles: set the code set,
 * rename (with the article-key migration that a content-derived key
 * forces), and merge several rows into one.
 *
 * All writes go through the admin client — these are editor actions
 * guarded at the server-action layer, and several touch collections the
 * cookie-scoped rules don't grant write access to (reviews, backlog).
 *
 * PocketBase has no transactions. Where ordering matters for crash
 * safety (rename, merge) the comment on each function spells out the
 * order and why.
 */

// --- pure helpers (unit-tested) --------------------------------------------

/** Extract the canonical code string from a `codes`-array entry, which may
 *  be a bare string (legacy seeds) or an object with a `code` field. */
export function codeKeyOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null;
  if (entry && typeof entry === 'object') {
    const code = (entry as { code?: unknown }).code;
    if (typeof code === 'string') return code.trim() || null;
  }
  return null;
}

/**
 * Dedupe a `codes` array by its `code` string, last-write-wins on the
 * value while preserving first-seen order. Mirrors the consolidation
 * workflow's `Map.set(code, entry)` merge so manual edits and pipeline
 * re-runs converge on the same shape. Entries with no resolvable code
 * are dropped.
 */
export function dedupeCodesByCode(codes: unknown[]): unknown[] {
  const byCode = new Map<string, unknown>();
  for (const entry of codes) {
    const key = codeKeyOf(entry);
    if (!key) continue;
    byCode.set(key, entry);
  }
  return Array.from(byCode.values());
}

/** Normalize a PB JSON column that should hold a list of strings into a
 *  clean string[] (drops non-strings and blanks). */
export function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function toNumberOrUndefined(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export type MergedArticleFields = {
  codes: unknown[];
  numCodes: number;
  overallCoverage: number | undefined;
  overallImportance: number | undefined;
  justification: string | undefined;
  previousArticleTitleSuggestions: string[];
};

/**
 * Compute the fields the target row should carry after absorbing the
 * sources. Pure — no PB access — so the merge math is unit-tested in
 * isolation.
 *
 * - codes: union by code string (last-write-wins on the entry)
 * - numCodes: size of the merged set
 * - overallCoverage: averaged from the merged codes (PR 1 helper)
 * - overallImportance: max across target + sources
 * - justification: non-empty justifications joined with a blank line,
 *   target first
 * - previousArticleTitleSuggestions: union of every row's existing
 *   suggestions plus each source's current title (the target's title is
 *   the surviving one, so it's not added)
 */
export function computeMergedArticleFields(
  target: ConsolidatedArticleRecord,
  sources: ConsolidatedArticleRecord[],
): MergedArticleFields {
  const all = [target, ...sources];

  const codes = dedupeCodesByCode(
    all.flatMap((r) => (Array.isArray(r.codes) ? r.codes : [])),
  );

  const importances = all
    .map((r) => toNumberOrUndefined(r.overallImportance))
    .filter((n): n is number => n !== undefined);
  const overallImportance = importances.length > 0 ? Math.max(...importances) : undefined;

  const justifications = all
    .map((r) => (typeof r.justification === 'string' ? r.justification.trim() : ''))
    .filter((s) => s.length > 0);
  const justification =
    justifications.length > 0 ? justifications.join('\n\n') : undefined;

  const titles = new Set<string>();
  for (const r of all) {
    for (const t of toStringArray(r.previousArticleTitleSuggestions)) titles.add(t);
  }
  for (const s of sources) {
    if (typeof s.articleTitle === 'string' && s.articleTitle.trim()) {
      titles.add(s.articleTitle.trim());
    }
  }
  // The surviving title is current, not a "previous" suggestion.
  if (typeof target.articleTitle === 'string') titles.delete(target.articleTitle.trim());

  return {
    codes,
    numCodes: codes.length,
    overallCoverage: computeOverallCoverageFromCodes(codes),
    overallImportance,
    justification,
    previousArticleTitleSuggestions: Array.from(titles),
  };
}

// --- admin orchestration ---------------------------------------------------

/** Collections that carry an `articleKey` join column and must follow a
 *  rename / merge re-point. `reviewComments` is handled separately because
 *  it keys on `recordKey` and PB 400s on some filter combos there. */
const ARTICLE_KEY_COLLECTIONS = [
  'articleReviews',
  'articleBacklog',
  'articleSources',
  'articleLitSearchRuns',
  'articleDraftRuns',
] as const;

async function getArticleByKey(
  slug: string,
  articleKey: string,
): Promise<ConsolidatedArticleRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<ConsolidatedArticleRecord>('consolidatedArticles')
      .getFirstListItem(
        pb.filter('specialtySlug = {:slug} && articleKey = {:key}', {
          slug,
          key: articleKey,
        }),
      );
  } catch {
    return null;
  }
}

/**
 * Set the embedded code set on a consolidated article, recomputing
 * `numCodes` and `overallCoverage`. Codes are deduped by code string.
 * When the set is empty (or carries no numeric coverage) `overallCoverage`
 * is written as 0 — the articles projection normalizes 0-with-no-codes to
 * `undefined` so the column renders "—".
 */
export async function setConsolidatedArticleCodesAsAdmin(
  slug: string,
  articleKey: string,
  codes: unknown[],
): Promise<void> {
  const pb = await createAdminClient();
  const row = await getArticleByKey(slug, articleKey);
  if (!row) throw new Error('Article not found.');
  const deduped = dedupeCodesByCode(codes);
  const coverage = computeOverallCoverageFromCodes(deduped);
  await pb.collection('consolidatedArticles').update(row.id, {
    codes: deduped,
    numCodes: deduped.length,
    overallCoverage: coverage ?? 0,
  });
}

/**
 * Re-point every joined row from `oldKey` to `newKey`. Used by rename and
 * merge. Idempotent-ish: a second run finds nothing under `oldKey` and is
 * a no-op.
 */
export async function migrateArticleKeyAsAdmin(
  slug: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const pb = await createAdminClient();

  for (const collection of ARTICLE_KEY_COLLECTIONS) {
    const rows = await pb.collection(collection).getFullList({
      filter: pb.filter('specialtySlug = {:slug} && articleKey = {:key}', {
        slug,
        key: oldKey,
      }),
    });
    await Promise.all(
      rows.map((r) => pb.collection(collection).update(r.id, { articleKey: newKey })),
    );
  }

  await repointArticleComments(slug, oldKey, newKey);
}

/** Re-point article-kind reviewComments. Lists without a server-side
 *  filter (PB 0.37.x 400s on some filter combos for this collection — see
 *  `listReviewComments`) and narrows in JS; per-specialty volume is low. */
async function repointArticleComments(
  slug: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb.collection<ReviewCommentRecord>('reviewComments').getFullList();
  const matches = rows.filter(
    (r) =>
      r.specialtySlug === slug && r.recordKind === 'article' && r.recordKey === oldKey,
  );
  await Promise.all(
    matches.map((r) =>
      pb.collection('reviewComments').update(r.id, { recordKey: newKey }),
    ),
  );
}

/**
 * Rename a consolidated article. Because the key is content-derived from
 * the title, a rename usually changes the key — every joined row must
 * migrate. Ordering: joined rows first, the article row last. PB has no
 * transactions, so a crash mid-rename leaves the old key still resolvable
 * (reviews/backlog intact) rather than orphaned.
 *
 * Returns `{ conflict: true }` when another row already owns the new key
 * (the UI offers a merge instead). `upd::<articleId>` keys don't change on
 * a title edit — that path is a plain title update with no migration.
 */
export async function renameConsolidatedArticleByKeyAsAdmin(
  slug: string,
  articleKey: string,
  newTitle: string,
): Promise<{ newKey: string } | { conflict: true }> {
  const pb = await createAdminClient();
  const row = await getArticleByKey(slug, articleKey);
  if (!row) throw new Error('Article not found.');

  const title = newTitle.trim();
  if (!title) throw new Error('Title is required.');

  const newKey = computeArticleKey({
    specialtySlug: slug,
    articleTitle: title,
    articleId: row.articleId,
    category: row.category,
  });
  if (!newKey) throw new Error('Could not derive a valid article key.');

  const prevTitles = toStringArray(row.previousArticleTitleSuggestions);
  if (typeof row.articleTitle === 'string') {
    const old = row.articleTitle.trim();
    if (old && old !== title && !prevTitles.includes(old)) prevTitles.push(old);
  }

  // Title-only change (e.g. `upd::` rows, or a normalization-equivalent
  // title) — the key is unchanged, so no migration is needed.
  if (newKey === articleKey) {
    await pb.collection('consolidatedArticles').update(row.id, {
      articleTitle: title,
      previousArticleTitleSuggestions: prevTitles,
    });
    return { newKey };
  }

  const conflict = await getArticleByKey(slug, newKey);
  if (conflict) return { conflict: true };

  await migrateArticleKeyAsAdmin(slug, articleKey, newKey);
  await pb.collection('consolidatedArticles').update(row.id, {
    articleTitle: title,
    articleKey: newKey,
    previousArticleTitleSuggestions: prevTitles,
  });
  return { newKey };
}

/**
 * Merge `sourceKeys` into `targetKey`. The target keeps its title,
 * category, and PB id; it absorbs the union of codes and the merged
 * metadata (see `computeMergedArticleFields`).
 *
 * Per-collection handling of each source:
 * - articleReviews: deleted (user decision — the target's review stands)
 * - reviewComments: re-pointed to the target (preserve the audit trail)
 * - articleSources / litSearchRuns / draftRuns: re-pointed to the target
 *   so provenance and run history survive rather than orphaning
 * - articleBacklog: the target's row is kept; if it has none, the first
 *   source row is re-pointed (preserving assignee/status/draft URL) and
 *   the rest deleted
 * - the consolidatedArticles row itself: deleted
 *
 * Blocks merging two `upd::` rows with different CMS article ids.
 */
export async function mergeConsolidatedArticlesAsAdmin(
  slug: string,
  targetKey: string,
  sourceKeys: string[],
): Promise<{ mergedCodes: number }> {
  const pb = await createAdminClient();
  const target = await getArticleByKey(slug, targetKey);
  if (!target) throw new Error('Merge target not found.');

  const sources: ConsolidatedArticleRecord[] = [];
  for (const key of sourceKeys) {
    if (!key || key === targetKey) continue;
    const src = await getArticleByKey(slug, key);
    if (src) sources.push(src);
  }
  if (sources.length === 0) throw new Error('No source articles to merge.');

  for (const src of sources) {
    const a = target.articleId?.trim();
    const b = src.articleId?.trim();
    if (a && b && a !== b) {
      throw new Error(
        'Cannot merge two update-article rows with different CMS article IDs.',
      );
    }
  }

  const merged = computeMergedArticleFields(target, sources);

  const targetUpdate: Record<string, unknown> = {
    codes: merged.codes,
    numCodes: merged.numCodes,
    overallCoverage: merged.overallCoverage ?? 0,
    previousArticleTitleSuggestions: merged.previousArticleTitleSuggestions,
  };
  if (merged.overallImportance !== undefined) {
    targetUpdate.overallImportance = merged.overallImportance;
  }
  if (merged.justification !== undefined) {
    targetUpdate.justification = merged.justification;
  }
  await pb.collection('consolidatedArticles').update(target.id, targetUpdate);

  const targetBacklog = await firstByKey<ArticleBacklogRecord>(
    'articleBacklog',
    slug,
    targetKey,
  );
  let backlogReassigned = targetBacklog !== null;

  for (const src of sources) {
    // Delete the source's review (user decision).
    await deleteAllByKey('articleReviews', slug, src.articleKey ?? '');
    // Preserve provenance: re-point comments and source/run history.
    await repointArticleComments(slug, src.articleKey ?? '', targetKey);
    await repointKeyField('articleSources', slug, src.articleKey ?? '', targetKey);
    await repointKeyField('articleLitSearchRuns', slug, src.articleKey ?? '', targetKey);
    await repointKeyField('articleDraftRuns', slug, src.articleKey ?? '', targetKey);

    // Backlog: keep the target's row; otherwise adopt the first source row.
    const srcBacklog = await firstByKey<ArticleBacklogRecord>(
      'articleBacklog',
      slug,
      src.articleKey ?? '',
    );
    if (srcBacklog) {
      if (!backlogReassigned) {
        await pb
          .collection('articleBacklog')
          .update(srcBacklog.id, { articleKey: targetKey });
        backlogReassigned = true;
      } else {
        await pb.collection('articleBacklog').delete(srcBacklog.id);
      }
    }

    // Finally drop the source consolidatedArticles row.
    await pb.collection('consolidatedArticles').delete(src.id);
  }

  return { mergedCodes: merged.numCodes };
}

async function firstByKey<T>(
  collection: string,
  slug: string,
  articleKey: string,
): Promise<T | null> {
  if (!articleKey) return null;
  const pb = await createAdminClient();
  try {
    return (await pb.collection(collection).getFirstListItem(
      pb.filter('specialtySlug = {:slug} && articleKey = {:key}', {
        slug,
        key: articleKey,
      }),
    )) as T;
  } catch {
    return null;
  }
}

async function deleteAllByKey(
  collection: string,
  slug: string,
  articleKey: string,
): Promise<void> {
  if (!articleKey) return;
  const pb = await createAdminClient();
  const rows = await pb.collection(collection).getFullList({
    filter: pb.filter('specialtySlug = {:slug} && articleKey = {:key}', {
      slug,
      key: articleKey,
    }),
  });
  await Promise.all(rows.map((r) => pb.collection(collection).delete(r.id)));
}

async function repointKeyField(
  collection: string,
  slug: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (!oldKey || oldKey === newKey) return;
  const pb = await createAdminClient();
  const rows = await pb.collection(collection).getFullList({
    filter: pb.filter('specialtySlug = {:slug} && articleKey = {:key}', {
      slug,
      key: oldKey,
    }),
  });
  await Promise.all(
    rows.map((r) => pb.collection(collection).update(r.id, { articleKey: newKey })),
  );
}
