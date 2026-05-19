import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { computeArticleKey } from '@/lib/data/article-keys';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ArticleSuggestionRecord,
  ConsolidatedArticleRecord,
  PbRecord,
} from '@/lib/pb/types';

/**
 * Inject `articleKey` into a row about to be inserted into one of the
 * article-shaped collections. Keeps producers honest — the bulk-insert
 * helpers are the only path into PB, so attaching the key here means a
 * caller cannot forget. Falls back to no-op when title/articleId are
 * both missing, leaving the row's key empty (UI will filter it out).
 */
function withArticleKey(
  slug: string,
  r: Record<string, unknown>,
): Record<string, unknown> {
  const articleTitle = typeof r.articleTitle === 'string' ? r.articleTitle : undefined;
  const articleId = typeof r.articleId === 'string' ? r.articleId : undefined;
  const category = typeof r.category === 'string' ? r.category : undefined;
  const key = computeArticleKey({
    specialtySlug: slug,
    articleTitle,
    articleId,
    category,
  });
  return key ? { ...r, articleKey: key } : r;
}

import type {
  ArticleUpdateSuggestion,
  ConsolidatedArticle,
  NewArticleSuggestion,
} from '@/lib/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

// Strip PB system fields except `id` (the review pass keys reviews on the
// PB record id, so consumers need it to remain available) plus the
// specialtySlug join column so the type matches the legacy repository
// shape consumers expect.
function strip<T>(rows: PbRecord[]): T[] {
  return rows.map((row) => {
    const {
      created: _created,
      updated: _updated,
      collectionId: _ci,
      collectionName: _cn,
      specialtySlug: _slug,
      ...rest
    } = row as PbRecord & { specialtySlug?: string };
    return rest as T;
  });
}

export async function listConsolidatedArticles(
  slug: string,
): Promise<ConsolidatedArticle[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ConsolidatedArticleRecord>('consolidatedArticles')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  return strip<ConsolidatedArticle>(rows);
}

/**
 * Bulk fetch of consolidatedArticles by `articleKey`, regardless of
 * specialty. Used by the global "My Backlog" view so each backlog row
 * resolves to the current PB row via the stable key.
 */
export async function listConsolidatedArticlesForKeys(
  keys: string[],
): Promise<Record<string, ConsolidatedArticle>> {
  const out: Record<string, ConsolidatedArticle> = {};
  const unique = Array.from(new Set(keys.filter((s) => s.length > 0)));
  if (unique.length === 0) return out;
  await connection();
  const pb = await userClient();
  const CHUNK = 30;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const filter = chunk
      .map((k) => `articleKey = "${k.replace(/"/g, '\\"')}"`)
      .join(' || ');
    const rows = await pb
      .collection<ConsolidatedArticleRecord>('consolidatedArticles')
      .getFullList({ filter });
    const stripped = strip<ConsolidatedArticle>(rows);
    for (const r of stripped) {
      if (r.articleKey) out[r.articleKey] = r;
    }
  }
  return out;
}

export async function listNewArticleSuggestions(
  slug: string,
): Promise<NewArticleSuggestion[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleSuggestionRecord>('newArticleSuggestions')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  return strip<NewArticleSuggestion>(rows);
}

/**
 * Bulk fetch of new-article suggestions by `articleKey`, regardless of
 * specialty. Used by the global "My Backlog" view so each backlog
 * row's title/type/codes resolves through the stable key (suggestions
 * keep their key across re-seeds and consolidation re-runs; PB ids
 * don't). Returns a map keyed by `articleKey` for O(1) lookup.
 */
export async function listNewArticleSuggestionsForKeys(
  keys: string[],
): Promise<Record<string, NewArticleSuggestion>> {
  const out: Record<string, NewArticleSuggestion> = {};
  const unique = Array.from(new Set(keys.filter((s) => s.length > 0)));
  if (unique.length === 0) return out;
  await connection();
  const pb = await userClient();
  const CHUNK = 30;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const filter = chunk
      .map((k) => `articleKey = "${k.replace(/"/g, '\\"')}"`)
      .join(' || ');
    const rows = await pb
      .collection<ArticleSuggestionRecord>('newArticleSuggestions')
      .getFullList({ filter });
    const stripped = strip<NewArticleSuggestion>(rows);
    for (const r of stripped) {
      if (r.articleKey) out[r.articleKey] = r;
    }
  }
  return out;
}

export async function listArticleUpdateSuggestions(
  slug: string,
): Promise<ArticleUpdateSuggestion[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleSuggestionRecord>('articleUpdateSuggestions')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  return strip<ArticleUpdateSuggestion>(rows);
}

// --- Admin variants for workflow contexts ----------------------------------

async function clearForSpecialty(collection: string, slug: string): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection(collection)
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection(collection).delete(r.id)));
}

export async function deleteConsolidatedArticlesForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  await clearForSpecialty('consolidatedArticles', slug);
}

/**
 * Delete consolidated-article rows whose category is in `categories`.
 * Used by the per-category re-run path so the secondary stage only
 * touches the buckets actually being rebuilt.
 *
 * Fetches by `specialtySlug` and filters categories client-side — the
 * same pattern `clearStagingForCategories` uses, because PB's filter
 * parser rejects 400 on category values that mix `;`, `:`, `,` even
 * through `pb.filter()` parameterization.
 */
export async function deleteConsolidatedArticlesForCategoriesAsAdmin(
  slug: string,
  categories: string[],
): Promise<number> {
  if (categories.length === 0) return 0;
  const pb = await createAdminClient();
  const set = new Set(categories.map((category) => category.trim()));
  const filter = pb.filter('specialtySlug = {:slug}', { slug });
  const rows = await pb
    .collection<ConsolidatedArticleRecord>('consolidatedArticles')
    .getFullList({ filter });
  const toDelete = rows.filter(
    (r) => r.category !== undefined && set.has(r.category.trim()),
  );
  await Promise.all(
    toDelete.map((r) => pb.collection('consolidatedArticles').delete(r.id)),
  );
  return toDelete.length;
}

export async function deleteNewArticleSuggestionsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  await clearForSpecialty('newArticleSuggestions', slug);
}

export async function deleteArticleUpdateSuggestionsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  await clearForSpecialty('articleUpdateSuggestions', slug);
}

export async function bulkInsertConsolidatedArticlesAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb
      .collection('consolidatedArticles')
      .create({ specialtySlug: slug, ...withArticleKey(slug, r) });
  }
}

export async function listNewArticleSuggestionsAsAdmin(
  slug: string,
): Promise<Array<ArticleSuggestionRecord>> {
  const pb = await createAdminClient();
  return pb
    .collection<ArticleSuggestionRecord>('newArticleSuggestions')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
}

export async function getNewArticleSuggestionByIdAsAdmin(
  id: string,
): Promise<ArticleSuggestionRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<ArticleSuggestionRecord>('newArticleSuggestions')
      .getOne(id);
  } catch {
    return null;
  }
}

export async function listArticleUpdateSuggestionsAsAdmin(
  slug: string,
): Promise<Array<ArticleSuggestionRecord>> {
  const pb = await createAdminClient();
  return pb
    .collection<ArticleSuggestionRecord>('articleUpdateSuggestions')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
}

export async function bulkInsertNewArticleSuggestionsAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb
      .collection('newArticleSuggestions')
      .create({ specialtySlug: slug, ...withArticleKey(slug, r) });
  }
}

export async function bulkInsertArticleUpdateSuggestionsAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb
      .collection('articleUpdateSuggestions')
      .create({ specialtySlug: slug, ...withArticleKey(slug, r) });
  }
}
