/**
 * Shared bearer-token guard for the n8n callback endpoints
 * (draft-article/callback, literature-search/callback). Both checked the same
 * `N8N_CALLBACK_SECRET` against the `Authorization: Bearer <secret>` header with
 * identical 503/401 responses — this collapses that preamble.
 *
 * Returns a NextResponse to early-return on failure, or null when authorized:
 *   const denied = requireCallbackAuth(req);
 *   if (denied) return denied;
 */

import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';

export function requireCallbackAuth(req: NextRequest): NextResponse | null {
  const secret = env.N8N_CALLBACK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'callback secret not configured' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
