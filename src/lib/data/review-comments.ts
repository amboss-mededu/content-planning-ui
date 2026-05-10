import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type { ReviewCommentRecord, ReviewRecordKind } from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Returns the comments for a specialty + record kind (article or section)
 * grouped by the article/section record id, oldest first within each
 * thread. The view layer can do an O(1) lookup per row.
 */
export async function listReviewComments(
  slug: string,
  kind: ReviewRecordKind,
): Promise<Record<string, ReviewCommentRecord[]>> {
  await connection();
  const pb = await userClient();
  // Avoid filter+sort combos that PB 0.37.x returns 400 for on this
  // collection. List with no server-side filter or sort, then narrow +
  // order in JS. Per-specialty thread volume is small.
  const rows = await pb.collection<ReviewCommentRecord>('reviewComments').getFullList();
  const filtered = rows
    .filter((r) => r.specialtySlug === slug && r.recordKind === kind)
    .sort((a, b) => a.created.localeCompare(b.created));
  const out: Record<string, ReviewCommentRecord[]> = {};
  for (const r of filtered) {
    const list = out[r.recordId] ?? [];
    list.push(r);
    out[r.recordId] = list;
  }
  return out;
}

export async function addReviewComment(
  slug: string,
  kind: ReviewRecordKind,
  recordId: string,
  authorEmail: string | null,
  body: string,
): Promise<ReviewCommentRecord> {
  const pb = await userClient();
  return pb.collection<ReviewCommentRecord>('reviewComments').create({
    specialtySlug: slug,
    recordKind: kind,
    recordId,
    authorEmail: authorEmail ?? '',
    body,
  });
}

/** Delete a comment by id. PB's deleteRule (added in
 *  1778439508_review_comments_author_delete.js) restricts this to
 *  comments where authorEmail matches the requesting user's email, so
 *  editors can only delete their own. */
export async function deleteReviewComment(commentId: string): Promise<void> {
  const pb = await userClient();
  await pb.collection('reviewComments').delete(commentId);
}
