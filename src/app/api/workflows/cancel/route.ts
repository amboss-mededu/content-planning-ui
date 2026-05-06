/**
 * Cancel a stuck or in-progress stage. Stops the underlying workflow run
 * (best-effort) and runs `resetStageCascade` so the card returns to
 * `pending` and the user can rerun.
 *
 * POST /api/workflows/cancel
 *   body: { runId: string; specialtySlug: string; stage: StageName }
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getRun } from 'workflow/api';
import { requireUserResponse } from '@/lib/auth';
import { getRunAsAdmin } from '@/lib/data/pipeline';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import { resetStageCascade } from '@/lib/workflows/lib/reset';

const VALID_STAGES: ReadonlySet<StageName> = new Set([
  'extract_codes',
  'extract_milestones',
  'map_codes',
  'consolidate_primary',
  'consolidate_articles',
  'consolidate_sections',
]);

type Body = {
  runId?: string;
  specialtySlug?: string;
  stage?: StageName;
};

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.runId || !body.specialtySlug) {
    return NextResponse.json(
      { error: 'runId and specialtySlug required' },
      { status: 400 },
    );
  }
  if (!body.stage || !VALID_STAGES.has(body.stage)) {
    return NextResponse.json(
      { error: `stage must be one of ${[...VALID_STAGES].join(', ')}` },
      { status: 400 },
    );
  }

  console.log('[cancel-stage]', body);

  const run = await getRunAsAdmin(body.runId);

  // Reset state first — this is what unblocks the UI. The workflow runtime
  // cancel is fire-and-forget below.
  const reset = await resetStageCascade({
    runId: body.runId,
    specialtySlug: body.specialtySlug,
    stage: body.stage,
  });

  revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  let workflowCancelled = false;
  let workflowError: string | null = null;
  if (run?.workflowRunId) {
    try {
      await Promise.race([
        getRun(run.workflowRunId).cancel(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('cancel timeout (3s)')), 3000),
        ),
      ]);
      workflowCancelled = true;
    } catch (e) {
      workflowError = e instanceof Error ? e.message : String(e);
      console.warn('[cancel-stage] workflow cancel failed', workflowError);
    }
  }

  return NextResponse.json({ ok: true, workflowCancelled, workflowError, reset });
}
