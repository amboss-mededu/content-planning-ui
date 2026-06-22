import { NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { listInFlightCodes } from '@/lib/data/codes';

/**
 * The codes currently being (re)mapped for a specialty. Polled by the mapping
 * view to drive the "Mapping…" badge and its live-refresh loop — the
 * cookie-authed read works regardless of PocketBase realtime, which the
 * anonymous browser client can't receive.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ specialty: string }> },
) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const { specialty } = await params;
  const slug = decodeURIComponent(specialty);
  const codes = await listInFlightCodes(slug);
  return NextResponse.json({ codes });
}
