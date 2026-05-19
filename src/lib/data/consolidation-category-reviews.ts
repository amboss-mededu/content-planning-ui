import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ConsolidationCategoryReviewRecord,
  ConsolidationCategoryReviewStatus,
} from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Returns the consolidation-category review rows for the specialty keyed
 * by `category` so the view can do an O(1) lookup per category. Categories
 * with no row are simply absent from the map.
 */
export async function listConsolidationCategoryReviews(
  slug: string,
): Promise<Record<string, ConsolidationCategoryReviewRecord>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ConsolidationCategoryReviewRecord>('consolidationCategoryReviews')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const out: Record<string, ConsolidationCategoryReviewRecord> = {};
  for (const r of rows) out[r.category] = r;
  return out;
}

/**
 * Upsert (status != null) or delete (status == null) the per-category
 * review row. Only `'flagged-for-rerun'` is a valid persisted status —
 * the "all approved" state is derived from articleReviews/sectionReviews
 * at read time, not stored.
 */
export async function setConsolidationCategoryReview(
  slug: string,
  category: string,
  status: ConsolidationCategoryReviewStatus | null,
  reviewerEmail: string | null,
  notes?: string,
): Promise<void> {
  const pb = await userClient();
  // Parameterize: category values can contain `;`, `:`, `,`, all of which
  // confuse PB's filter parser when interpolated as a literal string.
  const filter = pb.filter('specialtySlug = {:slug} && category = {:cat}', {
    slug,
    cat: category,
  });

  if (status === null) {
    try {
      const existing = await pb
        .collection<ConsolidationCategoryReviewRecord>('consolidationCategoryReviews')
        .getFirstListItem(filter);
      await pb.collection('consolidationCategoryReviews').delete(existing.id);
    } catch (e) {
      if (e instanceof ClientResponseError && e.status === 404) return;
      throw e;
    }
    return;
  }

  const payload: Record<string, unknown> = {
    specialtySlug: slug,
    category,
    status,
    reviewerEmail: reviewerEmail ?? '',
    reviewedAt: Date.now(),
  };
  if (notes !== undefined) payload.notes = notes;

  try {
    const existing = await pb
      .collection<ConsolidationCategoryReviewRecord>('consolidationCategoryReviews')
      .getFirstListItem(filter);
    await pb.collection('consolidationCategoryReviews').update(existing.id, payload);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('consolidationCategoryReviews').create(payload);
      return;
    }
    throw e;
  }
}

/**
 * Wipe every `consolidationCategoryReviews` row for a specialty. Used
 * by the specialty-level reset path. The collection isn't written to
 * from the UI anymore (since pt 2), but historical rows can linger.
 */
export async function deleteConsolidationCategoryReviewsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ConsolidationCategoryReviewRecord>('consolidationCategoryReviews')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(
    rows.map((r) => pb.collection('consolidationCategoryReviews').delete(r.id)),
  );
}
