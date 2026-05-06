/**
 * Connection test for a stored provider API key.
 *
 * POST /api/settings/test-key
 *   body: { provider: 'google' | 'anthropic' | 'openai' }
 *
 * Reads the requesting user's stored key via the PocketBase admin client
 * (server-side; the key never round-trips through the browser), pings the
 * provider with the cheapest model + a 1-token completion, and records
 * the outcome on the user's `userApiKeys` row.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireUserResponse } from '@/lib/auth';
import { getKeyForUserAsAdmin, markTestedForCurrentUser } from '@/lib/data/user-api-keys';

type Provider = 'google' | 'anthropic' | 'openai';

const PING_MODEL: Record<Provider, string> = {
  google: 'gemini-3-flash-preview',
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5.5',
};

function isProvider(v: unknown): v is Provider {
  return v === 'google' || v === 'anthropic' || v === 'openai';
}

export async function POST(req: NextRequest) {
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as { provider?: unknown };
  if (!isProvider(body.provider)) {
    return NextResponse.json(
      { ok: false, message: 'provider must be google, anthropic, or openai' },
      { status: 400 },
    );
  }
  const provider = body.provider;

  const user = await getCurrentUser();
  if (!user?._id) {
    return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  }
  const apiKey = await getKeyForUserAsAdmin({ userId: user._id, provider });
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: 'No key saved for this provider yet.' },
      { status: 400 },
    );
  }

  try {
    if (provider === 'google') {
      const google = createGoogleGenerativeAI({ apiKey });
      await generateText({
        model: google(PING_MODEL.google),
        prompt: 'ping',
      });
    } else if (provider === 'anthropic') {
      const anthropic = createAnthropic({ apiKey });
      await generateText({
        model: anthropic(PING_MODEL.anthropic),
        prompt: 'ping',
      });
    } else {
      const openai = createOpenAI({ apiKey });
      await generateText({
        model: openai(PING_MODEL.openai),
        prompt: 'ping',
      });
    }
    await markTestedForCurrentUser({ provider, status: 'ok' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markTestedForCurrentUser({ provider, status: 'failed' });
    return NextResponse.json({ ok: false, message }, { status: 200 });
  }
}
