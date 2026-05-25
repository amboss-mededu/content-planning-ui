/**
 * Callback endpoint for the n8n literature-search workflow.
 *
 * POST /api/workflows/literature-search/callback
 *   Authorization: Bearer <LIT_SEARCH_N8N_CALLBACK_SECRET>
 *   body: {
 *     status: 'completed' | 'failed',
 *     meta: {
 *       litSearchRunId: string,
 *       articleRecordId: string,
 *       articleKey: string,
 *       specialtySlug: string,
 *       runId: string,
 *     },
 *     sources?: Array<{ title, doi?, url?, journal?, sourceType?, rank }>,
 *     error?: string,
 *     queryCount?: number,
 *     candidateCount?: number,
 *   }
 *
 * Idempotent: replays of the same callback (n8n retries on its end) for
 * an already-terminal `articleLitSearchRuns` row return 200 + { skipped }
 * without re-writing sources.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { finishArticleLitSearchRunAsAdmin } from '@/lib/data/article-lit-search-runs';
import { bulkInsertArticleSourcesAsAdmin } from '@/lib/data/article-sources';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleLitSearchRunRecord, ArticleSourceRecord } from '@/lib/pb/types';
import { maybeFinalizePipelineRun } from '@/lib/workflows/literature-search/finalize';

type Meta = {
  litSearchRunId: string;
  articleRecordId: string;
  articleKey: string;
  specialtySlug: string;
  runId: string;
};

type SourceRow = Omit<
  ArticleSourceRecord,
  | 'id'
  | 'created'
  | 'updated'
  | 'collectionId'
  | 'collectionName'
  | 'specialtySlug'
  | 'articleRecordId'
  | 'articleKey'
>;

type CallbackBody = {
  status?: 'completed' | 'failed';
  meta?: Partial<Meta>;
  sources?: SourceRow[];
  error?: string;
  queryCount?: number;
  candidateCount?: number;
};

export async function POST(req: NextRequest) {
  const secret = env.LIT_SEARCH_N8N_CALLBACK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'callback secret not configured' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as CallbackBody;
  const status = body.status;
  if (status !== 'completed' && status !== 'failed') {
    return NextResponse.json(
      { error: 'status must be "completed" or "failed"' },
      { status: 400 },
    );
  }
  const meta = body.meta;
  if (
    !meta?.litSearchRunId ||
    !meta.articleRecordId ||
    !meta.articleKey ||
    !meta.specialtySlug ||
    !meta.runId
  ) {
    return NextResponse.json(
      { error: 'meta is missing required fields' },
      { status: 400 },
    );
  }

  console.log('[lit-search/callback] received', {
    status,
    runId: meta.runId,
    litSearchRunId: meta.litSearchRunId,
    articleKey: meta.articleKey,
    specialtySlug: meta.specialtySlug,
    sources: Array.isArray(body.sources) ? body.sources.length : undefined,
  });

  const pb = await createAdminClient();
  let runRow: ArticleLitSearchRunRecord;
  try {
    runRow = await pb
      .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
      .getOne(meta.litSearchRunId);
  } catch (e) {
    console.error('[lit-search/callback] run row lookup failed', {
      litSearchRunId: meta.litSearchRunId,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: `articleLitSearchRuns row not found: ${meta.litSearchRunId}` },
      { status: 404 },
    );
  }
  if (runRow.status !== 'running') {
    console.log('[lit-search/callback] skipped (already terminal)', {
      litSearchRunId: meta.litSearchRunId,
      currentStatus: runRow.status,
    });
    return NextResponse.json({ skipped: true, reason: 'already_terminal' });
  }

  if (status === 'completed') {
    const sources = Array.isArray(body.sources) ? body.sources : [];
    let sourcesCount: number;
    try {
      sourcesCount = await bulkInsertArticleSourcesAsAdmin(
        meta.specialtySlug,
        meta.articleRecordId,
        meta.articleKey,
        sources,
      );
    } catch (e) {
      // Surface PocketBase validation failures back to n8n so the user can
      // see which field/value got rejected in the execution panel — beats
      // a generic 500 that hides everything.
      const pbErr = e as { status?: number; response?: { data?: unknown } };
      const pbDetail =
        pbErr && typeof pbErr === 'object' && 'response' in pbErr
          ? pbErr.response?.data
          : undefined;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[lit-search/callback] articleSources insert rejected', {
        litSearchRunId: meta.litSearchRunId,
        firstSource: sources[0],
        pbStatus: pbErr?.status,
        pbDetail,
        error: msg,
      });
      await finishArticleLitSearchRunAsAdmin(meta.litSearchRunId, {
        status: 'failed',
        errorMessage: `articleSources insert rejected: ${msg}`,
        sourcesCount: 0,
      });
      await maybeFinalizePipelineRun(meta.runId);
      revalidateTag(`pipeline:${meta.specialtySlug}`, 'max');
      revalidateTag(`specialty:${meta.specialtySlug}`, 'max');
      return NextResponse.json(
        { error: 'articleSources insert rejected', detail: pbDetail, message: msg },
        { status: 422 },
      );
    }
    await setArticleBacklogStatusAsAdmin(
      meta.specialtySlug,
      meta.articleKey,
      meta.articleRecordId,
      'sources-searched',
      null,
    );
    await finishArticleLitSearchRunAsAdmin(meta.litSearchRunId, {
      status: 'completed',
      sourcesCount,
      queryCount: body.queryCount,
      candidateCount: body.candidateCount,
    });
  } else {
    await finishArticleLitSearchRunAsAdmin(meta.litSearchRunId, {
      status: 'failed',
      errorMessage: body.error ?? 'n8n reported failure',
      sourcesCount: 0,
      queryCount: body.queryCount,
      candidateCount: body.candidateCount,
    });
  }

  await maybeFinalizePipelineRun(meta.runId);

  revalidateTag(`pipeline:${meta.specialtySlug}`, 'max');
  revalidateTag(`specialty:${meta.specialtySlug}`, 'max');

  return NextResponse.json({ ok: true, status });
}
