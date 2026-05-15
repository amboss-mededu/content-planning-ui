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

function sortSources(list: ArticleSourceRecord[]): void {
  list.sort((a, b) => {
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

/**
 * Returns all sources for the specialty grouped by `articleRecordId`,
 * so the backlog view can render per-article source counts and a
 * drawer's row list without a second fetch.
 *
 * @deprecated Prefer `listArticleSourcesByArticleKey` — the PB id keying
 * is orphaned by a consolidation re-run, the stable key survives.
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
  for (const key of Object.keys(out)) sortSources(out[key]);
  return out;
}

/**
 * Returns all sources for the specialty grouped by stable `articleKey`.
 * Used by the per-specialty backlog view; survives a consolidation
 * re-run because the producer's articleKey is content-derived.
 */
export async function listArticleSourcesByArticleKey(
  slug: string,
): Promise<Record<string, ArticleSourceRecord[]>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleSourceRecord>('articleSources')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const out: Record<string, ArticleSourceRecord[]> = {};
  for (const r of rows) {
    if (!r.articleKey) continue;
    const bucket = out[r.articleKey] ?? [];
    bucket.push(r);
    out[r.articleKey] = bucket;
  }
  for (const key of Object.keys(out)) sortSources(out[key]);
  return out;
}

/**
 * Cross-specialty bulk fetch by `articleRecordId`. Used by the global
 * "My Backlog" view so each row's source count + drawer have data
 * without paying one round-trip per article. Grouped by id so the
 * drawer keeps its O(1) lookup.
 *
 * @deprecated Prefer `listArticleSourcesForArticleKeys`.
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
  for (const key of Object.keys(out)) sortSources(out[key]);
  return out;
}

/**
 * Cross-specialty bulk fetch by stable `articleKey`. Used by the
 * global "My Backlog" view. Survives consolidation re-runs because
 * the key is content-derived; new sources inserted after a re-run
 * resolve back to the same key.
 */
export async function listArticleSourcesForArticleKeys(
  keys: string[],
): Promise<Record<string, ArticleSourceRecord[]>> {
  const out: Record<string, ArticleSourceRecord[]> = {};
  const unique = Array.from(new Set(keys.filter((s) => s.length > 0)));
  if (unique.length === 0) return out;
  await connection();
  const pb = await userClient();
  const CHUNK = 30;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    // PB filter strings need each key escaped; articleKey is content-
    // derived and ASCII so a simple equality match is safe.
    const filter = chunk.map((k) => `articleKey = "${k}"`).join(' || ');
    const rows = await pb
      .collection<ArticleSourceRecord>('articleSources')
      .getFullList({ filter });
    for (const r of rows) {
      if (!r.articleKey) continue;
      const bucket = out[r.articleKey] ?? [];
      bucket.push(r);
      out[r.articleKey] = bucket;
    }
  }
  for (const key of Object.keys(out)) sortSources(out[key]);
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
 *
 * Identifies the target by `articleKey` (preferred — survives a
 * consolidation re-run) and writes `articleRecordId` alongside it so
 * the legacy id-keyed path keeps working for one overlap release.
 */
export async function bulkInsertArticleSourcesAsAdmin(
  slug: string,
  articleRecordId: string,
  articleKey: string,
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
      | 'articleKey'
    >
  >,
): Promise<void> {
  const pb = await createAdminClient();
  // Delete any prior rows that match either the stable key or the
  // (legacy) PB id — handles the case where a partial backfill left
  // some rows key-less; we still want re-runs to replace them.
  const filterParts: string[] = [];
  if (articleKey) filterParts.push(`articleKey = "${articleKey}"`);
  if (articleRecordId) filterParts.push(`articleRecordId = "${articleRecordId}"`);
  if (filterParts.length === 0) return;
  const filter = `specialtySlug = "${slug}" && (${filterParts.join(' || ')})`;
  const existing = await pb
    .collection<ArticleSourceRecord>('articleSources')
    .getFullList({ filter });
  await Promise.all(existing.map((r) => pb.collection('articleSources').delete(r.id)));
  for (const row of rows) {
    await pb.collection('articleSources').create({
      specialtySlug: slug,
      articleRecordId,
      articleKey,
      ...row,
    });
  }
}
