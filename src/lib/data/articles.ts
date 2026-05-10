import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ArticleSuggestionRecord,
  ConsolidatedArticleRecord,
  PbRecord,
} from '@/lib/pb/types';
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
    await pb.collection('consolidatedArticles').create({ specialtySlug: slug, ...r });
  }
}

export async function bulkInsertNewArticleSuggestionsAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb.collection('newArticleSuggestions').create({ specialtySlug: slug, ...r });
  }
}

export async function bulkInsertArticleUpdateSuggestionsAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb.collection('articleUpdateSuggestions').create({ specialtySlug: slug, ...r });
  }
}
