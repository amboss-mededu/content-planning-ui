import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ArticleDraftRecord,
  ArticleDraftStatus,
  ArticleWritingRunRecord,
  ArticleWritingRunStatus,
  WritingPassName,
} from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

// --- runs --------------------------------------------------------------

export async function createWritingRunAsAdmin(input: {
  specialtySlug: string;
  articleRecordId: string;
  requestedByEmail?: string | null;
  language?: string;
  articleLength?: string;
  useTextBubbles?: boolean;
  modelProvider?: string;
  modelId?: string;
  modelReasoning?: string;
}): Promise<ArticleWritingRunRecord> {
  const pb = await createAdminClient();
  return await pb.collection<ArticleWritingRunRecord>('articleWritingRuns').create({
    specialtySlug: input.specialtySlug,
    articleRecordId: input.articleRecordId,
    status: 'queued',
    startedAt: Date.now(),
    requestedByEmail: input.requestedByEmail ?? '',
    language: input.language ?? '',
    articleLength: input.articleLength ?? '',
    useTextBubbles: input.useTextBubbles ?? true,
    modelProvider: input.modelProvider ?? '',
    modelId: input.modelId ?? '',
    modelReasoning: input.modelReasoning ?? '',
  });
}

export async function updateWritingRunAsAdmin(
  runId: string,
  patch: Partial<
    Pick<
      ArticleWritingRunRecord,
      'status' | 'currentPass' | 'finishedAt' | 'errorMessage'
    >
  >,
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('articleWritingRuns').update(runId, patch);
}

export async function getWritingRunAsAdmin(
  runId: string,
): Promise<ArticleWritingRunRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<ArticleWritingRunRecord>('articleWritingRuns')
      .getOne(runId);
  } catch {
    return null;
  }
}

/**
 * Latest run for a given article (one row per status transition is
 * unrealistic — instead we create a new run on every kickoff). Caller
 * uses this for the backlog view's "live status" surface.
 */
export async function getLatestWritingRunForArticle(
  slug: string,
  articleRecordId: string,
): Promise<ArticleWritingRunRecord | null> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleWritingRunRecord>('articleWritingRuns')
    .getFullList({
      filter: `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`,
      sort: '-startedAt',
    });
  return rows[0] ?? null;
}

/**
 * Bulk look-up by articleRecordId. Used by the backlog list view to
 * decorate each row without N+1 round trips.
 */
export async function listLatestWritingRunsForArticles(
  slug: string,
): Promise<Record<string, ArticleWritingRunRecord>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ArticleWritingRunRecord>('articleWritingRuns')
    .getFullList({ filter: `specialtySlug = "${slug}"`, sort: '-startedAt' });
  const out: Record<string, ArticleWritingRunRecord> = {};
  for (const r of rows) {
    if (!out[r.articleRecordId]) out[r.articleRecordId] = r;
  }
  return out;
}

// --- drafts ------------------------------------------------------------

export async function upsertDraftPassAsAdmin(input: {
  runId: string;
  specialtySlug: string;
  articleRecordId: string;
  pass: WritingPassName;
  status: ArticleDraftStatus;
  output?: string;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  modelId?: string;
}): Promise<void> {
  const pb = await createAdminClient();
  const existing = await pb
    .collection<ArticleDraftRecord>('articleDrafts')
    .getFullList({ filter: `runId = "${input.runId}" && pass = "${input.pass}"` });
  const now = Date.now();
  const payload: Partial<ArticleDraftRecord> = {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    articleRecordId: input.articleRecordId,
    pass: input.pass,
    status: input.status,
    output: input.output,
    errorMessage: input.errorMessage,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens,
    costUsd: input.costUsd,
    modelId: input.modelId,
  };
  if (existing.length > 0) {
    const finishedAt = input.status === 'running' ? undefined : now;
    await pb.collection('articleDrafts').update(existing[0].id, {
      ...payload,
      ...(finishedAt ? { finishedAt } : {}),
    });
  } else {
    await pb.collection('articleDrafts').create({
      ...payload,
      startedAt: now,
      ...(input.status === 'running' ? {} : { finishedAt: now }),
    });
  }
}

export async function listDraftsForRunAsAdmin(
  runId: string,
): Promise<ArticleDraftRecord[]> {
  const pb = await createAdminClient();
  return await pb
    .collection<ArticleDraftRecord>('articleDrafts')
    .getFullList({ filter: `runId = "${runId}"`, sort: 'startedAt' });
}

export async function listDraftsForArticle(
  slug: string,
  articleRecordId: string,
): Promise<ArticleDraftRecord[]> {
  await connection();
  const pb = await userClient();
  return await pb.collection<ArticleDraftRecord>('articleDrafts').getFullList({
    filter: `specialtySlug = "${slug}" && articleRecordId = "${articleRecordId}"`,
    sort: '-startedAt',
  });
}

export async function cancelWritingRunAsAdmin(runId: string): Promise<void> {
  await updateWritingRunAsAdmin(runId, {
    status: 'cancelled',
    finishedAt: Date.now(),
  });
}

/** Re-export so route handlers don't have to import types separately. */
export type { ArticleWritingRunStatus };
