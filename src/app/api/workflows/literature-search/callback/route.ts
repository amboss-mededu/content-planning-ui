/**
 * Callback endpoint for the n8n literature-search workflow.
 *
 * POST /api/workflows/literature-search/callback
 *   Authorization: Bearer <N8N_CALLBACK_SECRET>
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
import { z } from 'zod';
import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { finishArticleLitSearchRunAsAdmin } from '@/lib/data/article-lit-search-runs';
import { bulkInsertArticleSourcesAsAdmin } from '@/lib/data/article-sources';
import { requireCallbackAuth } from '@/lib/http/callback-auth';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleLitSearchRunRecord, ArticleSourceRecord } from '@/lib/pb/types';
import { maybeFinalizePipelineRun } from '@/lib/workflows/literature-search/finalize';

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

const META_MSG = 'meta is missing required fields';
const metaField = z.string({ message: META_MSG }).min(1, META_MSG);

// Only `status` and `meta` are validated strictly (as the route always did);
// `sources` and the counts come from an external sender, so they stay
// permissive — the source rows are validated against PocketBase on insert.
const Body = z.object({
  status: z.enum(['completed', 'failed'], {
    message: 'status must be "completed" or "failed"',
  }),
  meta: z.object(
    {
      litSearchRunId: metaField,
      articleRecordId: metaField,
      articleKey: metaField,
      specialtySlug: metaField,
      runId: metaField,
    },
    { message: META_MSG },
  ),
  sources: z.array(z.unknown()).optional().catch(undefined),
  error: z.string().optional().catch(undefined),
  queryCount: z.number().optional().catch(undefined),
  candidateCount: z.number().optional().catch(undefined),
});

export async function POST(req: NextRequest) {
  const denied = requireCallbackAuth(req);
  if (denied) return denied;

  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const status = body.status;
  const meta = body.meta;

  log('lit-search/callback').info('received', {
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
    log('lit-search/callback').error('run row lookup failed', {
      litSearchRunId: meta.litSearchRunId,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: `articleLitSearchRuns row not found: ${meta.litSearchRunId}` },
      { status: 404 },
    );
  }
  if (runRow.status !== 'running') {
    log('lit-search/callback').info('skipped (already terminal)', {
      litSearchRunId: meta.litSearchRunId,
      currentStatus: runRow.status,
    });
    return NextResponse.json({ skipped: true, reason: 'already_terminal' });
  }

  if (status === 'completed') {
    // Trust boundary: rows are validated against PocketBase on insert below,
    // so the loose callback array is asserted to the insert shape here.
    const sources = (body.sources ?? []) as SourceRow[];
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
      log('lit-search/callback').error('articleSources insert rejected', {
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
