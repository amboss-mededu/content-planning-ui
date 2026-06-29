/**
 * "Start over" — reset a pipeline stage (and everything downstream) to
 * `pending`, permanently deleting the stage's output artifacts AND all the
 * editorial work derived from them (reviews, backlog, sources, drafts).
 *
 * POST /api/workflows/reset-stage
 *   body: {
 *     runId: string;
 *     specialtySlug: string;
 *     stage: StageName;
 *     confirm: true; // required — guards against accidental data loss
 *   }
 *
 * This is the destructive escape hatch, distinct from a normal per-bucket
 * re-run (which preserves downstream work) and from Cancel (which only
 * stops a run). `confirm: true` is mandatory; the UI gates it behind a
 * typed confirmation. Use only when the stage is in a terminal state
 * (completed / failed / skipped).
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import { resetStageCascade } from '@/lib/workflows/lib/reset';

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
  // Mandatory acknowledgement that this wipes downstream work. The client
  // only sends it after a typed confirmation; rejecting calls without it
  // keeps "Start over" from firing accidentally or programmatically.
  confirm: z.literal(true, {
    message: 'confirm must be true — this permanently deletes downstream work',
  }),
});

export async function POST(req: NextRequest) {
  const guard = await requireArchitectResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;

  log('reset-stage').info(body);
  const reset = await resetStageCascade({
    runId: body.runId,
    specialtySlug: body.specialtySlug,
    stage: body.stage,
  });

  revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({ ok: true, reset });
}
