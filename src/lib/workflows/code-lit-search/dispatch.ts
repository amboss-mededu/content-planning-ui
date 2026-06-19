/**
 * Dispatches per-code/topic literature-search jobs to the SAME n8n webhook the
 * article-level search uses — no n8n changes. We control `topic`, `meta`,
 * `callbackUrl`, and `callbackToken`; n8n echoes `meta` back to whatever
 * callback URL we give it, so a code-scoped run just sends the code/topic as the
 * subject and points at the code callback route.
 *
 * One POST per claimed code — the per-code `codeLitSearchRuns` row is the unit
 * of progress the mapping sheet subscribes to. Dispatch failures mark the code's
 * run failed immediately so the editor sees the error, not an endless spinner.
 */

import { env } from '@/env';
import { finishCodeLitSearchRunAsAdmin } from '@/lib/data/code-lit-search-runs';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import {
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
} from '../lib/db-writes';
import { logEvent } from '../lib/events';

const N_CANDIDATES = 15;

export type DispatchCodeTopic = {
  /** PB id of the `codes` row. */
  codeId: string;
  /** Human code string (e.g. ICD code). */
  code: string;
  /** Topic text the literature search runs on. */
  description: string;
  litSearchRunId: string;
};

export type DispatchCodeLitSearchInput = {
  runId: string;
  specialtySlug: string;
  callbackUrl: string;
  topics: DispatchCodeTopic[];
};

export type DispatchCodeLitSearchResult = {
  dispatched: number;
  failed: number;
};

export async function dispatchCodeLitSearch(
  input: DispatchCodeLitSearchInput,
): Promise<DispatchCodeLitSearchResult> {
  const stage = 'literature_search' as const;
  const webhookUrl = env.LIT_SEARCH_N8N_WEBHOOK_URL;
  const callbackToken = env.N8N_CALLBACK_SECRET;

  if (!webhookUrl || !callbackToken) {
    const msg = !webhookUrl
      ? 'LIT_SEARCH_N8N_WEBHOOK_URL is not configured'
      : 'N8N_CALLBACK_SECRET is not configured';
    await Promise.all(
      input.topics.map((t) =>
        finishCodeLitSearchRunAsAdmin(t.litSearchRunId, {
          status: 'failed',
          errorMessage: msg,
          sourcesCount: 0,
        }),
      ),
    );
    await markStageFailed(input.runId, stage, msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    return { dispatched: 0, failed: input.topics.length };
  }

  await markStageRunning(input.runId, stage);
  await logEvent({
    runId: input.runId,
    stage,
    level: 'info',
    message: `Dispatching ${input.topics.length} code topic(s) to n8n`,
  });

  let dispatched = 0;
  let failed = 0;

  for (const topic of input.topics) {
    const label = topic.description || topic.code;
    const body = {
      topic: topic.description || topic.code,
      topicsString: topic.code,
      numCandidates: N_CANDIDATES,
      handle: input.specialtySlug,
      meta: {
        codeLitSearchRunId: topic.litSearchRunId,
        codeId: topic.codeId,
        code: topic.code,
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
        metrics: { litSearchPhase: 'start' },
      });
    } catch (e) {
      failed++;
      const msg = errorMessage(e);
      await finishCodeLitSearchRunAsAdmin(topic.litSearchRunId, {
        status: 'failed',
        errorMessage: `Dispatch failed: ${msg}`,
        sourcesCount: 0,
      });
      log('code-lit-search').error('dispatch failed', {
        runId: input.runId,
        codeId: topic.codeId,
        code: topic.code,
        error: msg,
      });
      await logEvent({
        runId: input.runId,
        stage,
        level: 'error',
        message: `Dispatch failed for ${label}: ${msg}`,
        metrics: { litSearchPhase: 'end' },
      });
    }
  }

  if (dispatched === 0) {
    const msg = `Dispatch failed for all ${failed} code(s).`;
    await markStageFailed(input.runId, stage, msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
  }
  // When dispatched > 0 the stage stays `running`; the callback (via
  // maybeFinalizeCodeLitSearchRun) closes it when every claimed code is terminal.

  return { dispatched, failed };
}
