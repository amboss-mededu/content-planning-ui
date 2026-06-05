/**
 * Manually cancel an in-flight per-article literature search.
 *
 * POST /api/workflows/cancel-lit-search
 *   body: { runId: string }   // the articleLitSearchRuns row id
 *
 * n8n owns the search, so this flips the row to `cancelled` and finalizes
 * the parent pipeline run/stage if it was the last active article. A late
 * callback for the now-terminal row is ignored as already-terminal.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { cancelArticleLitSearchRunAsAdmin } from '@/lib/data/article-lit-search-runs';

type Body = { runId?: string };

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as Body;
  const runId = body.runId?.trim();
  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  const row = await cancelArticleLitSearchRunAsAdmin(runId);
  if (!row) {
    return NextResponse.json({ error: `run not found: ${runId}` }, { status: 404 });
  }
  revalidateTag(`pipeline:${row.specialtySlug}`, 'max');
  revalidateTag(`specialty:${row.specialtySlug}`, 'max');
  return NextResponse.json({ runId, status: 'cancelled' });
}
