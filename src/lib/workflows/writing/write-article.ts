/**
 * Article-writing pipeline orchestrator.
 *
 * Runs the six editorial passes in order, persisting each one's output
 * to `articleDrafts` and advancing `articleWritingRuns.currentPass` /
 * `status` as it goes. Fire-and-forget from the API route; the route
 * returns immediately after creating the run row.
 *
 * Cooperative cancellation: between passes we re-read the run row; if
 * the editor flipped it to `cancelled` (or it was deleted) the
 * orchestrator returns without writing further passes.
 *
 * On success the writing run is marked `completed` and the parent
 * backlog row is moved from `ready-for-llm-draft` (or whichever
 * earlier state it was in) to `ready-for-editing`.
 */

import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { computeArticleKey } from '@/lib/data/article-keys';
import { listArticleSourcesForArticleAsAdmin } from '@/lib/data/article-sources';
import {
  getWritingRunAsAdmin,
  updateWritingRunAsAdmin,
  upsertDraftPassAsAdmin,
} from '@/lib/data/article-writing';
import type { ArticleSourceRecord } from '@/lib/pb/types';
import { logEvent } from '../lib/events';
import { ensureGeminiUploadsForArticle } from '../lib/gemini-files';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { revalidateSpecialtyCache } from '../lib/revalidate';
import { runWritingPass } from './passes';
import { WRITING_PASSES, type WritingPass } from './prompts';

export type WriteArticleInput = {
  runId: string;
  specialtySlug: string;
  articleRecordId: string;
  articleTitle: string;
  language: string;
  articleLength: string;
  useTextBubbles: boolean;
  sources: ArticleSourceRecord[];
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
  /** Email of the editor who clicked Start — written back to the backlog
   *  row's lastChangedByEmail on the final status flip. */
  requestedByEmail: string | null;
  /** Skip the proofreader pass. Defaults to `true` because the
   *  proofreader expects QC tables (references_table / facts_table)
   *  from an external service that isn't wired yet, and running it with
   *  empty placeholders just burns tokens for low-quality output. The
   *  API route plumbs `false` through once QC is available. */
  skipProofreader?: boolean;
};

async function isStillRunnable(runId: string): Promise<boolean> {
  const row = await getWritingRunAsAdmin(runId);
  if (!row) return false;
  return row.status === 'queued' || row.status === 'running';
}

