import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ArticleLitSearchRunRecord } from '@/lib/pb/types';
import {
  claimArticleLitSearchRunWithClient,
  type LitSearchRunClaim,
} from './article-lit-search-runs-claim';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export { claimArticleLitSearchRunWithClient, type LitSearchRunClaim };

export type LitSearchRunPatch = {
  status: 'completed' | 'failed';
  errorMessage?: string;
  queryCount?: number;
  candidateCount?: number;
  sourcesCount?: number;
};

export function latestLitSearchRunByArticleKey(
  rows: ArticleLitSearchRunRecord[],
): Map<string, ArticleLitSearchRunRecord> {
  const out = new Map<string, ArticleLitSearchRunRecord>();
  for (const row of rows) {
    if (!row.articleKey) continue;
    const existing = out.get(row.articleKey);
    if (!existing || litSearchRunSortTime(row) >= litSearchRunSortTime(existing)) {
      out.set(row.articleKey, row);
    }
  }
  return out;
}

function litSearchRunSortTime(row: ArticleLitSearchRunRecord): number {
  return row.startedAt ?? (Date.parse(row.created || '') || 0);
}

/**
 * How long an `articleLitSearchRuns` row may stay `running` before the
 * lazy reaper flips it to `failed`. n8n owns the actual search, so the
 * app has no signal that work is still happening — a row stuck in
 * `running` past this window means the callback was never received
 * (n8n died, the workflow errored without the failure branch firing,
 * the tunnel was down, etc.).
 */
const LIT_SEARCH_RUN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Mark stale `running` rows (older than the timeout window) as failed.
 * Cheap: called lazily on read so we don't need a background worker.
 * Errors are swallowed — a transient PB failure here shouldn't block the
 * page render that called us.
 */
export async function reapStaleLitSearchRunsAsAdmin(slug?: string): Promise<void> {
  try {
    const pb = await createAdminClient();
    const cutoff = Date.now() - LIT_SEARCH_RUN_TIMEOUT_MS;
    const filterParts = [`status = "running"`, `startedAt < ${cutoff}`];
    if (slug) filterParts.unshift(`specialtySlug = "${slug}"`);
    const stale = await pb
      .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
      .getFullList({ filter: filterParts.join(' && ') });
    if (stale.length === 0) return;
    await Promise.all(
      stale.map((r) =>
        pb.collection('articleLitSearchRuns').update(r.id, {
          status: 'failed',
          finishedAt: Date.now(),
          errorMessage: `Timed out after ${LIT_SEARCH_RUN_TIMEOUT_MS / 60_000} minutes`,
          sourcesCount: 0,
        }),
      ),
    );
  } catch (e) {
    console.error('[lit-search] reapStaleLitSearchRunsAsAdmin failed', {
      slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function listArticleLitSearchRuns(
  slug: string,
): Promise<ArticleLitSearchRunRecord[]> {
  await connection();
  await reapStaleLitSearchRunsAsAdmin(slug);
  const pb = await userClient();
  return pb.collection<ArticleLitSearchRunRecord>('articleLitSearchRuns').getFullList({
    filter: `specialtySlug = "${slug}"`,
    sort: '-startedAt',
  });
}

export async function listArticleLitSearchRunsForArticleKeys(
  keys: string[],
): Promise<ArticleLitSearchRunRecord[]> {
  const unique = Array.from(new Set(keys.filter((s) => s.length > 0)));
  if (unique.length === 0) return [];
  await connection();
  const pb = await userClient();
  const out: ArticleLitSearchRunRecord[] = [];
  const CHUNK = 30;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const filter = chunk.map((k) => `articleKey = "${k}"`).join(' || ');
    const rows = await pb
      .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
      .getFullList({ filter, sort: '-startedAt' });
    out.push(...rows);
  }
  return out;
}

export async function claimArticleLitSearchRunAsAdmin(input: {
  specialtySlug: string;
  articleKey: string;
  articleRecordId: string;
  runId?: string;
}): Promise<LitSearchRunClaim> {
  const pb = await createAdminClient();
  return claimArticleLitSearchRunWithClient(pb, input);
}

export async function finishArticleLitSearchRunAsAdmin(
  runRecordId: string,
  patch: LitSearchRunPatch,
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleLitSearchRuns').update(runRecordId, {
    ...patch,
    finishedAt: Date.now(),
    errorMessage: patch.errorMessage ?? '',
  });
}

export async function attachPipelineRunToLitSearchRunsAsAdmin(
  runRecordIds: string[],
  runId: string,
): Promise<void> {
  if (runRecordIds.length === 0) return;
  const pb = await createAdminClient();
  await Promise.all(
    runRecordIds.map((id) => pb.collection('articleLitSearchRuns').update(id, { runId })),
  );
}

/**
 * Wipe every `articleLitSearchRuns` row for one article. Called from
 * `resetArticle()` so the modal's Phase 1 panel doesn't surface stale
 * "Last run failed" errors from before the reset.
 */
export async function deleteArticleLitSearchRunsByArticleKeyAsAdmin(
  slug: string,
  articleKey: string,
): Promise<number> {
  if (!articleKey) return 0;
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
    .getFullList({
      filter: `specialtySlug = "${slug}" && articleKey = "${articleKey}"`,
    });
  await Promise.all(rows.map((r) => pb.collection('articleLitSearchRuns').delete(r.id)));
  return rows.length;
}
