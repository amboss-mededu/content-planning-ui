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

import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { computeArticleKey } from '@/lib/data/article-keys';
import { bulkInsertArticleSourcesAsAdmin } from '@/lib/data/article-sources';
import { markStageCompleted, markStageFailed, markStageRunning } from '../lib/db-writes';
import { aggregateStageMetrics, logEvent } from '../lib/events';
import type { ProviderApiKeys } from '../lib/llm';
import { type ArticleLike, generateSearchQueries, rankCandidates } from './llm-calls';
import { fetchPubmedCandidates } from './pubmed';

export type LiteratureSearchInput = {
  runId: string;
  specialtySlug: string;
  articles: ArticleLike[];
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
      try {
        const queries = await generateSearchQueries({
          article,
          runId: input.runId,
          stage,
          apiKeys: input.apiKeys,
        });
        if (queries.length === 0) {
          throw new Error('no queries generated');
        }
        const candidates = await fetchPubmedCandidates(queries, {
          maxPerQuery: 25,
        });
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

        if (ranked.length > 0) {
          await bulkInsertArticleSourcesAsAdmin(input.specialtySlug, article.id, ranked);
          totalSources += ranked.length;
        }
        const articleKey = computeArticleKey({
          specialtySlug: input.specialtySlug,
          articleTitle: article.articleTitle,
        });
        if (articleKey) {
          await setArticleBacklogStatusAsAdmin(
            input.specialtySlug,
            articleKey,
            article.id,
            'sources-searched',
            null,
          );
        }
        succeeded++;
        await logEvent({
          runId: input.runId,
          stage,
          level: 'info',
          message: `Searched ${articleLabel} → ${ranked.length} sources kept`,
          metrics: { source: 'pubmed' },
        });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await logEvent({
          runId: input.runId,
          stage,
          level: 'error',
          message: `Failed ${articleLabel}: ${msg}`,
          metrics: {},
        });
      }
    }

    const totals = await aggregateStageMetrics(input.runId, stage);
    await markStageCompleted(input.runId, stage, undefined, {
      ...totals,
      articles: input.articles.length,
      succeeded,
      failed,
      sources: totalSources,
    });
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
  }
}