export async function writeArticleWorkflow(input: WriteArticleInput): Promise<void> {
  console.log('[writing] writeArticleWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    articleRecordId: input.articleRecordId,
    title: input.articleTitle,
  });

  await updateWritingRunAsAdmin(input.runId, {
    status: 'running',
    currentPass: 'primary',
  });

  await logEvent({
    runId: input.runId,
    stage: 'write_article',
    level: 'info',
    message: `Started · ${input.sources.length} source(s) · model=${input.model.model}`,
    metrics: {
      sources: input.sources.length,
      passes: WRITING_PASSES.length,
    },
  });

  // JIT: ensure each source has a fresh Gemini Files API URI. We always
  // attempt this — even when the caller passed `sources` already loaded
  // from the loader — because the URI is short-lived (~48h) and the run
  // may execute long after the editor approved sources. Re-reads sources
  // afterwards so `primary` + `proofreader` see the latest URIs.
  let liveSources: ArticleSourceRecord[] = input.sources;
  if (input.apiKeys.google) {
    try {
      const { counts } = await ensureGeminiUploadsForArticle({
        apiKey: input.apiKeys.google,
        specialtySlug: input.specialtySlug,
        articleRecordId: input.articleRecordId,
      });
      await logEvent({
        runId: input.runId,
        stage: 'write_article',
        level: 'info',
        message: `Gemini Files: ${counts.uploaded} uploaded · ${counts.reused} reused${counts.failed ? ` · ${counts.failed} failed` : ''}${counts.noUrl ? ` · ${counts.noUrl} no-url` : ''}`,
        metrics: counts,
      });
      liveSources = await listArticleSourcesForArticleAsAdmin(
        input.specialtySlug,
        input.articleRecordId,
      );
    } catch (e) {
      await logEvent({
        runId: input.runId,
        stage: 'write_article',
        level: 'error',
        message: `Gemini Files upload failed (continuing without): ${e instanceof Error ? e.message : String(e)}`,
      }).catch(() => {});
    }
  }

  let previousOutput = '';

  try {
    const skipProofreader = input.skipProofreader ?? true;

    for (const pass of WRITING_PASSES) {
      if (!(await isStillRunnable(input.runId))) {
        await logEvent({
          runId: input.runId,
          stage: 'write_article',
          level: 'info',
          message: `Cancelled before [${pass}] — leaving prior pass output intact.`,
        }).catch(() => {});
        return;
      }

      if (pass === 'proofreader' && skipProofreader) {
        await upsertDraftPassAsAdmin({
          runId: input.runId,
          specialtySlug: input.specialtySlug,
          articleRecordId: input.articleRecordId,
          pass,
          status: 'skipped',
        });
        await logEvent({
          runId: input.runId,
          stage: 'write_article',
          level: 'info',
          message: '[proofreader] skipped — QC service not yet wired',
        });
        continue;
      }

      await updateWritingRunAsAdmin(input.runId, { currentPass: pass });
      await upsertDraftPassAsAdmin({
        runId: input.runId,
        specialtySlug: input.specialtySlug,
        articleRecordId: input.articleRecordId,
        pass,
        status: 'running',
      });

      try {
        const result = await runWritingPass(pass as WritingPass, {
          runId: input.runId,
          specialtySlug: input.specialtySlug,
          articleRecordId: input.articleRecordId,
          articleTitle: input.articleTitle,
          language: input.language,
          articleLength: input.articleLength,
          useTextBubbles: input.useTextBubbles,
          sources: liveSources,
          model: input.model,
          apiKeys: input.apiKeys,
          previousOutput,
        });

        await upsertDraftPassAsAdmin({
          runId: input.runId,
          specialtySlug: input.specialtySlug,
          articleRecordId: input.articleRecordId,
          pass,
          status: 'completed',
          output: result.output,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          costUsd: result.costUsd ?? undefined,
          modelId: result.modelId,
        });

        previousOutput = result.output;
      } catch (passErr) {
        const msg = passErr instanceof Error ? passErr.message : String(passErr);
        await upsertDraftPassAsAdmin({
          runId: input.runId,
          specialtySlug: input.specialtySlug,
          articleRecordId: input.articleRecordId,
          pass,
          status: 'failed',
          errorMessage: msg,
        });
        throw passErr;
      }
    }

    await updateWritingRunAsAdmin(input.runId, {
      status: 'completed',
      currentPass: 'copy',
      finishedAt: Date.now(),
    });

    // Move the backlog row forward so the editor knows the draft is
    // ready for human review. We skip this when the row's current
    // status is already past `ready-for-editing` — e.g. an editor who
    // re-ran the draft mid-editing shouldn't be bounced back.
    const articleKey = computeArticleKey({
      specialtySlug: input.specialtySlug,
      articleTitle: input.articleTitle,
    });
    if (articleKey) {
      await setArticleBacklogStatusAsAdmin(
        input.specialtySlug,
        articleKey,
        input.articleRecordId,
        'ready-for-editing',
        input.requestedByEmail,
      ).catch((e) => {
        console.error('[writing] failed to flip backlog status', e);
      });
    }

    await logEvent({
      runId: input.runId,
      stage: 'write_article',
      level: 'info',
      message: `All ${WRITING_PASSES.length} passes complete.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[writing] writeArticleWorkflow failed', msg);
    await updateWritingRunAsAdmin(input.runId, {
      status: 'failed',
      finishedAt: Date.now(),
      errorMessage: msg,
    });
    await logEvent({
      runId: input.runId,
      stage: 'write_article',
      level: 'error',
      message: `Run failed: ${msg}`,
    }).catch(() => {});
    throw e;
  } finally {
    await revalidateSpecialtyCache(input.specialtySlug).catch(() => {});
  }
}
