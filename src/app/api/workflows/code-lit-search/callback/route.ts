/**
 * Callback endpoint for the n8n code/topic-level literature-search workflow.
 * Mirror of literature-search/callback, keyed on `codeLitSearchRuns` /
 * `codeLitSources`. n8n echoes the `meta` blob we sent in dispatch, so it posts
 * here (the URL we set as `callbackUrl`) with no n8n-side changes.
 *
 * POST /api/workflows/code-lit-search/callback
 *   Authorization: Bearer <N8N_CALLBACK_SECRET>
 *   body: {
 *     status: 'completed' | 'failed',
 *     meta: { codeLitSearchRunId, codeId, code?, specialtySlug, runId },
 *     sources?: Array<{ title, doi?, url?, journal?, sourceType?, rank }>,
 *     error?, queryCount?, candidateCount?,
 *   }
 *
 * Idempotent: replays for an already-terminal run return 200 + { skipped }.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { finishCodeLitSearchRunAsAdmin } from '@/lib/data/code-lit-search-runs';
import {
  bulkInsertCodeLitSourcesAsAdmin,
  updateCodeLitSearchResultAsAdmin,
} from '@/lib/data/code-lit-sources';
import { errorMessage } from '@/lib/error-message';
import { requireCallbackAuth } from '@/lib/http/callback-auth';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/pb/server';
import type { CodeLitSearchRunRecord, CodeLitSourceRecord } from '@/lib/pb/types';
import { maybeFinalizeCodeLitSearchRun } from '@/lib/workflows/code-lit-search/finalize';

type SourceRow = Omit<
  CodeLitSourceRecord,
  | 'id'
  | 'created'
  | 'updated'
  | 'collectionId'
  | 'collectionName'
  | 'specialtySlug'
  | 'codeId'
  | 'code'
>;

const META_MSG = 'meta is missing required fields';
const metaField = z.string({ message: META_MSG }).min(1, META_MSG);

const Body = z.object({
  status: z.enum(['completed', 'failed'], {
    message: 'status must be "completed" or "failed"',
  }),
  meta: z.object(
    {
      codeLitSearchRunId: metaField,
      codeId: metaField,
      code: z.string().optional().catch(undefined),
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

  log('code-lit-search/callback').info('received', {
    status,
    runId: meta.runId,
    codeLitSearchRunId: meta.codeLitSearchRunId,
    codeId: meta.codeId,
    specialtySlug: meta.specialtySlug,
    sources: Array.isArray(body.sources) ? body.sources.length : undefined,
  });

  const pb = await createAdminClient();
  let runRow: CodeLitSearchRunRecord;
  try {
    runRow = await pb
      .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
      .getOne(meta.codeLitSearchRunId);
  } catch (e) {
    log('code-lit-search/callback').error('run row lookup failed', {
      codeLitSearchRunId: meta.codeLitSearchRunId,
      error: errorMessage(e),
    });
    return NextResponse.json(
      { error: `codeLitSearchRuns row not found: ${meta.codeLitSearchRunId}` },
      { status: 404 },
    );
  }
  if (runRow.status !== 'running') {
    log('code-lit-search/callback').info('skipped (already terminal)', {
      codeLitSearchRunId: meta.codeLitSearchRunId,
      currentStatus: runRow.status,
    });
    return NextResponse.json({ skipped: true, reason: 'already_terminal' });
  }

  const code = meta.code ?? runRow.code ?? '';

  if (status === 'completed') {
    const sources = (body.sources ?? []) as SourceRow[];
    let sourcesCount: number;
    try {
      sourcesCount = await bulkInsertCodeLitSourcesAsAdmin(
        meta.specialtySlug,
        meta.codeId,
        code,
        sources,
      );
    } catch (e) {
      const pbErr = e as { status?: number; response?: { data?: unknown } };
      const pbDetail =
        pbErr && typeof pbErr === 'object' && 'response' in pbErr
          ? pbErr.response?.data
          : undefined;
      const msg = errorMessage(e);
      log('code-lit-search/callback').error('codeLitSources insert rejected', {
        codeLitSearchRunId: meta.codeLitSearchRunId,
        firstSource: sources[0],
        pbStatus: pbErr?.status,
        pbDetail,
        error: msg,
      });
      await finishCodeLitSearchRunAsAdmin(meta.codeLitSearchRunId, {
        status: 'failed',
        errorMessage: `codeLitSources insert rejected: ${msg}`,
        sourcesCount: 0,
      });
      await updateCodeLitSearchResultAsAdmin(meta.codeId, { litSearchStatus: 'failed' });
      await maybeFinalizeCodeLitSearchRun(meta.runId);
      revalidateTag(`pipeline:${meta.specialtySlug}`, 'max');
      revalidateTag(`specialty:${meta.specialtySlug}`, 'max');
      return NextResponse.json(
        { error: 'codeLitSources insert rejected', detail: pbDetail, message: msg },
        { status: 422 },
      );
    }
    await updateCodeLitSearchResultAsAdmin(meta.codeId, {
      litSearchStatus: 'completed',
      litSearchSourceCount: sourcesCount,
      litSearchedAt: Date.now(),
    });
    await finishCodeLitSearchRunAsAdmin(meta.codeLitSearchRunId, {
      status: 'completed',
      sourcesCount,
      queryCount: body.queryCount,
      candidateCount: body.candidateCount,
    });
  } else {
    await finishCodeLitSearchRunAsAdmin(meta.codeLitSearchRunId, {
      status: 'failed',
      errorMessage: body.error ?? 'n8n reported failure',
      sourcesCount: 0,
      queryCount: body.queryCount,
      candidateCount: body.candidateCount,
    });
    await updateCodeLitSearchResultAsAdmin(meta.codeId, { litSearchStatus: 'failed' });
  }

  await maybeFinalizeCodeLitSearchRun(meta.runId);

  revalidateTag(`pipeline:${meta.specialtySlug}`, 'max');
  revalidateTag(`specialty:${meta.specialtySlug}`, 'max');

  return NextResponse.json({ ok: true, status });
}
