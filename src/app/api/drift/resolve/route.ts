/**
 * Resolve a drift event — record the editor's acknowledgement and stop
 * surfacing it in the queue.
 *
 * POST /api/drift/resolve
 *   body: { eventId: string; notes?: string }
 *   → 200 { ok: true } | 404 { error }
 *
 * Flag-only: resolving does not verify the underlying eid was actually
 * fixed (noted as a follow-up). The resolver email comes from the session,
 * not the body.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, requireUserResponse } from '@/lib/auth';
import { resolveDriftEventAsAdmin } from '@/lib/data/content-drift';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';

const Body = z.object({
  eventId: z.string().min(1, 'eventId required'),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;

  const user = await getCurrentUser();
  log('drift-resolve').info({ eventId: body.eventId, by: user?.email });
  try {
    const resolved = await resolveDriftEventAsAdmin(
      body.eventId,
      user?.email ?? '',
      body.notes,
    );
    if (!resolved) {
      return NextResponse.json({ error: 'event not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    log('drift-resolve').error('failed', err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
