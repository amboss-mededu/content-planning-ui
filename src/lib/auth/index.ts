import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cache } from 'react';
import { getArticleBacklogAssignee } from '@/lib/data/article-backlog';
import { createServerClient } from '@/lib/pb/server';
import { normalizeRole, type UserRole } from './roles';

export type CurrentUser = {
  _id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
};

async function readAuthClient() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Loads the current user with SERVER-SIDE validation — the source of truth for
 * every authorization decision in this app.
 *
 * Why not just read `pb.authStore.record`: PocketBase's `authStore.isValid`
 * only base64-decodes the JWT and checks `exp` locally. It does NOT verify the
 * token signature, and the record blob in the `pb_auth` cookie is NOT bound to
 * the signed token — so an authenticated user can edit `role`/`email` (or fake
 * a whole record) in their own cookie and, because privileged writes run via
 * the admin client, defeat every guard that trusts the cookie. `authRefresh()`
 * sends the token to PocketBase, which verifies it and returns the authoritative
 * record from the DB; we read role/email from THAT, never the raw cookie.
 *
 * `cache()` dedupes the round-trip to one call per request.
 */
const loadValidatedUser = cache(async (): Promise<CurrentUser | null> => {
  const pb = await readAuthClient();
  // Cheap reject of missing/expired tokens — avoids a network round-trip.
  if (!pb.authStore.isValid) return null;
  try {
    // Verifies the token server-side and refreshes authStore.record from the DB.
    // Throws on a forged/invalid/revoked token → treated as signed-out.
    await pb.collection('users').authRefresh();
  } catch {
    return null;
  }
  const record = pb.authStore.record;
  if (!record) return null;
  return {
    _id: record.id,
    email: typeof record.email === 'string' ? record.email : null,
    name: typeof record.name === 'string' ? record.name : null,
    role: normalizeRole(record.role),
  };
});

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return loadValidatedUser();
}

export async function isAuthenticated(): Promise<boolean> {
  return (await loadValidatedUser()) !== null;
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

/**
 * Guard for API route handlers that only content architects may call (running
 * mappings/pipelines, approving articles into the backlog, reassigning, etc.).
 * Returns 401 when signed out, 403 when signed in as an editor, null when the
 * caller is an architect. This — not the proxy or nav — is the real security
 * boundary: `getCurrentUser` validates the token and reads the role from the
 * authoritative DB record (see loadValidatedUser), so a forged or stale cookie
 * role can't bypass it.
 *
 *   export async function POST(req: NextRequest) {
 *     const guard = await requireArchitectResponse();
 *     if (guard) return guard;
 *     // … architect-only handler
 *   }
 */
export async function requireArchitectResponse(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role !== 'architect') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * Guard for Server Actions, which throw rather than returning a Response.
 * Throws when the caller is not a content architect; returns the user otherwise.
 * Call at the top of every architect-only action.
 */
export async function assertArchitect(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in.');
  if (user.role !== 'architect') {
    throw new Error('Only content architects can perform this action.');
  }
  return user;
}

/**
 * Guard for Server Actions that operate on a single backlog article (sourcing,
 * drafting, status). Architects may act on any article; editors only on rows
 * assigned to them. Throws otherwise; returns the user on success.
 *
 * This is the assignee boundary: My Backlog only shows an editor their own
 * rows, but a hand-crafted request could target someone else's — so the check
 * re-reads the row's assignee server-side rather than trusting the client.
 */
export async function assertCanWorkArticle(
  slug: string,
  articleKey: string,
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in.');
  if (user.role === 'architect') return user;
  const assignee = await getArticleBacklogAssignee(slug, articleKey);
  if (!assignee || !user.email || assignee !== user.email) {
    throw new Error('You can only work on articles assigned to you.');
  }
  return user;
}

/**
 * Route-handler form of {@link assertCanWorkArticle}: 401 when signed out,
 * 403 when an editor targets an article not assigned to them, null when allowed.
 */
export async function requireArticleAssigneeResponse(
  slug: string,
  articleKey: string,
): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.role === 'architect') return null;
  const assignee = await getArticleBacklogAssignee(slug, articleKey);
  if (!assignee || !user.email || assignee !== user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}
