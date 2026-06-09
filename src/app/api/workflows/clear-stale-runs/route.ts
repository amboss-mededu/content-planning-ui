/**
 * Cancel non-terminal pipeline runs for a specialty without touching data.
 *
 * POST /api/workflows/clear-stale-runs
 *   body: { specialtySlug: string }
 *   → 200 { ok: true, cancelled: number }
 *
 * Used by the Map codes "Continue mapping" flow: a previous remap-code or
 * partial map_codes run can crash without finalising its pipeline_runs row,
 * leaving `status='running'` and pinning the dashboard in "Run in progress."
 * This route flips those rows to `cancelled` so getCurrentPipelineRun stops
 * reporting an active run, but keeps every mapped code intact — unlike
 * /api/workflows/reset-stage, which cascades through stage data.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { clearStaleRunsForSpecialty } from '@/lib/workflows/lib/reset';

const Body = z.object({
  specialtySlug: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  if (!body.specialtySlug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }

  log('clear-stale-runs').info(body);
  try {
    const cancelled = await clearStaleRunsForSpecialty(body.specialtySlug);
    revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
    revalidateTag('specialty-phases', 'max');
    return NextResponse.json({ ok: true, cancelled });
  } catch (err) {
    log('clear-stale-runs').error('failed', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
