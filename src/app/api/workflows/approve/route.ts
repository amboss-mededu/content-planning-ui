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
import { getCurrentUser } from '@/lib/auth';
import type { ApprovableStage } from '@/lib/workflows/lib/approval';
import { extractCodesPhase2 } from '@/lib/workflows/preprocessing/extract-codes';
import { extractMilestonesPhase2 } from '@/lib/workflows/preprocessing/extract-milestones';

type Body = {
  runId?: string;
  specialtySlug?: string;
  stage?: ApprovableStage;
  approved?: boolean;
  // `approvedBy` is intentionally NOT in the body shape — the server stamps
  // the authenticated user's email on the audit trail, never trusts a value
  // from the client.
  note?: string;
};

const APPROVABLE_STAGES: ReadonlySet<ApprovableStage> = new Set([
  'extract_codes',
  'extract_milestones',
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }
  if (!body.specialtySlug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }
  if (!body.stage || !APPROVABLE_STAGES.has(body.stage)) {
    return NextResponse.json(
      {
        error: `stage must be one of ${[...APPROVABLE_STAGES].join(', ')}`,
      },
      { status: 400 },
    );
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved (boolean) required' }, { status: 400 });
  }

  const approvedBy = user.email ?? user.name ?? user._id;
  console.log('[approve] resolving stage', {
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
