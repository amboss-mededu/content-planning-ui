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
import { z } from 'zod';
import { requireUserResponse } from '@/lib/auth';
import {
  clearKeyForCurrentUser,
  type ProviderId,
  setKeyForCurrentUser,
} from '@/lib/data/user-api-keys';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';

const PostBody = z.object({
  provider: z.unknown().optional(),
  key: z.unknown().optional(),
});

const DeleteBody = z.object({
  provider: z.unknown().optional(),
});

function isProvider(v: unknown): v is ProviderId {
  return v === 'google' || v === 'anthropic' || v === 'openai';
}

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, PostBody);
  if (body instanceof NextResponse) return body;
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
    const message = errorMessage(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, DeleteBody);
  if (body instanceof NextResponse) return body;
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
    const message = errorMessage(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
