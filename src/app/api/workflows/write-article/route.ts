/**
 * Trigger endpoint for the article-writing pipeline.
 *
 * POST /api/workflows/write-article
 *   body: {
 *     specialtySlug: string;
 *     articleRecordId: string;             // newArticleSuggestions PB id
 *     language?: string;                   // default: specialty.language || 'en'
 *     articleLength?: string;              // default 'medium' — passed through to LLM
 *     useTextBubbles?: boolean;            // default true
 *     model: ModelSpec;
 *   }
 *
 * Validates that:
 *   - the article exists in newArticleSuggestions
 *   - at least one source row is attached
 *   - the chosen model's provider has an API key resolvable
 *
 * Then creates an `articleWritingRuns` row in status='queued' and fires
 * the workflow off (fire-and-forget — the route returns the runId
 * immediately so the UI can subscribe to live updates).
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireUserResponse } from '@/lib/auth';
import { listArticleSourcesForArticleAsAdmin } from '@/lib/data/article-sources';
import { createWritingRunAsAdmin } from '@/lib/data/article-writing';
import { getNewArticleSuggestionByIdAsAdmin } from '@/lib/data/articles';
import { getSpecialty } from '@/lib/data/specialties';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { writeArticleWorkflow } from '@/lib/workflows/writing/write-article';

type Body = {
  specialtySlug?: string;
  articleRecordId?: string;
  language?: string;
  articleLength?: string;
  useTextBubbles?: boolean;
  model?: unknown;
};

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug?.trim();
  const articleRecordId = body.articleRecordId?.trim();

  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  if (!articleRecordId) {
    return NextResponse.json({ error: 'articleRecordId required' }, { status: 400 });
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

  const article = await getNewArticleSuggestionByIdAsAdmin(articleRecordId);
  if (!article || article.specialtySlug !== slug) {
    return NextResponse.json(
      { error: `article not found in specialty ${slug}: ${articleRecordId}` },
      { status: 404 },
    );
  }
  const articleTitle = article.articleTitle?.trim();
  if (!articleTitle) {
    return NextResponse.json(
      { error: 'article has no articleTitle — cannot draft' },
      { status: 409 },
    );
  }

  const sources = await listArticleSourcesForArticleAsAdmin(slug, articleRecordId);
  if (sources.length === 0) {
    return NextResponse.json(
      {
        error:
          'No sources attached. Run literature search and approve sources before drafting.',
        code: 'NO_SOURCES',
      },
      { status: 409 },
    );
  }

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

  const language = body.language?.trim() || 'en';
  const articleLength = body.articleLength?.trim() || 'medium';
  const useTextBubbles = body.useTextBubbles !== false;

  const run = await createWritingRunAsAdmin({
    specialtySlug: slug,
    articleRecordId,
    requestedByEmail,
    language,
    articleLength,
    useTextBubbles,
    modelProvider: model.provider,
    modelId: model.model,
    modelReasoning: model.reasoning,
  });

  // Fire-and-forget — the writing run continues past the response on
  // this long-lived Node server.
  void writeArticleWorkflow({
    runId: run.id,
    specialtySlug: slug,
    articleRecordId,
    articleTitle,
    language,
    articleLength,
    useTextBubbles,
    sources,
    model,
    apiKeys,
    requestedByEmail,
  }).catch((e) => {
    console.error('[write-article] workflow unhandled rejection', e);
  });

  revalidateTag(`specialty:${slug}`, 'max');

  return NextResponse.json({
    runId: run.id,
    specialty: slug,
    articleRecordId,
    passes: 6,
  });
}
