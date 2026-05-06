import 'server-only';

import PocketBase from 'pocketbase';
import { env } from '@/env';

export const PB_AUTH_COOKIE = 'pb_auth';

/**
 * Build a fresh PocketBase client for one request, hydrated from the
 * incoming Cookie header. Always create per-request (never share across
 * requests) so each user's auth state stays isolated in concurrent
 * Server-Component renders.
 */
export function createServerClient(cookieHeader?: string | null): PocketBase {
  const pb = new PocketBase(env.POCKETBASE_URL);
  if (cookieHeader && cookieHeader.length > 0) {
    pb.authStore.loadFromCookie(cookieHeader, PB_AUTH_COOKIE);
  }
  return pb;
}

/**
 * Build an admin-authenticated PocketBase client. Server-only. Used by
 * scripts and server routes that need to read/write across user
 * boundaries (seed scripts, OAuth provider config, etc.). Caller is
 * responsible for not exposing the resulting client to browser code.
 */
export async function createAdminClient(): Promise<PocketBase> {
  const pb = new PocketBase(env.POCKETBASE_URL);
  if (!env.POCKETBASE_ADMIN_EMAIL || !env.POCKETBASE_ADMIN_PASSWORD) {
    throw new Error(
      'createAdminClient requires POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD',
    );
  }
  await pb
    .collection('_superusers')
    .authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
  return pb;
}
