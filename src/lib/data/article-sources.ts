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
 * Mark a single articleSources row as uploaded to Gemini Files API.
 * `uri` becomes the canonical pointer the writing pipeline attaches
 * as a FilePart on `generateText`; `geminiFilename` is the resource
 * name (e.g. `files/abc-xyz`) so we can later DELETE on cleanup.
 *
 * The URI is short-lived (~48h per Google). Treat it as a transient
 * per-run cache — the writing workflow re-uploads if expired.
 */
export async function markSourceUploadedAsAdmin(
  sourceId: string,
  patch: { uri: string; mimeType: string; geminiFilename: string },
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleSources').update(sourceId, patch);
}

/**
 * Mark a single articleSources row as registered in Cortex CMS.
 * The cortexSourceId is the canonical ID used in the final article
 * HTML when citing the source.
 */
export async function markSourceCortexRegisteredAsAdmin(
  sourceId: string,
  cortexSourceId: string,
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleSources').update(sourceId, { cortexSourceId });
}

export async function setSourceUrlAsAdmin(sourceId: string, url: string): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleSources').update(sourceId, { url });
}

export async function setSourceDoiAsAdmin(sourceId: string, doi: string): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleSources').update(sourceId, { doi });
}

export async function setSourceNotesAsAdmin(
  sourceId: string,
  notes: string,
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleSources').update(sourceId, { notes });
}

/**
 * Renumber `priority` on the given source IDs in array order (1..N).
 * Editor-controlled ordering for the sources-approved priority list.
 */
export async function setSourcesPriorityAsAdmin(sourceIds: string[]): Promise<void> {
  const pb = await createAdminClient();
  for (let i = 0; i < sourceIds.length; i++) {
    await pb.collection('articleSources').update(sourceIds[i], { priority: i + 1 });
  }
}

/**
 * Persist an editor decision on a single source. Pass `status: null` to
 * clear the decision back to "not yet reviewed". Reviewer email +
 * timestamp are stamped whenever the status is set; cleared together
 * with the status.
 */
export async function setArticleSourceReviewAsAdmin(
  sourceId: string,
  status: 'approved' | 'rejected' | null,
  reviewerEmail: string,
): Promise<void> {
  const pb = await createAdminClient();
  if (status === null) {
    await pb.collection('articleSources').update(sourceId, {
      reviewStatus: '',
      reviewerEmail: '',
      reviewedAt: null,
    });
    return;
  }
  await pb.collection('articleSources').update(sourceId, {
    reviewStatus: status,
    reviewerEmail,
    reviewedAt: Date.now(),
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
): Promise<number> {
  const pb = await createAdminClient();
  // Delete any prior rows that match either the stable key or the
  // (legacy) PB id — handles the case where a partial backfill left
  // some rows key-less; we still want re-runs to replace them.
  const filterParts: string[] = [];
  if (articleKey) filterParts.push(`articleKey = "${articleKey}"`);
  if (articleRecordId) filterParts.push(`articleRecordId = "${articleRecordId}"`);
  if (filterParts.length === 0) return 0;
  const filter = `specialtySlug = "${slug}" && (${filterParts.join(' || ')})`;
  const existing = await pb
    .collection<ArticleSourceRecord>('articleSources')
    .getFullList({ filter });
  // Tolerate 404 on individual deletes — a concurrent caller (e.g. an
  // n8n callback retrying) may have already removed the row. Anything
  // else still throws so real errors aren't masked.
  await Promise.all(
    existing.map(async (r) => {
      try {
        await pb.collection('articleSources').delete(r.id);
      } catch (e) {
        const status = (e as { status?: number })?.status;
        if (status !== 404) throw e;
      }
    }),
  );
  let inserted = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // PB rejects nulls on optional number columns and unknown keys (e.g.
    // n8n may include `index`, `provider`, `year`, etc. that aren't on
    // the schema). Drop null/undefined and project to the known column set
    // so a single bad row can't 404/400 the whole batch.
    const payload: Record<string, unknown> = {
      specialtySlug: slug,
      articleRecordId,
      articleKey,
    };
    const allowed: ReadonlySet<keyof ArticleSourceRecord> = new Set([
      'ribosomId',
      'title',
      'doi',
      'url',
      'journal',
      'journalNlm',
      'sourceType',
      'predatoryJournalRisk',
      'totalCitations',
      'impactFactor',
      'rank',
      'subtopics',
      'llmSummary',
      'justification',
      'superseded',
      'priority',
      'originalFilename',
      'geminiFilename',
      'uri',
      'mimeType',
      'cortexSourceId',
      'reviewStatus',
      'reviewerEmail',
      'reviewedAt',
      'notes',
    ]);
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) continue;
      if (allowed.has(k as keyof ArticleSourceRecord)) payload[k] = v;
    }
    try {
      await pb.collection('articleSources').create(payload);
      inserted++;
    } catch (e) {
      const pbErr = e as { status?: number; response?: { data?: unknown } };
      console.error('[articleSources] insert rejected for row', {
        index: i,
        articleKey,
        articleRecordId,
        payload,
        pbStatus: pbErr?.status,
        pbDetail: pbErr?.response?.data,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
  return inserted;
}

/**
 * Wipe every `articleSources` row for a single article. Used by the
 * "Reset article" action to scrub the literature-search results before
 * the editor re-runs the pipeline. Scoped by `specialtySlug` so a stale
 * articleKey collision across specialties can't widen the blast radius.
 */
export async function deleteArticleSourcesByArticleKeyAsAdmin(
  slug: string,
  articleKey: string,
): Promise<number> {
  if (!articleKey) return 0;
  const pb = await createAdminClient();
  const rows = await pb.collection<ArticleSourceRecord>('articleSources').getFullList({
    filter: `specialtySlug = "${slug}" && articleKey = "${articleKey}"`,
  });
  await Promise.all(rows.map((r) => pb.collection('articleSources').delete(r.id)));
  return rows.length;
}

/**
 * Wipe every `articleSources` row for a whole specialty. Part of the
 * full clean-slate cascade when code extraction is re-run — the literature
 * search that produced these is downstream of the codes being replaced.
 */
export async function deleteArticleSourcesForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb.collection<ArticleSourceRecord>('articleSources').getFullList({
    filter: `specialtySlug = "${slug}"`,
  });
  await Promise.all(rows.map((r) => pb.collection('articleSources').delete(r.id)));
}
