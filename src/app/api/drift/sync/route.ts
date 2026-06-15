/**
 * Pull the CMS content-change feed and store new events.
 *
 * POST /api/drift/sync
 *   → 200 { ok: true, ingested, pages, cursor, stub }
 *
 * CMS-global (events aren't specialty-scoped); specialty filtering happens
 * at join time in `getDriftImpacts`. Manual button now, cron-able later.
 * No-op (ingested: 0, stub: true) when CONTENT_CHANGE_FEED_URL is unset.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { ingestContentChangesAsAdmin } from '@/lib/data/content-drift';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';

export async function POST(_req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  try {
    const result = await ingestContentChangesAsAdmin();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log('drift-sync').error('failed', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
