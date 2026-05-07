/**
 * Cancel a stuck or in-progress stage. Runs `resetStageCascade` so the card
 * returns to `pending` and the user can rerun.
 *
 * With the workflow runtime gone (PR 6), there is no separate workflow process
 * to cancel — work runs inline in the same Node server as fire-and-forget
 * promises spawned from the trigger routes. The reset alone is enough to
 * unblock the UI; in-flight LLM calls finish on their own (or hit
 * `markStageFailed` if the new state confuses them).
 *
 * POST /api/workflows/cancel
 *   body: { runId: string; specialtySlug: string; stage: StageName }
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
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

  const reset = await resetStageCascade({
    runId: body.runId,
    specialtySlug: body.specialtySlug,
    stage: body.stage,
  });

  revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({ ok: true, reset });
}
