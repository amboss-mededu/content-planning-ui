/**
 * Remap a single code from the codes table.
 *
 * POST /api/workflows/remap-code
 *   body: { specialtySlug, code, contentBase?, language?, checkAgainstLibrary? }
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import { getCodeAsAdmin } from '@/lib/data/codes';
import {
  createPipelineRun,
  getConsolidationActivity,
  initPipelineStage,
  isBucketEditBlocked,
  updatePipelineRun,
} from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { clearMappingForCode } from '@/lib/workflows/lib/db-writes';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { mapCodesWorkflow } from '@/lib/workflows/mapping/map-codes';

const Body = z.object({
  specialtySlug: z.string().optional(),
  code: z.string().optional(),
  contentBase: z.string().optional(),
  language: z.string().optional(),
  checkAgainstLibrary: z.boolean().optional(),
  additionalInstructions: z.string().optional(),
  primaryModel: z.unknown().optional(),
  backupModel: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
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

  log('remap-code').info({ slug, code });

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const existing = await getCodeAsAdmin(slug, code);
  if (!existing) {
    return NextResponse.json({ error: `code not found: ${code}` }, { status: 404 });
  }

  // Block only when this code's bucket (or the whole specialty) is actively
  // rebuilding — the sheet is otherwise always remappable.
  const activity = await getConsolidationActivity(slug);
  if (isBucketEditBlocked(activity, existing.consolidationCategory)) {
    const label = activity.runningAll
      ? 'A full consolidation'
      : `Consolidation for "${existing.consolidationCategory}"`;
    return NextResponse.json(
      { error: `${label} is running — remap once it finishes (a minute or two).` },
      { status: 409 },
    );
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

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await updatePipelineRun(runId, {
    mappingInstructions,
    mappingCheckIds: checkAgainstLibrary,
    mappingFilter: { codes: [...filter.codes] },
  });
  await initPipelineStage({ runId, stage: 'map_codes' });

  // Defer with `after()` so Next keeps the work alive past the response. A
  // bare `void ...()` is dropped once the handler returns and never runs.
  after(() =>
    mapCodesWorkflow({
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
    }).catch((e) => {
      log('remap-code').error('workflow unhandled rejection', e);
    }),
  );

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag(`codes:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    code,
    approvalToken: approvalToken(runId, 'map_codes'),
  });
}
