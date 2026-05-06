/**
 * Trigger endpoint for the extract-codes workflow.
 *
 * POST /api/workflows/extract
 *   body: {
 *     specialtySlug: string;
 *     inputs: Array<{ source: 'ab' | 'orphanet' | 'icd10'; url: string }>;
 *     identifyModulesInstructions?: string;
 *     extractCodesInstructions?: string;
 *   }
 *
 * Responsibility:
 *   1. Verify the specialty exists in Convex.
 *   2. Create a pipelineRuns row + the extract_codes stage.
 *   3. Call `start(extractCodesWorkflow, ...)` and record the workflow run id.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { requireUserResponse } from '@/lib/auth';
import { listCodeSources } from '@/lib/data/code-sources';
import {
  createPipelineRun,
  initPipelineStage,
  updatePipelineRun,
} from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { extractCodesWorkflow } from '@/lib/workflows/preprocessing/extract-codes';
import { parseContentInputs } from '../_lib/inputs';

type Body = {
  specialtySlug?: string;
  inputs?: unknown;
  identifyModulesInstructions?: string;
  extractCodesInstructions?: string;
  model?: unknown;
};

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  const modelParse = parseModelSpec(body.model);
  if (!modelParse.ok) {
    return NextResponse.json({ error: modelParse.error }, { status: 400 });
  }
  const model = modelParse.spec;
  const sourceRows = await listCodeSources();
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

  const identifyInstructions = body.identifyModulesInstructions?.trim() || null;
  const extractInstructions = body.extractCodesInstructions?.trim() || null;

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await updatePipelineRun(runId, {
    contentOutlineUrls: inputs,
    ...(identifyInstructions
      ? { identifyModulesInstructions: identifyInstructions }
      : {}),
    ...(extractInstructions ? { extractCodesInstructions: extractInstructions } : {}),
  });
  await initPipelineStage({ runId, stage: 'extract_codes' });

  const wfRun = await start(extractCodesWorkflow, [
    {
      runId,
      specialtySlug: slug,
      inputs,
      identifyInstructions: identifyInstructions ?? undefined,
      extractInstructions: extractInstructions ?? undefined,
      model,
      apiKeys,
    },
  ]);

  await updatePipelineRun(runId, { workflowRunId: wfRun.runId });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    workflowRunId: wfRun.runId,
    specialty: slug,
    inputs: inputs.length,
    approvalToken: approvalToken(runId, 'extract_codes'),
  });
}
