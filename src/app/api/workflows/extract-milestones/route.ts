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
import { type NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { requireUserResponse } from '@/lib/auth';
import { fetchMutationAsUser } from '@/lib/convex/server';
import { listMilestoneSources } from '@/lib/data/milestone-sources';
import { getSpecialty } from '@/lib/data/specialties';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { extractMilestonesWorkflow } from '@/lib/workflows/preprocessing/extract-milestones';
import { api } from '../../../../../convex/_generated/api';
import { parseContentInputs } from '../_lib/inputs';

type Body = {
  specialtySlug?: string;
  inputs?: unknown;
  milestonesInstructions?: string;
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

  const { id: runId } = await fetchMutationAsUser(api.pipeline.createRun, {
    specialtySlug: slug,
  });
  await fetchMutationAsUser(api.pipeline.updateRun, {
    runId,
    patch: {
      contentOutlineUrls: inputs,
      milestonesInstructions,
    },
  });
  await fetchMutationAsUser(api.pipeline.initStage, {
    runId,
    stage: 'extract_milestones',
  });

  const wfRun = await start(extractMilestonesWorkflow, [
    {
      runId,
      specialtySlug: slug,
      inputs,
      milestonesInstructions: milestonesInstructions ?? undefined,
      model,
      apiKeys,
    },
  ]);

  await fetchMutationAsUser(api.pipeline.updateRun, {
    runId,
    patch: { workflowRunId: wfRun.runId },
  });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    workflowRunId: wfRun.runId,
    specialty: slug,
    inputs: inputs.length,
    approvalToken: approvalToken(runId, 'extract_milestones'),
  });
}
