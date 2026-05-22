/**
 * Literature-search orchestrator.
 *
 * Mirrors `extract-codes.ts` in shape: marks the stage running, walks
 * the candidate articles, writes events as it goes, and stamps the
 * stage completed (or completed-with-errors) at the end. Status of
 * each successfully-searched article auto-advances to `sources-searched`
 * so editors land directly on the next step in the backlog UI.
 *
 * Per-article: generate PubMed queries → fetch candidates → rank →
 * insert into `articleSources` → bump backlog status. Failures inside
 * one article never abort the run; they're logged and the article stays
 * at its current status for retry.
 *
 * TODO(googleScholar): Google Scholar via PDF vector embeddings is not
 * wired yet — merge those candidates with the PubMed list right before
 * `rankCandidates` once the service is available.
 */

import { revalidateTag } from 'next/cache';
import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { computeArticleKey } from '@/lib/data/article-keys';
import { finishArticleLitSearchRunAsAdmin } from '@/lib/data/article-lit-search-runs';
import { bulkInsertArticleSourcesAsAdmin } from '@/lib/data/article-sources';
import {
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
} from '../lib/db-writes';
import { aggregateStageMetrics, logEvent } from '../lib/events';
import type { ProviderApiKeys } from '../lib/llm';
import { type ArticleLike, generateSearchQueries, rankCandidates } from './llm-calls';
import { fetchPubmedCandidates } from './pubmed';

export type LiteratureSearchInput = {
  runId: string;
  specialtySlug: string;
  articles: Array<ArticleLike & { litSearchRunId?: string }>;
  apiKeys: ProviderApiKeys;
};

export async function runLiteratureSearch(input: LiteratureSearchInput): Promise<void> {
  const stage = 'literature_search' as const;
  console.log('[pipeline] literature-search start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    articles: input.articles.length,
  });

  try {
    await markStageRunning(input.runId, stage);
    await logEvent({
      runId: input.runId,
      stage,
      level: 'info',
      message: `Run started for ${input.articles.length} article(s)`,
    });

    let succeeded = 0;
    let failed = 0;
    let totalSources = 0;

    for (const article of input.articles) {
      const articleLabel = article.articleTitle ?? article.id;
      let queryCount = 0;
      let candidateCount = 0;
      try {
        await logEvent({
          runId: input.runId,
          stage,
          level: 'info',
          message: `Started ${articleLabel}`,
          metrics: { articleRecordId: article.id, litSearchPhase: 'start' },
        });
        const queries = await generateSearchQueries({
          article,
          runId: input.runId,
          stage,
          apiKeys: input.apiKeys,
        });
        queryCount = queries.length;
        if (queries.length === 0) {
          throw new Error('no queries generated');
        }
        let candidates = await fetchPubmedCandidates(queries, {
          maxPerQuery: 25,
        });
        if (candidates.length === 0 && article.articleTitle) {
          // Common failure mode: Gemini decorates queries with `[Mesh]`
          // filters using headings that don't exist in PubMed's MeSH
          // thesaurus, and every query returns zero. Retry once with
          // the article title as a plain text search before giving up.
          await logEvent({
            runId: input.runId,
            stage,
            level: 'warn',
            message: `LLM queries returned 0; retrying with title fallback for ${articleLabel}`,
            metrics: { articleRecordId: article.id },
          });
          candidates = await fetchPubmedCandidates([article.articleTitle], {
            maxPerQuery: 25,
          });
        }
        candidateCount = candidates.length;
        if (candidates.length === 0) {
          throw new Error('PubMed returned 0 candidates');
        }
        await logEvent({
          runId: input.runId,
          stage,
          level: 'info',
          message: `PubMed returned ${candidates.length} candidates for ${articleLabel}`,
          metrics: { url: article.id, source: 'pubmed' },
        });
        // TODO(googleScholar): const scholarCandidates = await fetchGoogleScholar(...);
        // const allCandidates = [...candidates, ...scholarCandidates];

        const ranked = await rankCandidates({
          article,
          candidates,
          runId: input.runId,
          stage,
          apiKeys: input.apiKeys,
        });
        if (ranked.length === 0) {
          throw new Error('ranking returned 0 sources');
        }

        // Prefer the producer's canonical key (passed in from the route
        // handler) so we hit the existing backlog row. Fall back to a
        // category-less compute only when nothing was threaded through —
        // covers older callers and avoids a hard crash on missing data.
        const articleKey =
          article.articleKey ||
          computeArticleKey({
            specialtySlug: input.specialtySlug,
            articleTitle: article.articleTitle,
          });
        const sourcesCount = await bulkInsertArticleSourcesAsAdmin(
          input.specialtySlug,
          article.id,
          articleKey,
          ranked,
        );
        if (sourcesCount === 0) {
          throw new Error('source insert saved 0 rows');
        }
        totalSources += sourcesCount;
        if (articleKey) {
          await setArticleBacklogStatusAsAdmin(
            input.specialtySlug,
            articleKey,
            article.id,
            'sources-searched',
            null,
          );
        }
        if (article.litSearchRunId) {
          await finishArticleLitSearchRunAsAdmin(article.litSearchRunId, {
            status: 'completed',
            queryCount,
            candidateCount,
            sourcesCount,
          });
        }
        succeeded++;
        await logEvent({
          runId: input.runId,
          stage,
          level: 'info',
          message: `Searched ${articleLabel} → ${sourcesCount} sources kept`,
          metrics: {
            articleRecordId: article.id,
            litSearchPhase: 'end',
            source: 'pubmed',
          },
        });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        if (article.litSearchRunId) {
          await finishArticleLitSearchRunAsAdmin(article.litSearchRunId, {
            status: 'failed',
            errorMessage: msg,
            queryCount,
            candidateCount,
            sourcesCount: 0,
          });
        }
        console.error('[literature-search] article failed', {
          runId: input.runId,
          articleId: article.id,
          articleLabel,
          error: msg,
          stack: e instanceof Error ? e.stack : undefined,
        });
        await logEvent({
          runId: input.runId,
          stage,
          level: 'error',
          message: `Failed ${articleLabel}: ${msg}`,
          metrics: { articleRecordId: article.id, litSearchPhase: 'end' },
        });
      }
    }

    const totals = await aggregateStageMetrics(input.runId, stage);
    const outputSummary = {
      ...totals,
      articles: input.articles.length,
      succeeded,
      failed,
      sources: totalSources,
    };
    if (succeeded > 0) {
      await markStageCompleted(input.runId, stage, undefined, outputSummary);
      await updatePipelineRunStatus(input.runId, 'completed');
    } else {
      const message = `Literature search failed for all ${failed} article(s).`;
      await markStageFailed(input.runId, stage, message);
      await updatePipelineRunStatus(input.runId, 'failed', message);
    }
    revalidateTag(`pipeline:${input.specialtySlug}`, 'max');
    revalidateTag(`specialty:${input.specialtySlug}`, 'max');
    console.log('[pipeline] literature-search done', {
      runId: input.runId,
      succeeded,
      failed,
      totalSources,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] literature-search fatal', { runId: input.runId, msg });
    await markStageFailed(input.runId, stage, msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    revalidateTag(`pipeline:${input.specialtySlug}`, 'max');
    revalidateTag(`specialty:${input.specialtySlug}`, 'max');
  }
}
