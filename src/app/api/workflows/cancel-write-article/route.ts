/**
 * Cancel an in-flight article-writing run.
 *
 * POST /api/workflows/cancel-write-article
 *   body: { runId: string }
 *
 * Flips the writing run's status to `cancelled`. The orchestrator
 * checks the run status between passes and exits cooperatively, so the
 * effect is "the next pass won't start" — the currently executing
 * generateText call still completes its HTTP round trip.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import {
  cancelWritingRunAsAdmin,
  getWritingRunAsAdmin,
} from '@/lib/data/article-writing';
import { parseBodyOr400 } from '@/lib/http/parse-body';

const Body = z.object({ runId: z.string().optional() });

export async function POST(req: NextRequest) {
  const guard = await requireArchitectResponse();
  if (guard) return guard;

  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const runId = body.runId?.trim();
  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  const row = await getWritingRunAsAdmin(runId);
  if (!row) {
    return NextResponse.json({ error: `run not found: ${runId}` }, { status: 404 });
  }
  if (row.status === 'completed' || row.status === 'failed') {
    return NextResponse.json({ error: `run already ${row.status}` }, { status: 409 });
  }

  await cancelWritingRunAsAdmin(runId);
  return NextResponse.json({ runId, status: 'cancelled' });
}
