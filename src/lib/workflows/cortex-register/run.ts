import 'server-only';

import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { computeArticleKey } from '@/lib/data/article-keys';
import {
  getArticleSourceByIdAsAdmin,
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
    await advanceBacklogToReadyForDraft(
      input.specialtySlug,
      input.articleRecordId,
      input.requestedByEmail,
    );
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

/**
 * Flip the article's backlog row to `ready-for-llm-draft`. Shared by the bulk
 * and single-source registration paths. Caller is responsible for first
 * confirming every source on the article carries a cortexSourceId.
 */
async function advanceBacklogToReadyForDraft(
  specialtySlug: string,
  articleRecordId: string,
  requestedByEmail: string | null,
): Promise<void> {
  const article = await getNewArticleSuggestionByIdAsAdmin(articleRecordId);
  const articleKey = computeArticleKey({
    specialtySlug,
    articleTitle: article?.articleTitle ?? '',
    articleId: article?.articleId,
  });
  if (!articleKey) return;
  await setArticleBacklogStatusAsAdmin(
    specialtySlug,
    articleKey,
    articleRecordId,
    'ready-for-llm-draft',
    requestedByEmail,
  ).catch((e) => {
    log('cortex-register').error('failed to flip backlog status', e);
  });
}

export type SingleSourceRegisterResult = {
  cortexSourceId: string;
  stub: boolean;
  /** True when the source already had a cortexSourceId (no Cortex write). */
  reused: boolean;
};

/**
 * Register a single source in Cortex (the per-row "Register" button). Mirrors
 * the per-source body of `runCortexRegistration`: skips if already registered,
 * otherwise creates in Cortex, persists the ribosomId to `cortexSourceId` /
 * `ribosomId`, and advances the backlog if this was the article's last
 * unregistered source.
 */
export async function runCortexRegistrationForSource(
  specialtySlug: string,
  sourceId: string,
  requestedByEmail: string | null,
): Promise<SingleSourceRegisterResult> {
  const source = await getArticleSourceByIdAsAdmin(sourceId);
  if (!source) throw new Error('Source not found');
  if (source.specialtySlug !== specialtySlug) {
    throw new Error('Source does not belong to this specialty');
  }
  if (source.cortexSourceId) {
    return { cortexSourceId: source.cortexSourceId, stub: false, reused: true };
  }

  const result = await registerCortexSource({
    title: source.title,
    url: source.url,
    doi: source.doi,
    journal: source.journal,
    journalNlm: source.journalNlm,
    sourceType: source.sourceType,
    originalFilename: source.originalFilename,
    llmSummary: source.llmSummary,
    specialtySlug,
  });
  await markSourceCortexRegisteredAsAdmin(source.id, result.cortexSourceId);

  const siblings = await listArticleSourcesForArticleAsAdmin(
    specialtySlug,
    source.articleRecordId,
  );
  if (siblings.length > 0 && siblings.every((s) => Boolean(s.cortexSourceId))) {
    await advanceBacklogToReadyForDraft(
      specialtySlug,
      source.articleRecordId,
      requestedByEmail,
    );
  }

  return { cortexSourceId: result.cortexSourceId, stub: result.stub, reused: false };
}
