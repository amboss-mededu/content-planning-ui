import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ArticleReviewRecord, ArticleReviewStatus } from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Returns reviews for the specialty keyed by `articleKey` — the
 * stable, content-derived identifier (see `article-keys.ts`). Rows with
 * an empty `articleKey` (zombies left behind by an earlier consolidation
 * run) are filtered out so the UI never has to think about them.
 */
export async function listArticleReviews(
  slug: string,
): Promise<Record<string, ArticleReviewRecord>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleReviewRecord>('articleReviews')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const out: Record<string, ArticleReviewRecord> = {};
  for (const r of rows) {
    if (!r.articleKey) continue;
    out[r.articleKey] = r;
  }
  return out;
}

/**
 * Upsert a review keyed by `articleKey`. The collection still carries
 * the legacy `articleRecordId` column for backwards compatibility; we
 * write the current row's PB id into it on upsert so older code paths
 * that haven't been migrated yet still see something sensible.
 */
export async function setArticleReview(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  status: ArticleReviewStatus,
  reviewerEmail: string | null,
  notes?: string,
): Promise<string> {
  if (!articleKey) {
    throw new Error('setArticleReview: articleKey is required');
  }
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  const payload: Record<string, unknown> = {
    specialtySlug: slug,
    articleKey,
    articleRecordId,
    status,
    reviewerEmail: reviewerEmail ?? '',
    reviewedAt: Date.now(),
  };
  if (notes !== undefined) payload.notes = notes;

  try {
    const existing = await pb
      .collection<ArticleReviewRecord>('articleReviews')
      .getFirstListItem(filter);
    await pb.collection('articleReviews').update(existing.id, payload);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('articleReviews').create(payload);
      return articleKey;
    }
    throw e;
  }
  return articleKey;
}

/**
 * Returns the articleKey that was deleted (or null if no row existed).
 * Callers use this to clear matching optimistic patches without waiting
 * for PB realtime to confirm.
 */
export async function clearArticleReview(
  slug: string,
  articleKey: string,
): Promise<string | null> {
  if (!articleKey) return null;
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  try {
    const existing = await pb
      .collection<ArticleReviewRecord>('articleReviews')
      .getFirstListItem(filter);
    await pb.collection('articleReviews').delete(existing.id);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Wipe every `articleReviews` row for a specialty. Used by the
 * specialty-level reset path; mirrors `clearForSpecialty` in
 * `src/lib/data/articles.ts`.
 */
export async function deleteArticleReviewsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ArticleReviewRecord>('articleReviews')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('articleReviews').delete(r.id)));
}
