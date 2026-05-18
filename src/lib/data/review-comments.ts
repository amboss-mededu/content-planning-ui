import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
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
 * Comments grouped by `recordKey` (stable, content-derived — same id
 * space as `articleKey` for kind='article' and `sectionKey` for
 * kind='section'). Empty-key comments are filtered out so the UI never
 * surfaces zombies.
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
    .filter((r) => r.specialtySlug === slug && r.recordKind === kind && r.recordKey)
    .sort((a, b) => a.created.localeCompare(b.created));
  const out: Record<string, ReviewCommentRecord[]> = {};
  for (const r of filtered) {
    const list = out[r.recordKey] ?? [];
    list.push(r);
    out[r.recordKey] = list;
  }
  return out;
}

export async function addReviewComment(
  slug: string,
  kind: ReviewRecordKind,
  recordKey: string,
  recordId: string,
  authorEmail: string | null,
  body: string,
): Promise<ReviewCommentRecord> {
  if (!recordKey) {
    throw new Error('addReviewComment: recordKey is required');
  }
  const pb = await userClient();
  return pb.collection<ReviewCommentRecord>('reviewComments').create({
    specialtySlug: slug,
    recordKind: kind,
    recordKey,
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

/**
 * Admin-auth bulk delete of every comment attached to one article.
 * Used by the "Reset article" action so an editor can scrub the
 * conversation regardless of who originally authored each comment
 * (the per-row deleteRule blocks the user-auth path for foreign
 * authors).
 */
export async function deleteReviewCommentsForArticleAsAdmin(
  slug: string,
  articleKey: string,
): Promise<number> {
  if (!articleKey) return 0;
  const pb = await createAdminClient();
  const rows = await pb.collection<ReviewCommentRecord>('reviewComments').getFullList({
    filter: `specialtySlug = "${slug}" && recordKind = "article" && recordKey = "${articleKey}"`,
  });
  await Promise.all(rows.map((r) => pb.collection('reviewComments').delete(r.id)));
  return rows.length;
}
