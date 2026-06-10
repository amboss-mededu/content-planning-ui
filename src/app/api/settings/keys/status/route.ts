/**
 * Per-provider status snapshot for the Settings page.
 *
 * GET /api/settings/keys/status
 *   → { google: { configured, testedAt, status }, anthropic: ..., openai: ... }
 *
 * The Settings page client component fetches this on mount and after each
 * Save / Clear / Test action. PocketBase real-time subscriptions could
 * cover this too, but the page is rarely open and the polling shape is
 * simpler — no WebSocket lifecycle to manage on a one-off page.
 */

import { NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { getStatusForCurrentUser } from '@/lib/data/user-api-keys';
import { errorMessage } from '@/lib/error-message';

export async function GET() {
  const guard = await requireUserResponse();
  if (guard) return guard;
  try {
    const status = await getStatusForCurrentUser();
    return NextResponse.json(status);
  } catch (e) {
    const message = errorMessage(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
