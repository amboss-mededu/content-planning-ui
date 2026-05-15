import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ArticleSourceRecord } from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function listArticleSourceCount(slug: string): Promise<number> {
  await connection();
  const pb = await userClient();
  const list = await pb.collection<ArticleSourceRecord>('articleSources').getList(1, 1, {
    filter: `specialtySlug = "${slug}"`,
    skipTotal: false,
  });
  return list.totalItems;
}

/**
 * Returns all sources for the specialty grouped by `articleRecordId`,
 * so the backlog view can render per-article source counts and a
 * drawer's row list without a second fetch.
 */
export async function listArticleSourcesByArticle(
  slug: string,
): Promise<Record<string, ArticleSourceRecord[]>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleSourceRecord>('articleSources')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const out: Record<string, ArticleSourceRecord[]> = {};
  for (const r of rows) {
    const bucket = out[r.articleRecordId] ?? [];
    bucket.push(r);
    out[r.articleRecordId] = bucket;
  }
  // Stable order per article: rank ascending (nulls last), then title.
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => {
      const ar = a.rank ?? Number.POSITIVE_INFINITY;
      const br = b.rank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return (a.title ?? '').localeCompare(b.title ?? '');
    });
  }
  return out;
}

/**
 * Cross-specialty bulk fetch by `articleRecordId`. Used by the global
 * "My Backlog" view so each row's source count + drawer have data
 * without paying one round-trip per article. Grouped by id so the
 * drawer keeps its O(1) lookup.
 */
export async function listArticleSourcesForArticleIds(
  ids: string[],
): Promise<Record<string, ArticleSourceRecord[]>> {
  const out: Record<string, ArticleSourceRecord[]> = {};
  const unique = Array.from(new Set(ids.filter((s) => s.length > 0)));
  if (unique.length === 0) return out;
  await connection();
  const pb = await userClient();
  const CHUNK = 30;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const filter = chunk.map((id) => `articleRecordId = "${id}"`).join(' || ');
    const rows = await pb
      .collection<ArticleSourceRecord>('articleSources')
      .getFullList({ filter });
    for (const r of rows) {
      const bucket = out[r.articleRecordId] ?? [];
      bucket.push(r);
      out[r.articleRecordId] = bucket;
    }
  }
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => {
      const ar = a.rank ?? Number.POSITIVE_INFINITY;
      const br = b.rank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return (a.title ?? '').localeCompare(b.title ?? '');
    });
  }
  return out;
}

/**
 * Single-article admin reader for the writing pipeline. Sorted by rank
 * ascending (the priority the source should be cited at).
 */
export async function listArticleSourcesForArticleAsAdmin(
  slug: string,
  articleRecordId: string,
): Promise<ArticleSourceRecord[]> {
  const pb = await createAdminClient();
  return pb.collection<ArticleSourceRecord>('articleSources').getFullList({
    filter: `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`,
    sort: 'rank,title',
  });
}

/**
 * Bulk-insert ranked sources for a single article from the
 * literature-search worker. Admin-side (no cookies in scope). Replaces
 * any existing rows for this article — re-running a search wipes the
 * prior set rather than accumulating duplicates.
 */
export async function bulkInsertArticleSourcesAsAdmin(
  slug: string,
  articleRecordId: string,
  rows: Array<
    Omit<
      ArticleSourceRecord,
      | 'id'
      | 'created'
      | 'updated'
      | 'collectionId'
      | 'collectionName'
      | 'specialtySlug'
      | 'articleRecordId'
    >
  >,
): Promise<void> {
  const pb = await createAdminClient();
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`;
  const existing = await pb
    .collection<ArticleSourceRecord>('articleSources')
    .getFullList({ filter });
  await Promise.all(existing.map((r) => pb.collection('articleSources').delete(r.id)));
  for (const row of rows) {
    await pb.collection('articleSources').create({
      specialtySlug: slug,
      articleRecordId,
      ...row,
    });
  }
}
