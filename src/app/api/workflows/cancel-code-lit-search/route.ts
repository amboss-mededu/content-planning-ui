/**
 * Manually cancel an in-flight per-code literature search.
 *
 * POST /api/workflows/cancel-code-lit-search
 *   body: { runId: string }   // the codeLitSearchRuns row id
 *
 * n8n owns the search, so this flips the row to `cancelled` and finalizes the
 * parent pipeline run/stage if it was the last active code. A late callback for
 * the now-terminal row is ignored as already-terminal.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import { cancelCodeLitSearchRunAsAdmin } from '@/lib/data/code-lit-search-runs';
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

  const row = await cancelCodeLitSearchRunAsAdmin(runId);
  if (!row) {
    return NextResponse.json({ error: `run not found: ${runId}` }, { status: 404 });
  }
  revalidateTag(`pipeline:${row.specialtySlug}`, 'max');
  revalidateTag(`specialty:${row.specialtySlug}`, 'max');
  return NextResponse.json({ runId, status: 'cancelled' });
}
