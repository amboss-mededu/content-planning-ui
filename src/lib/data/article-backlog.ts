import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ArticleBacklogRecord, ArticleBacklogStatus } from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Returns backlog rows for the specialty keyed by `articleRecordId`
 * (the PB id of the underlying newArticleSuggestions row) so the view
 * can look up workflow state per article in O(1).
 */
export async function listArticleBacklog(
  slug: string,
): Promise<Record<string, ArticleBacklogRecord>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleBacklogRecord>('articleBacklog')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const out: Record<string, ArticleBacklogRecord> = {};
  for (const r of rows) out[r.articleRecordId] = r;
  return out;
}

/**
 * Cross-specialty scan: every backlog row currently assigned to
 * `email`. Returned as an array because rows from different
 * specialties can share an `articleRecordId` and a slug-keyed map
 * would lose that distinction.
 */
export async function listArticleBacklogForAssignee(
  email: string,
): Promise<ArticleBacklogRecord[]> {
  if (!email) return [];
  await connection();
  const pb = await userClient();
  return pb
    .collection<ArticleBacklogRecord>('articleBacklog')
    .getFullList({ filter: `assigneeEmail = "${email}"` });
}

async function upsertBacklog(
  pb: PocketBase,
  slug: string,
  articleRecordId: string,
  patch: Record<string, unknown>,
  changedByEmail: string | null,
): Promise<void> {
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`;
  const base: Record<string, unknown> = {
    specialtySlug: slug,
    articleRecordId,
    lastChangedByEmail: changedByEmail ?? '',
    lastChangedAt: Date.now(),
    ...patch,
  };
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    await pb.collection('articleBacklog').update(existing.id, base);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      // Status is required by the schema, so default to 'unassigned' on
      // first-write when the caller is setting only the assignee.
      if (!('status' in base)) base.status = 'unassigned';
      await pb.collection('articleBacklog').create(base);
      return;
    }
    throw e;
  }
}

export async function setArticleBacklogStatus(
  slug: string,
  articleRecordId: string,
  status: ArticleBacklogStatus,
  changedByEmail: string | null,
  notes?: string,
): Promise<void> {
  const pb = await userClient();
  const patch: Record<string, unknown> = { status };
  if (notes !== undefined) patch.notes = notes;
  await upsertBacklog(pb, slug, articleRecordId, patch, changedByEmail);
}

export async function setArticleBacklogAssignee(
  slug: string,
  articleRecordId: string,
  assigneeEmail: string | null,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await userClient();
  await upsertBacklog(
    pb,
    slug,
    articleRecordId,
    { assigneeEmail: assigneeEmail ?? '' },
    changedByEmail,
  );
}

export async function clearArticleBacklog(
  slug: string,
  articleRecordId: string,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`;
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    await pb.collection('articleBacklog').delete(existing.id);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
}

/**
 * Admin-side status writer for the literature-search worker (no cookies
 * in scope). Same upsert semantics as `setArticleBacklogStatus`.
 */
export async function setArticleBacklogStatusAsAdmin(
  slug: string,
  articleRecordId: string,
  status: ArticleBacklogStatus,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await createAdminClient();
  await upsertBacklog(pb, slug, articleRecordId, { status }, changedByEmail);
}

/**
 * Idempotent: create an articleBacklog row of type='update' for the given
 * parent article if one doesn't already exist. Called from
 * `submitSectionReview` when any section under a parent is approved; we
 * don't want to clobber an existing row's status (an editor may have
 * already advanced it past 'waiting-for-sources').
 */
export async function ensureUpdateBacklogRow(
  slug: string,
  parentArticleId: string,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${parentArticleId}"`;
  try {
    await pb.collection<ArticleBacklogRecord>('articleBacklog').getFirstListItem(filter);
    return;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('articleBacklog').create({
        specialtySlug: slug,
        articleRecordId: parentArticleId,
        type: 'update',
        status: 'waiting-for-sources',
        lastChangedByEmail: changedByEmail ?? '',
        lastChangedAt: Date.now(),
      });
      return;
    }
    throw e;
  }
}

/**
 * Tear down an update-type backlog row. Used when the last approved
 * section under the parent article is unreviewed/rejected — the row
 * lost its only justification for existing.
 */
export async function clearUpdateBacklogRow(
  slug: string,
  parentArticleId: string,
): Promise<void> {
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleRecordId = "${parentArticleId}" && type = "update"`;
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    await pb.collection('articleBacklog').delete(existing.id);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
}
