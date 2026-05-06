/**
 * Provider API key management.
 *
 * POST   /api/settings/keys  body: { provider, key }   — upsert key
 * DELETE /api/settings/keys  body: { provider }        — clear key
 *
 * The browser cannot mutate the `userApiKeys` collection directly via the
 * PocketBase JS SDK because we want a single chokepoint where field
 * normalisation (test telemetry reset) lives. These two route handlers are
 * that chokepoint.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import {
  clearKeyForCurrentUser,
  type ProviderId,
  setKeyForCurrentUser,
} from '@/lib/data/user-api-keys';

function isProvider(v: unknown): v is ProviderId {
  return v === 'google' || v === 'anthropic' || v === 'openai';
}

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as {
    provider?: unknown;
    key?: unknown;
  };
  if (!isProvider(body.provider)) {
    return NextResponse.json(
      { error: 'provider must be google, anthropic, or openai' },
      { status: 400 },
    );
  }
  if (typeof body.key !== 'string' || body.key.trim().length === 0) {
    return NextResponse.json({ error: 'key required' }, { status: 400 });
  }
  try {
    await setKeyForCurrentUser({ provider: body.provider, key: body.key });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as { provider?: unknown };
  if (!isProvider(body.provider)) {
    return NextResponse.json(
      { error: 'provider must be google, anthropic, or openai' },
      { status: 400 },
    );
  }
  try {
    await clearKeyForCurrentUser(body.provider);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
