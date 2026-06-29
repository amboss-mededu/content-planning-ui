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
 * Returns backlog rows for the specialty keyed by `articleKey` —
 * the stable, content-derived identifier (see `article-keys.ts`).
 * Zombies (empty key) are filtered out.
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
  for (const r of rows) {
    if (!r.articleKey) continue;
    out[r.articleKey] = r;
  }
  return out;
}

/**
 * Cross-specialty scan: every backlog row currently assigned to
 * `email`. Returned as an array (per-specialty grouping happens
 * downstream) and only rows with a non-empty `articleKey` are
 * returned — zombies stay in the DB but never reach the UI.
 */
export async function listArticleBacklogForAssignee(
  email: string,
): Promise<ArticleBacklogRecord[]> {
  if (!email) return [];
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleBacklogRecord>('articleBacklog')
    .getFullList({ filter: `assigneeEmail = "${email}"` });
  return rows.filter((r) => r.articleKey);
}

/**
 * Returns the assignee email of a single backlog row, or null when no row
 * exists yet (or it's unassigned). Admin read so it works regardless of the
 * caller's PB rules — used by the assignee-scoped permission guard
 * (`assertCanWorkArticle`) to decide whether an editor owns this article.
 */
export async function getArticleBacklogAssignee(
  slug: string,
  articleKey: string,
): Promise<string | null> {
  if (!articleKey) return null;
  const pb = await createAdminClient();
  try {
    // Parameterized filter — `slug`/`articleKey` come from editor-controlled
    // request bodies and this is an authorization boundary, so the values MUST
    // be bound (pb.filter escapes them) rather than interpolated, or a crafted
    // articleKey could alter which row the check matches.
    const filter = pb.filter('specialtySlug = {:slug} && articleKey = {:articleKey}', {
      slug,
      articleKey,
    });
    const row = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    return row.assigneeEmail && row.assigneeEmail.length > 0 ? row.assigneeEmail : null;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

async function upsertBacklog(
  pb: PocketBase,
  slug: string,
  articleKey: string,
  articleRecordId: string,
  patch: Record<string, unknown>,
  changedByEmail: string | null,
): Promise<void> {
  if (!articleKey) {
    throw new Error('upsertBacklog: articleKey is required');
  }
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  const base: Record<string, unknown> = {
    specialtySlug: slug,
    articleKey,
    // Keep articleRecordId populated for the deprecated old code paths
    // and as a debugging breadcrumb in the DB. It's overwritten each
    // upsert so it always reflects the latest known PB id.
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
  articleKey: string,
  articleRecordId: string,
  status: ArticleBacklogStatus,
  changedByEmail: string | null,
  notes?: string,
): Promise<void> {
  const pb = await userClient();
  const patch: Record<string, unknown> = { status };
  if (notes !== undefined) patch.notes = notes;
  await upsertBacklog(pb, slug, articleKey, articleRecordId, patch, changedByEmail);
}

export async function setArticleBacklogAssignee(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  assigneeEmail: string | null,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await userClient();
  await upsertBacklog(
    pb,
    slug,
    articleKey,
    articleRecordId,
    { assigneeEmail: assigneeEmail ?? '' },
    changedByEmail,
  );
}

export async function setArticleBacklogAssigneeAsAdmin(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  assigneeEmail: string | null,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await createAdminClient();
  await upsertBacklog(
    pb,
    slug,
    articleKey,
    articleRecordId,
    { assigneeEmail: assigneeEmail ?? '' },
    changedByEmail,
  );
}

/** User-side writer for the inline-editable "Google Drive URL" cell. */
export async function setArticleBacklogDraftFolderUrl(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  draftFolderUrl: string,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await userClient();
  await upsertBacklog(
    pb,
    slug,
    articleKey,
    articleRecordId,
    { draftFolderUrl },
    changedByEmail,
  );
}

/**
 * Admin-side writer used by the n8n draft callback — both the early
 * "folder ready" ping (while the draft is still running) and on completion,
 * so a re-run that produced a fresh folder overwrites the pointer.
 */
export async function setArticleBacklogDraftFolderUrlAsAdmin(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  draftFolderUrl: string,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await createAdminClient();
  await upsertBacklog(
    pb,
    slug,
    articleKey,
    articleRecordId,
    { draftFolderUrl },
    changedByEmail,
  );
}

/**
 * Returns the deleted articleKey, or null if no row existed.
 */
export async function clearArticleBacklog(
  slug: string,
  articleKey: string,
): Promise<string | null> {
  if (!articleKey) return null;
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    await pb.collection('articleBacklog').delete(existing.id);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

export async function clearArticleBacklogAsAdmin(
  slug: string,
  articleKey: string,
): Promise<string | null> {
  if (!articleKey) return null;
  const pb = await createAdminClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    await pb.collection('articleBacklog').delete(existing.id);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Admin-side status writer for the article-writing worker (no cookies
 * in scope). Same upsert semantics as `setArticleBacklogStatus`.
 */
export async function setArticleBacklogStatusAsAdmin(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  status: ArticleBacklogStatus,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await createAdminClient();
  await upsertBacklog(pb, slug, articleKey, articleRecordId, { status }, changedByEmail);
}

/**
 * Admin reset path that explicitly preserves the existing
 * `assigneeEmail` so the article doesn't drop out of `/my-backlog`
 * after a Reset action. The plain status setter does a partial PB
 * update (which should preserve assignee), but several wrap-around
 * code paths kept stripping it in practice — this helper re-asserts
 * the assignee on the same write so PB realtime always emits a
 * row that matches the my-backlog filter.
 */
export async function resetArticleBacklogStatusAsAdmin(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  status: ArticleBacklogStatus,
  changedByEmail: string | null,
): Promise<void> {
  const pb = await createAdminClient();
  // Read existing row's assignee (if any) so we can re-assert it on the
  // same write. 404 → no prior row, leave assignee blank.
  let assigneeEmail = '';
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(`specialtySlug = "${slug}" && articleKey = "${articleKey}"`);
    assigneeEmail = existing.assigneeEmail ?? '';
  } catch (e) {
    if (!(e instanceof ClientResponseError && e.status === 404)) throw e;
  }
  await upsertBacklog(
    pb,
    slug,
    articleKey,
    articleRecordId,
    { status, notes: '', assigneeEmail },
    changedByEmail,
  );
}

/**
 * Idempotent: create an articleBacklog row of type='update' for the
 * given parent CMS article if one doesn't already exist. For update
 * rows, `articleKey` and `articleRecordId` both encode the CMS
 * articleId — `articleKey` as the canonical `upd::<articleId>` token
 * used by joins, `articleRecordId` as the raw id for older code.
 */
/**
 * Returns the articleKey of the (possibly pre-existing) backlog row.
 */
export async function ensureUpdateBacklogRow(
  slug: string,
  parentArticleId: string,
  changedByEmail: string | null,
): Promise<string> {
  const articleKey = `upd::${parentArticleId}`;
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  try {
    await pb.collection<ArticleBacklogRecord>('articleBacklog').getFirstListItem(filter);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('articleBacklog').create({
        specialtySlug: slug,
        articleKey,
        articleRecordId: parentArticleId,
        type: 'update',
        status: 'waiting-for-sources',
        lastChangedByEmail: changedByEmail ?? '',
        lastChangedAt: Date.now(),
      });
      return articleKey;
    }
    throw e;
  }
}

/**
 * Idempotent: create an articleBacklog row of type='new' for the given
 * approved article candidate if one doesn't already exist. Mirrors
 * `ensureUpdateBacklogRow` so approving a new article on the
 * consolidation-review screen surfaces it on `/my-backlog` (which
 * reads `articleBacklog`) the same way section approvals do.
 */
/**
 * Returns the articleKey of the (possibly pre-existing) backlog row, or
 * null if the caller passed an empty key.
 */
export async function ensureNewArticleBacklogRow(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  changedByEmail: string | null,
): Promise<string | null> {
  if (!articleKey) return null;
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  try {
    await pb.collection<ArticleBacklogRecord>('articleBacklog').getFirstListItem(filter);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('articleBacklog').create({
        specialtySlug: slug,
        articleKey,
        articleRecordId,
        type: 'new',
        status: 'waiting-for-sources',
        lastChangedByEmail: changedByEmail ?? '',
        lastChangedAt: Date.now(),
      });
      return articleKey;
    }
    throw e;
  }
}

export async function ensureNewArticleBacklogRowAsAdmin(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  changedByEmail: string | null,
): Promise<string | null> {
  if (!articleKey) return null;
  const pb = await createAdminClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}"`;
  try {
    await pb.collection<ArticleBacklogRecord>('articleBacklog').getFirstListItem(filter);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      await pb.collection('articleBacklog').create({
        specialtySlug: slug,
        articleKey,
        articleRecordId,
        type: 'new',
        status: 'waiting-for-sources',
        lastChangedByEmail: changedByEmail ?? '',
        lastChangedAt: Date.now(),
      });
      return articleKey;
    }
    throw e;
  }
}

/**
 * Wipe every `articleBacklog` row for a specialty. Used by the
 * specialty-level reset path; takes assignees and statuses with it.
 */
export async function deleteArticleBacklogForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ArticleBacklogRecord>('articleBacklog')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('articleBacklog').delete(r.id)));
}

/**
 * Tear down an update-type backlog row. Used when the last approved
 * section under the parent article is unreviewed/rejected.
 */
/**
 * Returns the deleted backlog articleKey (`upd::<parentArticleId>`),
 * or null if no row existed.
 */
export async function clearUpdateBacklogRow(
  slug: string,
  parentArticleId: string,
): Promise<string | null> {
  const articleKey = `upd::${parentArticleId}`;
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}" && articleKey = "${articleKey}" && type = "update"`;
  try {
    const existing = await pb
      .collection<ArticleBacklogRecord>('articleBacklog')
      .getFirstListItem(filter);
    await pb.collection('articleBacklog').delete(existing.id);
    return articleKey;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}
