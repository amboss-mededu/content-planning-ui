import { type NextRequest, NextResponse } from 'next/server';
import PocketBase, { ClientResponseError } from 'pocketbase';
import { env } from '@/env';
import { createAdminClient, PB_AUTH_COOKIE } from '@/lib/pb/server';

// DEV TOOLING — bypass Google OAuth for local development. Returns 404 in
// production. Hit this with `{ email, password }`; we'll auto-create the
// user via the admin SDK on first call so there's no admin-UI fiddling.
// Remove this whole route in the final cleanup PR.
//
// Domain restriction (@amboss.com / @medicuja.com / @miamed.de) is NOT
// enforced here — pb_hooks/main.pb.js only fires on the OAuth code path.
// This route is gated by NODE_ENV which is enough; non-staff can't reach
// the dev server in the first place.

const PB_AUTH_TTL_SECONDS = 60 * 60 * 24 * 30;

function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404 });
}

function safeNextPath(input: string | null | undefined): string {
  if (!input) return '/';
  if (!input.startsWith('/') || input.startsWith('//')) return '/';
  return input;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') return notFound();

  const form = await request.formData().catch(() => null);
  const body = form
    ? {
        email: String(form.get('email') ?? '')
          .trim()
          .toLowerCase(),
        password: String(form.get('password') ?? ''),
        next: safeNextPath(String(form.get('next') ?? '/')),
      }
    : null;

  if (!body?.email || !body.password) {
    return NextResponse.json(
      { error: 'email and password are required' },
      { status: 400 },
    );
  }

  // Auto-create the user on first sign-in so there's no admin-UI step.
  // Requires admin creds — without them, fall back to a plain auth attempt
  // and surface a clearer error message.
  if (env.POCKETBASE_ADMIN_EMAIL && env.POCKETBASE_ADMIN_PASSWORD) {
    try {
      const admin = await createAdminClient();
      try {
        await admin.collection('users').getFirstListItem(`email = "${body.email}"`);
      } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) {
          await admin.collection('users').create({
            email: body.email,
            password: body.password,
            passwordConfirm: body.password,
            verified: true,
            name: body.email.split('@')[0] ?? body.email,
          });
        } else {
          throw err;
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'admin auth failed';
      return NextResponse.json(
        { error: `Could not provision dev user: ${reason}` },
        { status: 500 },
      );
    }
  }

  const pb = new PocketBase(env.POCKETBASE_URL);
  try {
    await pb.collection('users').authWithPassword(body.email, body.password);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'sign-in failed';
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  if (!pb.authStore.isValid) {
    return NextResponse.json(
      { error: 'PocketBase did not return a token' },
      { status: 500 },
    );
  }

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

  const response = NextResponse.redirect(new URL(body.next, request.nextUrl.origin), {
    status: 303,
  });
  response.headers.append('set-cookie', setCookieHeader);
  return response;
}
