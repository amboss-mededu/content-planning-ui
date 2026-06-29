/**
 * Cancel the in-progress (or stuck) mapping for a specialty — backs the
 * universal "Cancel mapping" button on the Mapping sheet, the Map-codes modal,
 * and the code-detail modal. NON-DESTRUCTIVE, mirroring /api/workflows/cancel:
 * it marks the specialty's running mapping run(s) cancelled (so the
 * fire-and-forget workflow aborts on its next status poll), returns the mapping
 * stage to `pending`, and clears the in-flight markers so the sheet's "Mapping…"
 * pulses disappear immediately. Coverage already written to `codes` is kept.
 *
 * Unlike /api/workflows/cancel this needs no runId/stage from the client — the
 * active mapping run is resolved server-side — so the button only has to know
 * the specialty slug, which makes it trivially reusable from every surface.
 *
 * POST /api/workflows/cancel-mapping
 *   body: { specialtySlug: string }
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import { clearInFlightForSpecialtyAsAdmin } from '@/lib/data/codes';
import { cancelMappingForSpecialty } from '@/lib/data/pipeline';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';

const Body = z.object({
  specialtySlug: z.string().min(1, 'specialtySlug required'),
});

export async function POST(req: NextRequest) {
  const guard = await requireArchitectResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;

  log('cancel-mapping').info(body);

  try {
    // Cancel the running mapping run(s) + reset the stage, then clear the
    // in-flight markers so the pulses vanish now rather than on the next poll.
    const { cancelled } = await cancelMappingForSpecialty(body.specialtySlug);
    await clearInFlightForSpecialtyAsAdmin(body.specialtySlug);

    revalidateTag(`pipeline:${body.specialtySlug}`, 'max');
    revalidateTag('specialty-phases', 'max');

    return NextResponse.json({ ok: true, cancelled });
  } catch (e) {
    log('cancel-mapping').error('cancel failed', e);
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
