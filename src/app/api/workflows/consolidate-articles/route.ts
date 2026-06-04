/**
 * Trigger endpoint for the whole-specialty articles-secondary step.
 *
 * POST /api/workflows/consolidate-articles
 *   body: { specialtySlug: string }
 *
 * Stub today: dedupes `newArticleSuggestions` by title → writes the
 * specialty's `consolidatedArticles` rows. Returns 409 if there's no
 * primary staging output to dedupe.
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { listNewArticleSuggestionsAsAdmin } from '@/lib/data/articles';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { consolidateArticlesSecondaryWorkflow } from '@/lib/workflows/consolidation/articles-secondary';

type Body = {
  specialtySlug?: string;
};

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

  const staging = await listNewArticleSuggestionsAsAdmin(slug);
  if (staging.length === 0) {
    return NextResponse.json(
      {
        error:
          'No primary staging rows to dedupe. Run primary consolidation for at least one category first.',
      },
      { status: 409 },
    );
  }

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await initPipelineStage({ runId, stage: 'consolidate_articles' });

  // Defer with `after()` so Next keeps the work alive past the response. A
  // bare `void ...()` is dropped once the handler returns and never runs.
  after(() =>
    consolidateArticlesSecondaryWorkflow({
      runId,
      specialtySlug: slug,
    }).catch((e) => {
      console.error('[consolidate-articles] workflow unhandled rejection', e);
    }),
  );

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    stagingCandidates: staging.length,
  });
}
