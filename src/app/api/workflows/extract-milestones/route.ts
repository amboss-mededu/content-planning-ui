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
import { requireUserResponse } from '@/lib/auth';
import { listMilestoneSources } from '@/lib/data/milestone-sources';
import {
  createPipelineRun,
  initPipelineStage,
  updatePipelineRun,
} from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { extractMilestonesPhase1 } from '@/lib/workflows/preprocessing/extract-milestones';
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

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await updatePipelineRun(runId, {
    contentOutlineUrls: inputs,
    milestonesInstructions,
  });
  await initPipelineStage({ runId, stage: 'extract_milestones' });

  // Fire-and-forget: extraction continues past the response on this
  // long-lived Node server. Catch unhandled rejections so a thrown step
  // doesn't crash the process.
  void extractMilestonesPhase1({
    runId,
    specialtySlug: slug,
    inputs,
    milestonesInstructions: milestonesInstructions ?? undefined,
    model,
    apiKeys,
  }).catch((e) => {
    console.error('[extract-milestones] Phase1 unhandled rejection', e);
  });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    inputs: inputs.length,
    approvalToken: approvalToken(runId, 'extract_milestones'),
  });
}
