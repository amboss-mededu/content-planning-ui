/**
 * Manually cancel an in-flight article draft.
 *
 * POST /api/workflows/cancel-draft-article
 *   body: { runId: string }
 *
 * n8n owns the job, so this just flips the `articleDraftRuns` row to
 * `cancelled` — the UI unblocks and a retry can claim a fresh run. The
 * actual n8n execution (if still running) finishes on its own; a late
 * callback for a non-`running` row is ignored as already-terminal.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import {
  cancelArticleDraftRunAsAdmin,
  getArticleDraftRunAsAdmin,
} from '@/lib/data/article-draft-runs';
import { parseBodyOr400 } from '@/lib/http/parse-body';

const Body = z.object({ runId: z.string().optional() });

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const runId = body.runId?.trim();
  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  const row = await getArticleDraftRunAsAdmin(runId);
  if (!row) {
    return NextResponse.json({ error: `run not found: ${runId}` }, { status: 404 });
  }
  if (row.status !== 'running') {
    return NextResponse.json({ error: `run already ${row.status}` }, { status: 409 });
  }

  await cancelArticleDraftRunAsAdmin(runId);
  revalidateTag(`pipeline:${row.specialtySlug}`, 'max');
  revalidateTag(`specialty:${row.specialtySlug}`, 'max');
  return NextResponse.json({ runId, status: 'cancelled' });
}
