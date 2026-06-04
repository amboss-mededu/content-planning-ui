import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ArticleDraftRunRecord } from '@/lib/pb/types';
import {
  claimArticleDraftRunWithClient,
  type DraftRunClaim,
} from './article-draft-runs-claim';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export { claimArticleDraftRunWithClient, type DraftRunClaim };

export type DraftRunPatch = {
  status: 'completed' | 'failed';
  errorMessage?: string;
  outputUrl?: string;
};

/**
 * How long an `articleDraftRuns` row may stay `running` before the lazy
 * reaper flips it to `failed`. n8n owns the drafting (a multi-minute LLM
 * job), so the app has no signal that work is still happening — a row stuck
 * in `running` past this window means the callback was never received.
 * Generous because drafting is far slower than literature search.
 */
const DRAFT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Mark stale `running` rows (older than the timeout window) as failed.
 * Cheap: called lazily on read so we don't need a background worker. Errors
 * are swallowed so a transient PB failure here can't block a page render.
 */
export async function reapStaleDraftRunsAsAdmin(slug?: string): Promise<void> {
  try {
    const pb = await createAdminClient();
    const cutoff = Date.now() - DRAFT_RUN_TIMEOUT_MS;
    const filterParts = [`status = "running"`, `startedAt < ${cutoff}`];
    if (slug) filterParts.unshift(`specialtySlug = "${slug}"`);
    const stale = await pb
      .collection<ArticleDraftRunRecord>('articleDraftRuns')
      .getFullList({ filter: filterParts.join(' && ') });
    if (stale.length === 0) return;
    await Promise.all(
      stale.map((r) =>
        pb.collection('articleDraftRuns').update(r.id, {
          status: 'failed',
          finishedAt: Date.now(),
          errorMessage: `Timed out after ${DRAFT_RUN_TIMEOUT_MS / 60_000} minutes`,
        }),
      ),
    );
  } catch (e) {
    console.error('[draft-article] reapStaleDraftRunsAsAdmin failed', {
      slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Latest draft run per article, keyed by articleRecordId. Used by the
 * backlog list view to decorate each row without N+1 round trips. Reaps
 * stale rows first so the surfaced status is never a phantom "running".
 */
export async function listLatestDraftRunsForArticles(
  slug: string,
): Promise<Record<string, ArticleDraftRunRecord>> {
  await connection();
  await reapStaleDraftRunsAsAdmin(slug);
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleDraftRunRecord>('articleDraftRuns')
    .getFullList({ filter: `specialtySlug = "${slug}"`, sort: '-startedAt' });
  const out: Record<string, ArticleDraftRunRecord> = {};
  for (const r of rows) {
    if (!out[r.articleRecordId]) out[r.articleRecordId] = r;
  }
  return out;
}

export async function claimArticleDraftRunAsAdmin(input: {
  specialtySlug: string;
  articleKey: string;
  articleRecordId: string;
  handle?: string;
  language?: string;
  articleLength?: string;
}): Promise<DraftRunClaim> {
  const pb = await createAdminClient();
  return claimArticleDraftRunWithClient(pb, input);
}

export async function getArticleDraftRunAsAdmin(
  runRecordId: string,
): Promise<ArticleDraftRunRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<ArticleDraftRunRecord>('articleDraftRuns')
      .getOne(runRecordId);
  } catch {
    return null;
  }
}

/**
 * Manually abort an in-flight draft. n8n owns the job, so this just marks
 * the row terminal (`cancelled`, distinct from `failed`) — the UI unblocks
 * and the partial-unique index frees up so a retry can claim a fresh run.
 */
export async function cancelArticleDraftRunAsAdmin(runRecordId: string): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleDraftRuns').update(runRecordId, {
    status: 'cancelled',
    finishedAt: Date.now(),
    errorMessage: '',
  });
}

export async function finishArticleDraftRunAsAdmin(
  runRecordId: string,
  patch: DraftRunPatch,
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleDraftRuns').update(runRecordId, {
    status: patch.status,
    finishedAt: Date.now(),
    errorMessage: patch.errorMessage ?? '',
    ...(patch.outputUrl !== undefined ? { outputUrl: patch.outputUrl } : {}),
  });
}

/**
 * Wipe every `articleDraftRuns` row for one article. Called from
 * `resetArticle()` so the modal's draft panel doesn't surface stale state
 * from before the reset.
 */
export async function deleteArticleDraftRunsByArticleKeyAsAdmin(
  slug: string,
  articleKey: string,
): Promise<number> {
  if (!articleKey) return 0;
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ArticleDraftRunRecord>('articleDraftRuns')
    .getFullList({
      filter: `specialtySlug = "${slug}" && articleKey = "${articleKey}"`,
    });
  await Promise.all(rows.map((r) => pb.collection('articleDraftRuns').delete(r.id)));
  return rows.length;
}

/**
 * Wipe every `articleDraftRuns` row for a whole specialty. Part of the full
 * clean-slate cascade when code extraction is re-run.
 */
export async function deleteArticleDraftRunsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ArticleDraftRunRecord>('articleDraftRuns')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('articleDraftRuns').delete(r.id)));
}
