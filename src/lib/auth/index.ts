import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/pb/server';

export type CurrentUser = {
  _id: string;
  email: string | null;
  name: string | null;
};

async function readAuthClient() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const pb = await readAuthClient();
  if (!pb.authStore.isValid) return null;
  const record = pb.authStore.record;
  if (!record) return null;
  return {
    _id: record.id,
    email: typeof record.email === 'string' ? record.email : null,
    name: typeof record.name === 'string' ? record.name : null,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const pb = await readAuthClient();
  return pb.authStore.isValid;
}

/**
 * Guard for API route handlers. The proxy at src/proxy.ts only redirects
 * unauthenticated GETs (POSTs need to fall through for the OAuth
 * handshake), so every mutating route MUST call this at the top of its
 * handler.
 *
 *   export async function POST(req: NextRequest) {
 *     const guard = await requireUserResponse();
 *     if (guard) return guard;
 *     // … handler
 *   }
 */
export async function requireUserResponse(): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
