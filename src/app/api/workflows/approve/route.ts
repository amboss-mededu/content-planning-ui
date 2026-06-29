/**
 * Resolve a stage that is `awaiting_approval`.
 *
 * POST /api/workflows/approve
 *   body: {
 *     runId: string;
 *     specialtySlug: string;
 *     stage: 'extract_codes' | 'extract_milestones' | 'map_codes';
 *     approved: boolean;
 *     note?: string;
 *   }
 *
 * With the workflow runtime gone (PR 6), there is no paused hook to resume.
 * Phase 1 stashed the draft on `pipelineStages.draftPayload` and parked the
 * stage; this route invokes the matching `*Phase2` continuation directly to
 * promote (or reject) the draft. `map_codes` does not have an approval gate
 * so this route 400s for that stage.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import type { ApprovableStage } from '@/lib/workflows/lib/approval';
import { extractCodesPhase2 } from '@/lib/workflows/preprocessing/extract-codes';
import { extractMilestonesPhase2 } from '@/lib/workflows/preprocessing/extract-milestones';

const APPROVABLE_STAGES = [
  'extract_codes',
  'extract_milestones',
] as const satisfies readonly ApprovableStage[];

// `approvedBy` is intentionally NOT in the body shape — the server stamps the
// authenticated user's email on the audit trail, never trusts a value from the
// client.
const Body = z.object({
  runId: z.string().min(1, 'runId required'),
  specialtySlug: z.string().min(1, 'specialtySlug required'),
  stage: z.enum(APPROVABLE_STAGES, {
    message: `stage must be one of ${APPROVABLE_STAGES.join(', ')}`,
  }),
  approved: z.boolean({ message: 'approved (boolean) required' }),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.role !== 'architect') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;

  const approvedBy = user.email ?? user.name ?? user._id;
  log('approve').info('resolving stage', {
    runId: body.runId,
    stage: body.stage,
    approved: body.approved,
    approvedBy,
  });

  const phase2Input = {
    runId: body.runId,
    specialtySlug: body.specialtySlug,
    approved: body.approved,
    approvedBy,
    note: body.note,
  };

  // Run the continuation inline — these are quick (DB writes only, no LLM
  // calls) so the user can see the result on the next page load.
  if (body.stage === 'extract_codes') {
    await extractCodesPhase2(phase2Input);
  } else {
    await extractMilestonesPhase2(phase2Input);
  }

  revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
  revalidateTag(`codes:${body.specialtySlug}`, 'max');
  revalidateTag(`specialty:${body.specialtySlug}`, 'max');
  revalidateTag('specialty-phases', 'max');
  revalidateTag('specialties', 'max');

  return NextResponse.json({ ok: true });
}
