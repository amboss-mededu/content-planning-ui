/**
 * Trigger endpoint for code extraction.
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
 *   1. Verify the specialty exists.
 *   2. Create a pipelineRuns row + the extract_codes stage.
 *   3. Kick off `extractCodesPhase1` fire-and-forget — the route returns
 *      immediately while the background promise drives the pipeline. The
 *      app runs as a long-lived Node server (`next start`), so background
 *      promises continue past the response.
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import { listCodeSources } from '@/lib/data/code-sources';
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
import { extractCodesPhase1 } from '@/lib/workflows/preprocessing/extract-codes';
import { parseContentInputs } from '../_lib/inputs';

const Body = z.object({
  specialtySlug: z.string().optional(),
  inputs: z.unknown().optional(),
  identifyModulesInstructions: z.string().optional(),
  extractCodesInstructions: z.string().optional(),
  model: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
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
  // Persist `running` synchronously so a reload shows the in-progress state
  // immediately — the background body below only starts after the response.
  await initPipelineStage({ runId, stage: 'extract_codes', status: 'running' });

  // Defer extraction with `after()` rather than a bare `void` promise: Next
  // tracks the callback and keeps it alive past the response, so the work
  // actually runs to completion. A detached `void ...()` is dropped once the
  // handler returns and the step never executes. Unhandled rejections are
  // logged so a thrown step doesn't crash the Node process.
  after(() =>
    extractCodesPhase1({
      runId,
      specialtySlug: slug,
      inputs,
      identifyInstructions: identifyInstructions ?? undefined,
      extractInstructions: extractInstructions ?? undefined,
      model,
      apiKeys,
    }).catch((e) => {
      log('extract').error('Phase1 unhandled rejection', e);
    }),
  );

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    inputs: inputs.length,
    approvalToken: approvalToken(runId, 'extract_codes'),
  });
}
