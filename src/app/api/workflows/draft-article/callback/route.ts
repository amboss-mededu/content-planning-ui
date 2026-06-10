/**
 * Callback endpoint for the n8n draft-article workflow.
 *
 * POST /api/workflows/draft-article/callback
 *   Authorization: Bearer <N8N_CALLBACK_SECRET>
 *   body: {
 *     status: 'running' | 'completed' | 'failed',
 *     meta: {
 *       draftRunId: string,
 *       articleRecordId: string,
 *       articleKey: string,
 *       specialtySlug: string,
 *     },
 *     outputUrl?: string,   // Google Drive folder URL (early ping + on completion)
 *     outputLinks?: { name: string, link: string }[],  // per-stage drafts (completion)
 *     error?: string,
 *   }
 *
 * Two phases, same endpoint:
 *  - `running`  — early "folder ready" ping: stores the Drive folder pointer on
 *    the article so the UI shows where to watch progress. Does NOT finalize the
 *    run or advance the article.
 *  - `completed`/`failed` — finalize the run; completion also stores the folder
 *    URL + per-stage links and flips the article to `ready-for-editing`.
 *
 * Idempotent: any callback for an already-terminal `articleDraftRuns` row
 * returns 200 + { skipped } without re-writing anything (covers a late
 * duplicate `running` arriving after completion).
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  setArticleBacklogDraftFolderUrlAsAdmin,
  setArticleBacklogStatusAsAdmin,
} from '@/lib/data/article-backlog';
import { finishArticleDraftRunAsAdmin } from '@/lib/data/article-draft-runs';
import { errorMessage } from '@/lib/error-message';
import { requireCallbackAuth } from '@/lib/http/callback-auth';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleDraftLink, ArticleDraftRunRecord } from '@/lib/pb/types';

const META_MSG = 'meta is missing required fields';
const metaField = z.string({ message: META_MSG }).min(1, META_MSG);

// Only `status` and `meta` are validated strictly (as the route always did);
// the remaining fields come from an external sender, so they stay permissive
// and never reject the callback on their own.
const Body = z.object({
  status: z.enum(['running', 'completed', 'failed'], {
    message: 'status must be "running", "completed" or "failed"',
  }),
  meta: z.object(
    {
      draftRunId: metaField,
      articleRecordId: metaField,
      articleKey: metaField,
      specialtySlug: metaField,
    },
    { message: META_MSG },
  ),
  outputUrl: z.string().optional().catch(undefined),
  outputLinks: z.unknown().optional(),
  error: z.string().optional().catch(undefined),
});

/**
 * Coerce the callback's `outputLinks` into a clean `{ name, link }[]`. n8n is
 * an external sender, so be defensive: drop anything that isn't an object with
 * string `name` + `link`, and tolerate a missing/garbage value (→ undefined,
 * which leaves the stored field untouched).
 */
function parseOutputLinks(value: unknown): ArticleDraftLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value.flatMap((entry): ArticleDraftLink[] => {
    if (entry && typeof entry === 'object') {
      const { name, link } = entry as Record<string, unknown>;
      if (typeof name === 'string' && typeof link === 'string' && link) {
        return [{ name, link }];
      }
    }
    return [];
  });
  return links.length > 0 ? links : undefined;
}

export async function POST(req: NextRequest) {
  const denied = requireCallbackAuth(req);
  if (denied) return denied;

  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const status = body.status;
  const meta = body.meta;

  const outputLinks = parseOutputLinks(body.outputLinks);

  log('draft-article/callback').info('received', {
    status,
    draftRunId: meta.draftRunId,
    articleKey: meta.articleKey,
    specialtySlug: meta.specialtySlug,
    outputUrl: body.outputUrl,
    outputLinks: outputLinks?.length ?? 0,
  });

  const pb = await createAdminClient();
  let runRow: ArticleDraftRunRecord;
  try {
    runRow = await pb
      .collection<ArticleDraftRunRecord>('articleDraftRuns')
      .getOne(meta.draftRunId);
  } catch (e) {
    log('draft-article/callback').error('run row lookup failed', {
      draftRunId: meta.draftRunId,
      error: errorMessage(e),
    });
    return NextResponse.json(
      { error: `articleDraftRuns row not found: ${meta.draftRunId}` },
      { status: 404 },
    );
  }
  if (runRow.status !== 'running') {
    log('draft-article/callback').info('skipped (already terminal)', {
      draftRunId: meta.draftRunId,
      currentStatus: runRow.status,
    });
    return NextResponse.json({ skipped: true, reason: 'already_terminal' });
  }

  if (status === 'running') {
    // Early "folder ready" ping — record the Drive folder pointer so the editor
    // can see where to watch progress. Leave the run `running` and the article
    // status untouched; the completion callback finalizes later.
    if (body.outputUrl) {
      await setArticleBacklogDraftFolderUrlAsAdmin(
        meta.specialtySlug,
        meta.articleKey,
        meta.articleRecordId,
        body.outputUrl,
        null,
      );
    }
  } else if (status === 'completed') {
    await finishArticleDraftRunAsAdmin(meta.draftRunId, {
      status: 'completed',
      outputUrl: body.outputUrl ?? '',
      ...(outputLinks ? { outputLinks } : {}),
    });
    if (body.outputUrl) {
      // Overwrite the per-article pointer so a re-run's fresh folder wins.
      await setArticleBacklogDraftFolderUrlAsAdmin(
        meta.specialtySlug,
        meta.articleKey,
        meta.articleRecordId,
        body.outputUrl,
        null,
      );
    }
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
