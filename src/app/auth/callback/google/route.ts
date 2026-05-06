import { type NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { env } from '@/env';
import { PB_AUTH_COOKIE } from '@/lib/pb/server';
import { OAUTH_STATE_COOKIE } from '../../../api/auth/login/google/route';

const PB_AUTH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days; matches PB token TTL

function failureRedirect(request: NextRequest, message: string): NextResponse {
  const url = new URL('/login', request.nextUrl.origin);
  url.searchParams.set('error', message);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

/**
 * Complete the Google OAuth flow: validate the state cookie, exchange the
 * authorization code with PocketBase, set the auth cookie, and bounce the
 * user to their original destination.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  const stateParam = request.nextUrl.searchParams.get('state');
  const errorParam = request.nextUrl.searchParams.get('error');
  if (errorParam) {
    return failureRedirect(request, `Google sign-in failed: ${errorParam}`);
  }
  if (!code || !stateParam) {
    return failureRedirect(request, 'Missing OAuth code or state');
  }

  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!stateCookie) {
    return failureRedirect(request, 'OAuth session expired — please try again');
  }
  let stored: { state: string; codeVerifier: string; next: string; redirectUri: string };
  try {
    stored = JSON.parse(stateCookie);
  } catch {
    return failureRedirect(request, 'Corrupted OAuth state — please try again');
  }
  if (stored.state !== stateParam) {
    return failureRedirect(request, 'OAuth state mismatch — possible CSRF');
  }

  const pb = new PocketBase(env.POCKETBASE_URL);

  try {
    await pb
      .collection('users')
      .authWithOAuth2Code('google', code, stored.codeVerifier, stored.redirectUri);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown error';
    return failureRedirect(request, reason);
  }

  if (!pb.authStore.isValid) {
    return failureRedirect(request, 'PocketBase did not return a valid auth token');
  }

  // Hand the resulting auth token to the browser as an HttpOnly cookie that
  // src/proxy.ts and src/lib/pb/server.ts will pick up.
  const setCookieHeader = pb.authStore.exportToCookie(
    {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: PB_AUTH_TTL_SECONDS,
    },
    PB_AUTH_COOKIE,
  );

  const dest = new URL(stored.next || '/', request.nextUrl.origin);
  const response = NextResponse.redirect(dest);
  response.headers.append('set-cookie', setCookieHeader);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
