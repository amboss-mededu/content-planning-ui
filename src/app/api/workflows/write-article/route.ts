/**
 * Enqueue article-writing run(s).
 *
 * POST /api/workflows/write-article
 *   body: one of
 *     {
 *       specialtySlug, articleRecordId,                // single enqueue
 *       language?, articleLength?, useTextBubbles?,
 *       model: ModelSpec,
 *     }
 *     {
 *       specialtySlug, articleRecordIds: string[],     // bulk enqueue
 *       ...same options...
 *     }
 *
 * Per-article validation:
 *   - the article exists in consolidatedArticles
 *   - at least one source row is attached
 * The chosen model's provider is checked once at the request level.
 *
 * Creates one `articleWritingRuns` row per article with status='queued'.
 * The in-process dispatcher picks queued rows up and runs them under a
 * bounded semaphore (`MAX_CONCURRENT` in dispatcher.ts). Bulk callers
 * receive an array of runIds + a per-article outcome list.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireUserResponse } from '@/lib/auth';
import { listArticleSourcesForArticleAsAdmin } from '@/lib/data/article-sources';
import { createWritingRunAsAdmin } from '@/lib/data/article-writing';
import { getConsolidatedArticleByIdAsAdmin } from '@/lib/data/articles';
import { getSpecialty } from '@/lib/data/specialties';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';

type Body = {
  specialtySlug?: string;
  articleRecordId?: string;
  articleRecordIds?: string[];
  language?: string;
  articleLength?: string;
  useTextBubbles?: boolean;
  model?: unknown;
};

type EnqueueOutcome =
  | { articleRecordId: string; status: 'enqueued'; runId: string }
  | {
      articleRecordId: string;
      status: 'skipped';
      reason: 'NOT_FOUND' | 'NO_TITLE' | 'NO_SOURCES' | 'NO_DRAFTABLE_SOURCES';
    };

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug?.trim();
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }

  const ids =
    body.articleRecordIds?.filter((s) => typeof s === 'string' && s.length > 0) ??
    (body.articleRecordId ? [body.articleRecordId.trim()] : []);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: 'articleRecordId or articleRecordIds required' },
      { status: 400 },
    );
  }

  const modelParse = parseModelSpec(body.model);
  if (!modelParse.ok) {
    return NextResponse.json({ error: `model: ${modelParse.error}` }, { status: 400 });
  }
  const model = modelParse.spec;

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  // API-key gate: at enqueue time the provider key must be resolvable
  // for the current user, otherwise the dispatcher would just fail
  // every run with MISSING_API_KEY. Fail fast so the UI can route the
  // user to Settings.
  const apiKeys = await resolveApiKeysForRun([model.provider]);
  if (!apiKeys[model.provider]) {
    return NextResponse.json(
      {
        error: `No API key configured for ${model.provider}.`,
        code: 'MISSING_API_KEY',
        provider: model.provider,
      },
      { status: 409 },
    );
  }

  const viewer = await getCurrentUser();
  const requestedByEmail = viewer?.email ?? null;
  const requestedByUserId = viewer?._id ?? null;

  const language = body.language?.trim() || 'en';
  const articleLength = body.articleLength?.trim() || 'medium';
  const useTextBubbles = body.useTextBubbles !== false;

  const outcomes: EnqueueOutcome[] = [];
  for (const articleRecordId of ids) {
    const article = await getConsolidatedArticleByIdAsAdmin(articleRecordId);
    if (!article || article.specialtySlug !== slug) {
      outcomes.push({ articleRecordId, status: 'skipped', reason: 'NOT_FOUND' });
      continue;
    }
    if (!article.articleTitle?.trim()) {
      outcomes.push({ articleRecordId, status: 'skipped', reason: 'NO_TITLE' });
      continue;
    }
    const sources = await listArticleSourcesForArticleAsAdmin(slug, articleRecordId);
    if (sources.length === 0) {
      outcomes.push({ articleRecordId, status: 'skipped', reason: 'NO_SOURCES' });
      continue;
    }
    // Hard gate: the writer ingests only approved sources that carry a
    // Cortex source ID. If none qualify, the run would just produce a
    // draft with no citations — refuse upfront so the editor goes back
    // and fills the IDs.
    const draftable = sources.filter(
      (s) =>
        s.reviewStatus === 'approved' &&
        typeof s.cortexSourceId === 'string' &&
        s.cortexSourceId.length > 0,
    );
    if (draftable.length === 0) {
      outcomes.push({
        articleRecordId,
        status: 'skipped',
        reason: 'NO_DRAFTABLE_SOURCES',
      });
      continue;
    }
    const run = await createWritingRunAsAdmin({
      specialtySlug: slug,
      articleRecordId,
      requestedByEmail,
      requestedByUserId,
      language,
      articleLength,
      useTextBubbles,
      modelProvider: model.provider,
      modelId: model.model,
      modelReasoning: model.reasoning,
    });
    outcomes.push({ articleRecordId, status: 'enqueued', runId: run.id });
  }

  revalidateTag(`specialty:${slug}`, 'max');

  const enqueued = outcomes.filter((o) => o.status === 'enqueued').length;
  const skipped = outcomes.length - enqueued;

  return NextResponse.json({
    specialty: slug,
    enqueued,
    skipped,
    outcomes,
    passes: 6,
  });
}
