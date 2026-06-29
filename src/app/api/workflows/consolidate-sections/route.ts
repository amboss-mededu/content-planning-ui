/**
 * Trigger endpoint for the whole-specialty sections-secondary step.
 *
 * POST /api/workflows/consolidate-sections
 *   body: { specialtySlug: string }
 *
 * Stub today: dedupes `articleUpdateSuggestions` by article/section key →
 * writes the specialty's `consolidatedSections` rows.
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import { listArticleUpdateSuggestionsAsAdmin } from '@/lib/data/articles';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { consolidateSectionsSecondaryWorkflow } from '@/lib/workflows/consolidation/sections-secondary';

const Body = z.object({
  specialtySlug: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireArchitectResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const staging = await listArticleUpdateSuggestionsAsAdmin(slug);
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
  await initPipelineStage({ runId, stage: 'consolidate_sections' });

  // Defer with `after()` so Next keeps the work alive past the response. A
  // bare `void ...()` is dropped once the handler returns and never runs.
  after(() =>
    consolidateSectionsSecondaryWorkflow({
      runId,
      specialtySlug: slug,
    }).catch((e) => {
      log('consolidate-sections').error('workflow unhandled rejection', e);
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
