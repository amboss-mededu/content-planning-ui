/**
 * Dispatches per-article literature-search jobs to the n8n webhook.
 *
 * n8n owns the heavy work (query generation, PubMed, ranking). The
 * webhook is configured to respond immediately, so each POST returns in
 * well under a second. When n8n finishes, it calls back to
 * /api/workflows/literature-search/callback with the ranked sources.
 *
 * One POST per claimed article — the per-article `articleLitSearchRuns`
 * row is the unit of progress the UI subscribes to. Dispatch failures
 * mark the article's run as failed immediately so the editor sees the
 * error instead of an indefinite spinner.
 */

import { env } from '@/env';
import { finishArticleLitSearchRunAsAdmin } from '@/lib/data/article-lit-search-runs';
import { log } from '@/lib/log';
import {
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
} from '../lib/db-writes';
import { logEvent } from '../lib/events';

const N_CANDIDATES = 15;

export type DispatchArticle = {
  id: string;
  articleTitle?: string;
  articleKey: string;
  codes: string[];
  litSearchRunId: string;
};

export type DispatchLiteratureSearchInput = {
  runId: string;
  specialtySlug: string;
  callbackUrl: string;
  articles: DispatchArticle[];
};

export type DispatchLiteratureSearchResult = {
  dispatched: number;
  failed: number;
};

export async function dispatchLiteratureSearch(
  input: DispatchLiteratureSearchInput,
): Promise<DispatchLiteratureSearchResult> {
  const stage = 'literature_search' as const;
  const webhookUrl = env.LIT_SEARCH_N8N_WEBHOOK_URL;
  const callbackToken = env.N8N_CALLBACK_SECRET;

  if (!webhookUrl || !callbackToken) {
    const msg = !webhookUrl
      ? 'LIT_SEARCH_N8N_WEBHOOK_URL is not configured'
      : 'N8N_CALLBACK_SECRET is not configured';
    await Promise.all(
      input.articles.map((article) =>
        finishArticleLitSearchRunAsAdmin(article.litSearchRunId, {
          status: 'failed',
          errorMessage: msg,
          sourcesCount: 0,
        }),
      ),
    );
    await markStageFailed(input.runId, stage, msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    return { dispatched: 0, failed: input.articles.length };
  }

  await markStageRunning(input.runId, stage);
  await logEvent({
    runId: input.runId,
    stage,
    level: 'info',
    message: `Dispatching ${input.articles.length} article(s) to n8n`,
  });

  let dispatched = 0;
  let failed = 0;

  for (const article of input.articles) {
    const label = article.articleTitle ?? article.id;
    const body = {
      topic: article.articleTitle ?? '',
      topicsString: article.codes.join('; '),
      numCandidates: N_CANDIDATES,
      handle: input.specialtySlug,
      meta: {
        litSearchRunId: article.litSearchRunId,
        articleRecordId: article.id,
        articleKey: article.articleKey,
        specialtySlug: input.specialtySlug,
        runId: input.runId,
        callbackUrl: input.callbackUrl,
        callbackToken,
      },
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Outbound Header Auth. The n8n webhook's Header Auth credential is
          // configured with Name = the constant `X-Lit-Search-Auth` and
          // Value = LIT_SEARCH_N8N_AUTH_SECRET. Omitted when unset so a
          // webhook without auth still works in local/dev.
          ...(env.LIT_SEARCH_N8N_AUTH_SECRET
            ? { 'X-Lit-Search-Auth': env.LIT_SEARCH_N8N_AUTH_SECRET }
            : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`n8n responded ${res.status} ${res.statusText}`);
      }
      dispatched++;
      await logEvent({
        runId: input.runId,
        stage,
        level: 'info',
        message: `Dispatched ${label}`,
        metrics: { articleRecordId: article.id, litSearchPhase: 'start' },
      });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      await finishArticleLitSearchRunAsAdmin(article.litSearchRunId, {
        status: 'failed',
        errorMessage: `Dispatch failed: ${msg}`,
        sourcesCount: 0,
      });
      log('literature-search').error('dispatch failed', {
        runId: input.runId,
        articleId: article.id,
        articleLabel: label,
        error: msg,
      });
      await logEvent({
        runId: input.runId,
        stage,
        level: 'error',
        message: `Dispatch failed for ${label}: ${msg}`,
        metrics: { articleRecordId: article.id, litSearchPhase: 'end' },
      });
    }
  }

  if (dispatched === 0) {
    const msg = `Dispatch failed for all ${failed} article(s).`;
    await markStageFailed(input.runId, stage, msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
  }
  // When dispatched > 0, the stage stays `running`; the callback (via
  // maybeFinalizePipelineRun) flips it to completed/failed when every
  // claimed article's per-article run is in a terminal state.

  return { dispatched, failed };
}
