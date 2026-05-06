import { type NextRequest, NextResponse } from 'next/server';
import { PB_AUTH_COOKIE } from '@/lib/pb/server';

/**
 * Clear the PocketBase auth cookie and bounce to /login. Browser-only —
 * PocketBase tokens are stateless on the server (no token blacklist), so a
 * client-side cookie deletion is sufficient.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL('/login', request.nextUrl.origin), {
    status: 303, // POST → GET on redirect
  });
  response.cookies.delete(PB_AUTH_COOKIE);
  return response;
}

// Allow GET for convenience (e.g. clicking a logout link).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL('/login', request.nextUrl.origin));
  response.cookies.delete(PB_AUTH_COOKIE);
  return response;
}
