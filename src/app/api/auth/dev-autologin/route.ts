/**
 * Dev-only auto-login.
 *
 * GET /api/auth/dev-autologin?next=<path>
 *
 * Mints a 7-day PocketBase session for `DEV_AUTOLOGIN_EMAIL` (creating the
 * user if needed) and drops the auth cookie. Bypass for the OAuth flow when
 * Google credentials aren't provisioned yet.
 *
 * Refuses to run unless BOTH:
 *   1. `NODE_ENV === 'development'`, and
 *   2. `DEV_AUTOLOGIN_EMAIL` is set.
 *
 * Production deployments leave the env var unset, so this route 404s.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient, PB_AUTH_COOKIE } from '@/lib/pb/server';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function safeNextPath(input: string | null): string {
  if (!input) return '/';
  if (!input.startsWith('/') || input.startsWith('//')) return '/';
  return input;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (env.NODE_ENV !== 'development' || !env.DEV_AUTOLOGIN_EMAIL) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const email = env.DEV_AUTOLOGIN_EMAIL;
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));

  const admin = await createAdminClient();

  // Find or create the user. PB requires a password on `users` even when
  // the user signs in via OAuth; we set a long random one nobody will use.
  let userId: string;
  try {
    const existing = await admin
      .collection('users')
      .getFirstListItem(`email = "${email}"`);
    userId = existing.id;
  } catch {
    // Single UUID stays under PB's 71-char password ceiling (bcrypt limit).
    const randomPassword = crypto.randomUUID();
    const created = await admin.collection('users').create({
      email,
      password: randomPassword,
      passwordConfirm: randomPassword,
      name: email.split('@')[0],
      verified: true,
    });
    userId = created.id;
  }

  // Mint a session via the impersonate API. The returned client carries a
  // valid token + record on its authStore — exportToCookie produces the
  // exact cookie shape `loadFromCookie` expects.
  const impersonated = await admin
    .collection('users')
    .impersonate(userId, SESSION_TTL_SECONDS);

  const cookie = impersonated.authStore.exportToCookie(
    {
      httpOnly: true,
      secure: false, // dev mode only — local http
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    },
    PB_AUTH_COOKIE,
  );

  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
  response.headers.append('set-cookie', cookie);
  return response;
}
