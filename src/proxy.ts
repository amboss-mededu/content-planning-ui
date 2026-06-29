import { type NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { env } from './env';
import { normalizeRole } from './lib/auth/roles';
import { PB_AUTH_COOKIE } from './lib/pb/server';

// Paths that must remain reachable without an auth cookie.
const PUBLIC_PREFIXES = [
  '/login',
  '/auth/callback/',
  '/api/auth/login/',
  '/api/auth/dev-autologin',
];

// Pages/APIs an EDITOR (non-architect) may reach. Everything else is hidden
// from them and redirects to /my-backlog. Server Actions (POST) fall through
// to per-action assertArchitect() guards, and the My Backlog realtime feed is a
// direct WebSocket to PocketBase, so only GET pages + the settings status GET
// need listing here. `/login`, `/auth/*`, `/api/auth/*` are already public above.
const EDITOR_HOME = '/my-backlog';
const EDITOR_ALLOWED_PREFIXES = ['/my-backlog', '/settings', '/api/settings/'];

const DEV_AUTOLOGIN_ENABLED =
  env.NODE_ENV === 'development' && Boolean(env.DEV_AUTOLOGIN_EMAIL);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isEditorAllowedPath(pathname: string): boolean {
  return EDITOR_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p),
  );
}

export default function proxy(request: NextRequest): NextResponse | undefined {
  // Only gate page navigations (GETs). POSTs (Server Functions, OAuth
  // exchange, /api/auth/logout) need to fall through — every mutating
  // route does its own auth check via requireUserResponse().
  if (request.method !== 'GET') return;

  const { pathname, search } = request.nextUrl;
  const cookieHeader = request.headers.get('cookie') ?? '';

  // Local validity check — checks JWT exp without a network call.
  // PocketBase's authStore.isValid is sync. The pb_auth cookie also carries the
  // serialized user record, so we can read `role` here without a network call.
  let isAuthenticated = false;
  let role: 'editor' | 'architect' = 'editor';
  if (cookieHeader && cookieHeader.length > 0) {
    const pb = new PocketBase(env.POCKETBASE_URL);
    pb.authStore.loadFromCookie(cookieHeader, PB_AUTH_COOKIE);
    isAuthenticated = pb.authStore.isValid;
    role = normalizeRole(pb.authStore.record?.role);
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
    const target = DEV_AUTOLOGIN_ENABLED
      ? `/api/auth/dev-autologin?next=${next}`
      : `/login?next=${next}`;
    return NextResponse.redirect(new URL(target, request.nextUrl.origin));
  }

  // Editors only get My Backlog + Settings; everything else bounces to their
  // backlog. This is UX gating (the live cookie role may lag a role change);
  // the real boundary is assertArchitect() on each privileged action/route.
  if (role === 'editor' && !isEditorAllowedPath(pathname)) {
    return NextResponse.redirect(new URL(EDITOR_HOME, request.nextUrl.origin));
  }

  return; // authenticated → continue
}

export const config = {
  // Run on every path except Next internals and static assets. Auth API
  // routes are intentionally INCLUDED so the public-path check above can
  // exempt them.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.[a-z0-9]+$).*)'],
};
