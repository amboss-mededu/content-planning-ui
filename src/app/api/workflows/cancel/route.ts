/**
 * Cancel a stuck or in-progress stage. NON-DESTRUCTIVE: it cancels the
 * specialty's non-terminal runs (so any fire-and-forget workflow aborts on its
 * next status poll) and returns the stuck stage's row to `pending` so the card
 * is re-runnable. It does NOT delete mappings, suggestions, consolidations, or
 * any downstream editor work — that destructive cascade now lives only behind
 * the explicit "Start over" path (`/api/workflows/reset-stage`).
 *
 * With the workflow runtime gone (PR 6), there is no separate workflow process
 * to cancel — work runs inline in the same Node server as fire-and-forget
 * promises spawned from the trigger routes. Marking the runs cancelled is
 * enough to unblock the UI; in-flight LLM calls finish on their own (or hit
 * `markStageFailed` if the new state confuses them).
 *
 * POST /api/workflows/cancel
 *   body: { runId: string; specialtySlug: string; stage: StageName }
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import { cancelStaleRunsForSpecialty, resetStage } from '@/lib/data/pipeline';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import type { StageName } from '@/lib/workflows/lib/db-writes';

const VALID_STAGES = [
  'extract_codes',
  'extract_milestones',
  'map_codes',
  'consolidate_primary',
  'consolidate_articles',
  'consolidate_sections',
] as const satisfies readonly StageName[];

const Body = z.object({
  runId: z.string().min(1, 'runId and specialtySlug required'),
  specialtySlug: z.string().min(1, 'runId and specialtySlug required'),
  stage: z.enum(VALID_STAGES, {
    message: `stage must be one of ${VALID_STAGES.join(', ')}`,
  }),
});

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;

  log('cancel-stage').info(body);

  // Cancel non-terminal runs first so a fire-and-forget workflow sees
  // `cancelled` on its next poll, then return the stuck stage row to pending.
  const { cancelled } = await cancelStaleRunsForSpecialty(body.specialtySlug);
  await resetStage({ runId: body.runId, stage: body.stage });

  revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({ ok: true, cancelled });
}
