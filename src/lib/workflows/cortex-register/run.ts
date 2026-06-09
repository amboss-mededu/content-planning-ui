import 'server-only';

import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { computeArticleKey } from '@/lib/data/article-keys';
import {
  listArticleSourcesForArticleAsAdmin,
  markSourceCortexRegisteredAsAdmin,
} from '@/lib/data/article-sources';
import { getNewArticleSuggestionByIdAsAdmin } from '@/lib/data/articles';
import { errorMessage } from '@/lib/error-message';
import { registerCortexSource } from '@/lib/integrations/cortex';
import { log } from '@/lib/log';

export type CortexRegisterOutcome = {
  sourceId: string;
  title: string;
  status: 'registered' | 'reused' | 'failed';
  cortexSourceId?: string;
  stub?: boolean;
  error?: string;
};

export type CortexRegisterResult = {
  outcomes: CortexRegisterOutcome[];
  counts: { registered: number; reused: number; failed: number };
  /** True iff every source on the article ended this run with a
   *  non-empty cortexSourceId. Drives the auto-advance to
   *  `ready-for-llm-draft`. */
  fullyRegistered: boolean;
};

/**
 * Register every source attached to a single article in Cortex. Sources
 * that already have a `cortexSourceId` are skipped (idempotent). When
 * the run leaves every source registered, the article's backlog row is
 * advanced from `sources-approved` → `ready-for-llm-draft`.
 */
export async function runCortexRegistration(input: {
  specialtySlug: string;
  articleRecordId: string;
  requestedByEmail: string | null;
}): Promise<CortexRegisterResult> {
  const sources = await listArticleSourcesForArticleAsAdmin(
    input.specialtySlug,
    input.articleRecordId,
  );

  const outcomes: CortexRegisterOutcome[] = [];
  for (const s of sources) {
    if (s.cortexSourceId) {
      outcomes.push({
        sourceId: s.id,
        title: s.title,
        status: 'reused',
        cortexSourceId: s.cortexSourceId,
      });
      continue;
    }
    try {
      const result = await registerCortexSource({
        title: s.title,
        url: s.url,
        doi: s.doi,
        journal: s.journal,
        journalNlm: s.journalNlm,
        sourceType: s.sourceType,
        originalFilename: s.originalFilename,
        llmSummary: s.llmSummary,
        specialtySlug: input.specialtySlug,
      });
      await markSourceCortexRegisteredAsAdmin(s.id, result.cortexSourceId);
      outcomes.push({
        sourceId: s.id,
        title: s.title,
        status: 'registered',
        cortexSourceId: result.cortexSourceId,
        stub: result.stub,
      });
    } catch (e) {
      outcomes.push({
        sourceId: s.id,
        title: s.title,
        status: 'failed',
        error: errorMessage(e),
      });
    }
  }

  const fullyRegistered =
    sources.length > 0 &&
    outcomes.every((o) => o.status === 'registered' || o.status === 'reused');

  if (fullyRegistered) {
    const article = await getNewArticleSuggestionByIdAsAdmin(input.articleRecordId);
    const articleTitle = article?.articleTitle ?? '';
    const articleKey = computeArticleKey({
      specialtySlug: input.specialtySlug,
      articleTitle,
      articleId: article?.articleId,
    });
    if (articleKey) {
      await setArticleBacklogStatusAsAdmin(
        input.specialtySlug,
        articleKey,
        input.articleRecordId,
        'ready-for-llm-draft',
        input.requestedByEmail,
      ).catch((e) => {
        log('cortex-register').error('failed to flip backlog status', e);
      });
    }
  }

  return {
    outcomes,
    counts: {
      registered: outcomes.filter((o) => o.status === 'registered').length,
      reused: outcomes.filter((o) => o.status === 'reused').length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
    },
    fullyRegistered,
  };
}
