/**
 * Remap a single code from the codes table.
 *
 * POST /api/workflows/remap-code
 *   body: { specialtySlug, code, contentBase?, language?, checkAgainstLibrary? }
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { requireUserResponse } from '@/lib/auth';
import { fetchMutationAsUser, fetchQueryAsUser } from '@/lib/convex/server';
import { getConsolidationLockState } from '@/lib/data/codes';
import { getSpecialty } from '@/lib/data/specialties';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { clearMappingForCode } from '@/lib/workflows/lib/db-writes';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { mapCodesWorkflow } from '@/lib/workflows/mapping/map-codes';
import { api } from '../../../../../convex/_generated/api';

type Body = {
  specialtySlug?: string;
  code?: string;
  contentBase?: string;
  language?: string;
  checkAgainstLibrary?: boolean;
  additionalInstructions?: string;
  primaryModel?: unknown;
  backupModel?: unknown;
};

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug?.trim();
  const code = body.code?.trim();
  if (!slug || !code) {
    return NextResponse.json(
      { error: 'specialtySlug and code required' },
      { status: 400 },
    );
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

  console.log('[remap-code]', { slug, code });

  const lock = await getConsolidationLockState(slug);
  if (lock.locked) {
    return NextResponse.json(
      {
        error: 'Consolidation is active — reset the consolidation stage to remap codes.',
      },
      { status: 409 },
    );
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const existing = await fetchQueryAsUser(api.codes.get, { slug, code });
  if (!existing) {
    return NextResponse.json({ error: `code not found: ${code}` }, { status: 404 });
  }

  // Resolve keys BEFORE clearing the existing mapping + creating the run, so a
  // missing-key 409 doesn't wipe a working mapping.
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

  await clearMappingForCode(slug, code);

  const checkAgainstLibrary = body.checkAgainstLibrary !== false;
  const mappingInstructions = body.additionalInstructions?.trim() || null;
  const filter = { codes: [code] } as const;

  const { id: runId } = await fetchMutationAsUser(api.pipeline.createRun, {
    specialtySlug: slug,
  });
  await fetchMutationAsUser(api.pipeline.updateRun, {
    runId,
    patch: {
      mappingInstructions,
      mappingCheckIds: checkAgainstLibrary,
      mappingFilter: { codes: [...filter.codes] },
    },
  });
  await fetchMutationAsUser(api.pipeline.initStage, { runId, stage: 'map_codes' });

  const wfRun = await start(mapCodesWorkflow, [
    {
      runId,
      specialtySlug: slug,
      contentBase: body.contentBase?.trim() || undefined,
      language: body.language?.trim() || undefined,
      additionalInstructions: mappingInstructions ?? undefined,
      checkAgainstLibrary,
      filter: { codes: [code] },
      primaryModel,
      backupModel,
      apiKeys,
    },
  ]);

  await fetchMutationAsUser(api.pipeline.updateRun, {
    runId,
    patch: { workflowRunId: wfRun.runId },
  });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag(`codes:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    workflowRunId: wfRun.runId,
    specialty: slug,
    code,
    approvalToken: approvalToken(runId, 'map_codes'),
  });
}
