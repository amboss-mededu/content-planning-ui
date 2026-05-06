import { type NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { env } from '@/env';

export const OAUTH_STATE_COOKIE = 'pb_oauth_state_google';
const OAUTH_STATE_TTL_SECONDS = 5 * 60;

function safeNextPath(input: string | null): string {
  if (!input) return '/';
  // Only accept site-relative paths to defeat open-redirect attempts.
  if (!input.startsWith('/') || input.startsWith('//')) return '/';
  return input;
}

/**
 * Begin Google OAuth: ask PocketBase for a fresh state + PKCE verifier,
 * stash them in a short-lived HttpOnly cookie, and redirect the user to
 * Google's consent screen. The callback at /auth/callback/google will
 * complete the exchange.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  const pb = new PocketBase(env.POCKETBASE_URL);

  const authMethods = await pb.collection('users').listAuthMethods();
  const oauth2 = (authMethods as unknown as { oauth2?: { providers?: unknown[] } })
    .oauth2;
  const providers = (oauth2?.providers ?? []) as Array<{
    name: string;
    state: string;
    codeVerifier: string;
    authURL: string;
  }>;
  const google = providers.find((p) => p.name === 'google');
  if (!google) {
    return NextResponse.json(
      {
        error:
          'Google OAuth is not enabled on this PocketBase instance. Run `npm run configure-oauth`.',
      },
      { status: 503 },
    );
  }

  const redirectUri = new URL('/auth/callback/google', request.nextUrl.origin).toString();
  const authorizeUrl = `${google.authURL}${encodeURIComponent(redirectUri)}`;

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: JSON.stringify({
      state: google.state,
      codeVerifier: google.codeVerifier,
      next,
      redirectUri,
    }),
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return response;
}
