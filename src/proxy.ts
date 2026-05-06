import { type NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { env } from './env';
import { PB_AUTH_COOKIE } from './lib/pb/server';

// Paths that must remain reachable without an auth cookie.
const PUBLIC_PREFIXES = ['/login', '/auth/callback/', '/api/auth/login/'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export default function proxy(request: NextRequest): NextResponse | undefined {
  // Only gate page navigations (GETs). POSTs (Server Functions, OAuth
  // exchange, /api/auth/logout) need to fall through — every mutating
  // route does its own auth check via requireUserResponse().
  if (request.method !== 'GET') return;

  const { pathname, search } = request.nextUrl;
  const cookieHeader = request.headers.get('cookie') ?? '';

  // Local validity check — checks JWT exp without a network call.
  // PocketBase's authStore.isValid is sync.
  let isAuthenticated = false;
  if (cookieHeader && cookieHeader.length > 0) {
    const pb = new PocketBase(env.POCKETBASE_URL);
    pb.authStore.loadFromCookie(cookieHeader, PB_AUTH_COOKIE);
    isAuthenticated = pb.authStore.isValid;
  }

  if (isPublicPath(pathname)) {
    // Already signed in but heading back to /login → bounce home.
    if (pathname === '/login' && isAuthenticated) {
      return NextResponse.redirect(new URL('/', request.nextUrl.origin));
    }
    return; // let public routes through
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(pathname + search);
    return NextResponse.redirect(new URL(`/login?next=${next}`, request.nextUrl.origin));
  }

  return; // authenticated → continue
}

export const config = {
  // Run on every path except Next internals and static assets. Auth API
  // routes are intentionally INCLUDED so the public-path check above can
  // exempt them.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.[a-z0-9]+$).*)'],
};
