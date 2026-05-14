/**
 * Trigger endpoint for the literature-search workflow.
 *
 * POST /api/workflows/literature-search
 *   body: { specialtySlug: string }
 *
 * Responsibility:
 *   1. Verify auth + specialty.
 *   2. Resolve the Google API key (Gemini-only workflow).
 *   3. Find approved 2nd-pass new-article suggestions whose effective
 *      backlog status is `waiting-for-sources` (no PB row, status=
 *      `unassigned`, or status=`waiting-for-sources` are all treated
 *      as waiting).
 *   4. Skip with 200 + `{ skipped: true }` if nothing to do — no run
 *      row created.
 *   5. Otherwise create the pipelineRuns + pipelineStages rows and
 *      kick off the background worker fire-and-forget.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { extractCodes } from '@/app/planning/_components/code-utils';
import { requireUserResponse } from '@/lib/auth';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listNewArticleSuggestions } from '@/lib/data/articles';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { runLiteratureSearch } from '@/lib/workflows/literature-search';

type Body = { specialtySlug?: string };

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const apiKeys = await resolveApiKeysForRun(['google']);
  if (!apiKeys.google) {
    return NextResponse.json(
      {
        error: 'No Google API key configured.',
        code: 'MISSING_API_KEY',
        provider: 'google',
      },
      { status: 409 },
    );
  }

  const [suggestions, reviews, backlog] = await Promise.all([
    listNewArticleSuggestions(slug),
    listArticleReviews(slug),
    listArticleBacklog(slug),
  ]);

  // Eligible articles: approved 2nd-pass + effective status is
  // waiting-for-sources (no row, unassigned, or explicit waiting).
  const eligible = suggestions
    .filter((r) => r.id && reviews[r.id]?.status === 'approved')
    .filter((r) => {
      const id = r.id;
      if (!id) return false;
      const status = backlog[id]?.status;
      return (
        status === undefined ||
        status === 'unassigned' ||
        status === 'waiting-for-sources'
      );
    });

  if (eligible.length === 0) {
    return NextResponse.json({ skipped: true, articles: 0 });
  }

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await initPipelineStage({ runId, stage: 'literature_search' });

  const articles = eligible.map((r) => {
    const id = r.id ?? '';
    const codeRows = extractCodes(r.codes);
    return {
      id,
      articleTitle: r.articleTitle,
      codes: codeRows.map((c) => c.description ?? c.code).filter((s): s is string => !!s),
    };
  });

  void runLiteratureSearch({
    runId,
    specialtySlug: slug,
    articles,
    apiKeys,
  }).catch((e) => {
    console.error('[literature-search] unhandled rejection', e);
  });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag(`specialty:${slug}`, 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    articles: articles.length,
  });
}
