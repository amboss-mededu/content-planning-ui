import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
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
 * Returns reviews for the specialty as a record keyed by the
 * consolidatedArticles record id, so the view layer can look up status
 * for each row in O(1) without re-querying.
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
  for (const r of rows) out[r.articleRecordId] = r;
  return out;
}

/**
 * Upsert a review for the given article record. If a row already exists
 * for this (slug, articleRecordId) pair, update it; otherwise create.
 * The `articleReviews` collection has a unique index on this pair so we
 * could in theory rely on a server-side upsert, but PocketBase's JS SDK
 * doesn't expose one — fetch-then-update / fetch-then-create.
 */
export async function setArticleReview(
  slug: string,
  articleRecordId: string,
  status: ArticleReviewStatus,
  reviewerEmail: string | null,
  notes?: string,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`;
  const payload: Record<string, unknown> = {
    specialtySlug: slug,
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
      return;
    }
    throw e;
  }
}

export async function clearArticleReview(
  slug: string,
  articleRecordId: string,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`;
  try {
    const existing = await pb
      .collection<ArticleReviewRecord>('articleReviews')
      .getFirstListItem(filter);
    await pb.collection('articleReviews').delete(existing.id);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
}
