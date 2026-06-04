/**
 * Callback endpoint for the n8n draft-article workflow.
 *
 * POST /api/workflows/draft-article/callback
 *   Authorization: Bearer <N8N_CALLBACK_SECRET>
 *   body: {
 *     status: 'completed' | 'failed',
 *     meta: {
 *       draftRunId: string,
 *       articleRecordId: string,
 *       articleKey: string,
 *       specialtySlug: string,
 *     },
 *     outputUrl?: string,   // Google Drive doc/folder URL (on completion)
 *     error?: string,
 *   }
 *
 * Idempotent: replays for an already-terminal `articleDraftRuns` row return
 * 200 + { skipped } without re-writing anything.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { finishArticleDraftRunAsAdmin } from '@/lib/data/article-draft-runs';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleDraftRunRecord } from '@/lib/pb/types';

type Meta = {
  draftRunId: string;
  articleRecordId: string;
  articleKey: string;
  specialtySlug: string;
};

type CallbackBody = {
  status?: 'completed' | 'failed';
  meta?: Partial<Meta>;
  outputUrl?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const secret = env.N8N_CALLBACK_SECRET;
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
    !meta?.draftRunId ||
    !meta.articleRecordId ||
    !meta.articleKey ||
    !meta.specialtySlug
  ) {
    return NextResponse.json(
      { error: 'meta is missing required fields' },
      { status: 400 },
    );
  }

  console.log('[draft-article/callback] received', {
    status,
    draftRunId: meta.draftRunId,
    articleKey: meta.articleKey,
    specialtySlug: meta.specialtySlug,
    outputUrl: body.outputUrl,
  });

  const pb = await createAdminClient();
  let runRow: ArticleDraftRunRecord;
  try {
    runRow = await pb
      .collection<ArticleDraftRunRecord>('articleDraftRuns')
      .getOne(meta.draftRunId);
  } catch (e) {
    console.error('[draft-article/callback] run row lookup failed', {
      draftRunId: meta.draftRunId,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: `articleDraftRuns row not found: ${meta.draftRunId}` },
      { status: 404 },
    );
  }
  if (runRow.status !== 'running') {
    console.log('[draft-article/callback] skipped (already terminal)', {
      draftRunId: meta.draftRunId,
      currentStatus: runRow.status,
    });
    return NextResponse.json({ skipped: true, reason: 'already_terminal' });
  }

  if (status === 'completed') {
    await finishArticleDraftRunAsAdmin(meta.draftRunId, {
      status: 'completed',
      outputUrl: body.outputUrl ?? '',
    });
    await setArticleBacklogStatusAsAdmin(
      meta.specialtySlug,
      meta.articleKey,
      meta.articleRecordId,
      'ready-for-editing',
      null,
    );
  } else {
    await finishArticleDraftRunAsAdmin(meta.draftRunId, {
      status: 'failed',
      errorMessage: body.error ?? 'n8n reported failure',
    });
  }

  revalidateTag(`pipeline:${meta.specialtySlug}`, 'max');
  revalidateTag(`specialty:${meta.specialtySlug}`, 'max');

  return NextResponse.json({ ok: true, status });
}
