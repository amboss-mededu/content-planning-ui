/**
 * Trigger endpoint for the map-codes workflow.
 *
 * POST /api/workflows/map-codes
 *   body: {
 *     specialtySlug: string;
 *     contentBase?: string;                 // default derived from specialty.region
 *     language?: string;                    // default derived from specialty.language
 *     additionalInstructions?: string;      // appended to DEFAULT_MAPPING_SYSTEM_PROMPT
 *     checkAgainstLibrary?: boolean;        // default true
 *     categories?: string[];                // limit mapping to rows with category in this list
 *     codes?: string[];                     // additionally include these specific codes
 *   }
 *
 * Verifies there is at least one unmapped code matching the filter (409 when
 * the filter excludes everything), creates a pipeline_runs row + map_codes
 * stage, and starts the workflow.
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import {
  listApprovedMappedCodesAsAdmin,
  listUnmappedCodesAsAdmin,
} from '@/lib/data/codes';
import {
  createPipelineRun,
  initPipelineStage,
  updatePipelineRun,
} from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { approvalToken } from '@/lib/workflows/lib/approval';
import { clearMappingForCode, type MappingFilter } from '@/lib/workflows/lib/db-writes';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';
import { mapCodesWorkflow } from '@/lib/workflows/mapping/map-codes';

const Body = z.object({
  specialtySlug: z.string().optional(),
  contentBase: z.string().optional(),
  language: z.string().optional(),
  additionalInstructions: z.string().optional(),
  checkAgainstLibrary: z.boolean().optional(),
  categories: z.unknown().optional(),
  codes: z.unknown().optional(),
  // Curriculum-mapping only: clear the existing mapping for the approved,
  // already-mapped codes in scope before mapping, so they get re-mapped
  // ("remap"). Ignored for other pipeline modes.
  clearMappedFirst: z.boolean().optional(),
  primaryModel: z.unknown().optional(),
  backupModel: z.unknown().optional(),
});

function stringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out.length > 0 ? [...new Set(out)] : undefined;
}

/**
 * Count unmapped rows that match the filter, so we can fail fast with a 409
 * when the filter excludes everything instead of spawning an empty workflow.
 */
async function countUnmappedWithFilter(
  slug: string,
  filter: MappingFilter | null,
): Promise<number> {
  const rows = await listUnmappedCodesAsAdmin(slug, {
    categories: filter?.categories ?? undefined,
    codes: filter?.codes ?? undefined,
  });
  return rows.length;
}

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

  const filterCategories = stringArray(body.categories);
  const filterCodes = stringArray(body.codes);
  const filter: MappingFilter | null =
    filterCategories || filterCodes
      ? { categories: filterCategories, codes: filterCodes }
      : null;

  // Remap: in curriculum-mapping mode, clear the existing mapping for the
  // approved + already-mapped codes in scope so the unmapped count below picks
  // them up and the workflow re-maps them. Approval is preserved (clearing only
  // touches coverage + mappedAt).
  if (body.clearMappedFirst && spec.pipelineMode === 'curriculum-mapping') {
    const toClear = await listApprovedMappedCodesAsAdmin(slug, filter);
    for (const code of toClear) {
      await clearMappingForCode(slug, code);
    }
    log('map-codes').info('remap cleared mapped codes', {
      slug,
      cleared: toClear.length,
    });
  }

  const unmappedCount = await countUnmappedWithFilter(slug, filter);
  if (unmappedCount === 0) {
    return NextResponse.json(
      {
        error: filter
          ? 'No unmapped codes match the selected categories or codes.'
          : 'No unmapped codes for this specialty. Reset the mapping stage to remap everything, or run extract codes first.',
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
  const mappingInstructions = body.additionalInstructions?.trim() || null;

  const { id: runId } = await createPipelineRun({ specialtySlug: slug });
  await updatePipelineRun(runId, {
    mappingInstructions,
    mappingCheckIds: checkAgainstLibrary,
    ...(filter ? { mappingFilter: filter } : {}),
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
      // Mapping-only specialties run coverage only — no suggestion generation.
      includeSuggestions: !spec.mappingOnly,
      filter,
      primaryModel,
      backupModel,
      apiKeys,
    }).catch((e) => {
      log('map-codes').error('workflow unhandled rejection', e);
    }),
  );

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    unmappedCount,
    approvalToken: approvalToken(runId, 'map_codes'),
  });
}
