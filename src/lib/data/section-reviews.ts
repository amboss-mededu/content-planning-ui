import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ArticleReviewStatus, SectionReviewRecord } from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Reviews keyed by the stable `sectionKey`. Empty-key rows are
 * filtered out — they're zombies from a pre-keys consolidation re-run.
 */
export async function listSectionReviews(
  slug: string,
): Promise<Record<string, SectionReviewRecord>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<SectionReviewRecord>('sectionReviews')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const out: Record<string, SectionReviewRecord> = {};
  for (const r of rows) {
    if (!r.sectionKey) continue;
    out[r.sectionKey] = r;
  }
  return out;
}

export async function setSectionReview(
  slug: string,
  sectionKey: string,
  sectionRecordId: string,
  status: ArticleReviewStatus,
  reviewerEmail: string | null,
  notes?: string,
): Promise<void> {
  if (!sectionKey) {
    throw new Error('setSectionReview: sectionKey is required');
  }
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && sectionKey = "${sectionKey}"`;
  const payload: Record<string, unknown> = {
    specialtySlug: slug,
    sectionKey,
    sectionRecordId,
    status,
    reviewerEmail: reviewerEmail ?? '',
    reviewedAt: Date.now(),
  };
  if (notes !== undefined) payload.notes = notes;

  try {
    const existing = await pb
      .collection<SectionReviewRecord>('sectionReviews')
      .getFirstListItem(filter);
    await pb.collection('sectionReviews').update(existing.id, payload);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('sectionReviews').create(payload);
      return;
    }
    throw e;
  }
}

export async function clearSectionReview(
  slug: string,
  sectionKey: string,
): Promise<void> {
  if (!sectionKey) return;
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && sectionKey = "${sectionKey}"`;
  try {
    const existing = await pb
      .collection<SectionReviewRecord>('sectionReviews')
      .getFirstListItem(filter);
    await pb.collection('sectionReviews').delete(existing.id);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
}

/**
 * Wipe every `sectionReviews` row for a specialty. Used by the
 * specialty-level reset path.
 */
export async function deleteSectionReviewsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<SectionReviewRecord>('sectionReviews')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('sectionReviews').delete(r.id)));
}
