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

export async function listArticleLitSearchRuns(
  slug: string,
): Promise<ArticleLitSearchRunRecord[]> {
  await connection();
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
