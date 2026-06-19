/**
 * Trigger endpoint for the code/topic-level literature-search workflow
 * (the RAG-corpus mapping-sheet "Run literature search" action).
 *
 * POST /api/workflows/code-lit-search
 *   body: {
 *     specialtySlug: string,
 *     codeIds?: string[],     // explicit subset (per-row or chosen bulk set)
 *     includeAll?: boolean,   // ignore the coverage-score gate (run for all)
 *   }
 *
 * Eligibility: mapped codes only. With an explicit `codeIds` subset, exactly
 * those are run (the row button / approval modal already scoped them). Otherwise
 * the default scope is codes whose coverage score is < 3; `includeAll` widens it
 * to every mapped code. Reuses the article-level n8n webhook with no n8n changes
 * — see dispatchCodeLitSearch. Results land via .../code-lit-search/callback.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
import { requireUserResponse } from '@/lib/auth';
import {
  attachPipelineRunToCodeLitSearchRunsAsAdmin,
  claimCodeLitSearchRunAsAdmin,
  finishCodeLitSearchRunAsAdmin,
  reapStaleCodeLitSearchRunsAsAdmin,
} from '@/lib/data/code-lit-search-runs';
import { listCodes } from '@/lib/data/codes';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { dispatchCodeLitSearch } from '@/lib/workflows/code-lit-search';

/** Coverage score (0–5) below which a topic is searched by default. */
const COVERAGE_THRESHOLD = 3;

const Body = z.object({
  specialtySlug: z.string().optional(),
  codeIds: z.array(z.string()).optional().catch(undefined),
  includeAll: z.boolean().optional(),
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
  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  // Reap stuck `running` rows older than the timeout before claiming so a
  // previously-stalled code doesn't keep blocking new attempts.
  await reapStaleCodeLitSearchRunsAsAdmin(slug);

  const codes = await listCodes(slug);
  const filterIds = Array.isArray(body.codeIds)
    ? new Set(body.codeIds.filter((s) => typeof s === 'string' && s.length > 0))
    : null;
  const includeAll = body.includeAll === true;

  // Only mapped codes are eligible. An explicit subset runs exactly those
  // (regardless of score); otherwise default to coverage < 3 unless includeAll.
  const eligible = codes.filter((c) => {
    if (!c.id || !c.mappedAt) return false;
    if (filterIds) return filterIds.has(c.id);
    if (includeAll) return true;
    const score = c.overallDepthOfCoverage ?? c.depthOfCoverage ?? 0;
    return score < COVERAGE_THRESHOLD;
  });

  if (eligible.length === 0) {
    return NextResponse.json({ skipped: true, codes: 0 });
  }

  const claimed: Array<{
    codeId: string;
    code: string;
    description: string;
    litSearchRunId: string;
  }> = [];
  let alreadyRunning = 0;
  for (const c of eligible) {
    const codeId = c.id ?? '';
    const claim = await claimCodeLitSearchRunAsAdmin({
      specialtySlug: slug,
      codeId,
      code: c.code,
    });
    if (!claim.claimed) {
      alreadyRunning++;
      continue;
    }
    claimed.push({
      codeId,
      code: c.code,
      description: c.description ?? c.code,
      litSearchRunId: claim.record.id,
    });
  }

  if (claimed.length === 0) {
    return NextResponse.json({
      skipped: true,
      reason: alreadyRunning > 0 ? 'already_running' : 'no_claims',
      codes: 0,
      alreadyRunning,
    });
  }

  let runId: string;
  try {
    const run = await createPipelineRun({ specialtySlug: slug });
    runId = run.id;
    await initPipelineStage({ runId, stage: 'literature_search' });
    await attachPipelineRunToCodeLitSearchRunsAsAdmin(
      claimed.map((t) => t.litSearchRunId),
      runId,
    );
  } catch (e) {
    const msg = errorMessage(e);
    await Promise.all(
      claimed.map((t) =>
        finishCodeLitSearchRunAsAdmin(t.litSearchRunId, {
          status: 'failed',
          errorMessage: `Failed to start literature-search run: ${msg}`,
          sourcesCount: 0,
        }),
      ),
    );
    throw e;
  }

  // Prefer the explicit override so local dev can hit localhost in the browser
  // while n8n calls back through a tunnel. Falls back to the request origin.
  const callbackOrigin = env.N8N_CALLBACK_BASE_URL ?? req.nextUrl.origin;
  const callbackUrl = new URL(
    '/api/workflows/code-lit-search/callback',
    callbackOrigin,
  ).toString();

  const dispatchResult = await dispatchCodeLitSearch({
    runId,
    specialtySlug: slug,
    callbackUrl,
    topics: claimed,
  });

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag(`specialty:${slug}`, 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    codes: claimed.length,
    alreadyRunning,
    dispatched: dispatchResult.dispatched,
    dispatchFailed: dispatchResult.failed,
  });
}
