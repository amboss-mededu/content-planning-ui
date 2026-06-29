/**
 * Trigger endpoint for the extract-milestones workflow.
 *
 * POST /api/workflows/extract-milestones
 *   body: {
 *     specialtySlug: string;
 *     inputs: Array<{ source: string; url: string }>;
 *     milestonesInstructions?: string;
 *   }
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import { listMilestoneSources } from '@/lib/data/milestone-sources';
import {
  createPipelineRun,
  initPipelineStage,
  updatePipelineRun,
} from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { extractMilestonesPhase1 } from '@/lib/workflows/preprocessing/extract-milestones';
import { parseContentInputs } from '../_lib/inputs';

const Body = z.object({
  specialtySlug: z.string().optional(),
  inputs: z.unknown().optional(),
  milestonesInstructions: z.string().optional(),
  model: z.unknown().optional(),
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
  const modelParse = parseModelSpec(body.model);
  if (!modelParse.ok) {
    return NextResponse.json({ error: modelParse.error }, { status: 400 });
  }
  const model = modelParse.spec;
  const sourceRows = await listMilestoneSources();
  const allowedSlugs = sourceRows.map((r) => r.slug);
  const parsed = parseContentInputs(body.inputs, allowedSlugs);
  if (!Array.isArray(parsed)) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const inputs = parsed;

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  // Resolve keys BEFORE creating the run so a missing-key 409 doesn't leave a
  // zombie pipelineRuns row.
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

  const milestonesInstructions = body.milestonesInstructions?.trim() || null;

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await updatePipelineRun(runId, {
    contentOutlineUrls: inputs,
    milestonesInstructions,
  });
  // Persist `running` synchronously so a reload shows the in-progress state
  // immediately — the background body below only starts after the response.
  await initPipelineStage({ runId, stage: 'extract_milestones', status: 'running' });

  // Defer extraction with `after()` rather than a bare `void` promise: Next
  // tracks the callback and keeps it alive past the response, so the work
  // actually runs to completion. A detached `void ...()` is dropped once the
  // handler returns and the step never executes. Catch unhandled rejections
  // so a thrown step doesn't crash the process.
  after(() =>
    extractMilestonesPhase1({
      runId,
      specialtySlug: slug,
      inputs,
      milestonesInstructions: milestonesInstructions ?? undefined,
      model,
      apiKeys,
      pipelineMode: spec.pipelineMode,
    }).catch((e) => {
      log('extract-milestones').error('Phase1 unhandled rejection', e);
    }),
  );

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    inputs: inputs.length,
    approvalToken: approvalToken(runId, 'extract_milestones'),
  });
}
