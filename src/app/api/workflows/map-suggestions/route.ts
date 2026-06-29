/**
 * Trigger endpoint for the generate-suggestions (`map_suggestions`) backfill
 * workflow.
 *
 * POST /api/workflows/map-suggestions
 *   body: {
 *     specialtySlug: string;
 *     contentBase?: string;            // default derived from specialty.region
 *     language?: string;               // default derived from specialty.language
 *     additionalInstructions?: string; // appended to the suggestion prompt
 *     checkAgainstLibrary?: boolean;   // default true
 *     primaryModel?, backupModel?: ModelSpec
 *   }
 *
 * Verifies there is at least one coverage-mapped code still missing
 * suggestions (409 otherwise), creates a pipeline_runs row + map_suggestions
 * stage, and starts the workflow.
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import { countMappedWithoutSuggestions } from '@/lib/data/codes';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { generateSuggestionsWorkflow } from '@/lib/workflows/suggestions/generate-suggestions';

const Body = z.object({
  specialtySlug: z.string().optional(),
  contentBase: z.string().optional(),
  language: z.string().optional(),
  additionalInstructions: z.string().optional(),
  checkAgainstLibrary: z.boolean().optional(),
  primaryModel: z.unknown().optional(),
  backupModel: z.unknown().optional(),
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
  const primaryParse = parseModelSpec(body.primaryModel);
  if (!primaryParse.ok) {
    return NextResponse.json(
      { error: `primaryModel: ${primaryParse.error}` },
      { status: 400 },
    );
  }
  const backupParse = parseModelSpec(body.backupModel);
  if (!backupParse.ok) {
    return NextResponse.json(
      { error: `backupModel: ${backupParse.error}` },
      { status: 400 },
    );
  }
  const primaryModel = primaryParse.spec;
  const backupModel = backupParse.spec;

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const pendingCount = await countMappedWithoutSuggestions(slug);
  if (pendingCount === 0) {
    return NextResponse.json(
      {
        error:
          'No mapped codes need suggestions. Run code mapping first, or all mapped codes already have suggestions.',
      },
      { status: 409 },
    );
  }

  // Resolve keys BEFORE creating the run so a missing-key 409 doesn't leave a
  // zombie pipelineRuns row.
  const neededProviders = [...new Set([primaryModel.provider, backupModel.provider])];
  const apiKeys = await resolveApiKeysForRun(neededProviders);
  const missingProvider = neededProviders.find((p) => !apiKeys[p]);
  if (missingProvider) {
    return NextResponse.json(
      {
        error: `No API key configured for ${missingProvider}.`,
        code: 'MISSING_API_KEY',
        provider: missingProvider,
      },
      { status: 409 },
    );
  }

  const checkAgainstLibrary = body.checkAgainstLibrary !== false;
  const additionalInstructions = body.additionalInstructions?.trim() || undefined;

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await initPipelineStage({ runId, stage: 'map_suggestions' });

  after(() =>
    generateSuggestionsWorkflow({
      runId,
      specialtySlug: slug,
      contentBase: body.contentBase?.trim() || undefined,
      language: body.language?.trim() || undefined,
      additionalInstructions,
      checkAgainstLibrary,
      primaryModel,
      backupModel,
      apiKeys,
    }).catch((e) => {
      log('map-suggestions').error('workflow unhandled rejection', e);
    }),
  );

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({ runId, specialty: slug, pendingCount });
}
