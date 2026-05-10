import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
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
 * Reviews keyed by the consolidatedSections record id, mirroring the
 * articleReviews shape so the view layer can do an O(1) status lookup
 * per row.
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
  for (const r of rows) out[r.sectionRecordId] = r;
  return out;
}

export async function setSectionReview(
  slug: string,
  sectionRecordId: string,
  status: ArticleReviewStatus,
  reviewerEmail: string | null,
  notes?: string,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && sectionRecordId = "${sectionRecordId}"`;
  const payload: Record<string, unknown> = {
    specialtySlug: slug,
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
  sectionRecordId: string,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && sectionRecordId = "${sectionRecordId}"`;
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
