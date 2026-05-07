'use client';

import PocketBase from 'pocketbase';

let _client: PocketBase | null = null;

/**
 * Browser-side singleton PocketBase client. Auth state lives on the
 * shared default authStore — sufficient because each browser tab has
 * one user. Server code MUST use createServerClient from ./server.ts
 * instead (per-request isolation).
 *
 * Reads NEXT_PUBLIC_POCKETBASE_URL from `process.env` directly rather than
 * going through the t3-env proxy. Next.js statically inlines
 * `process.env.NEXT_PUBLIC_*` references at build time, so this is safe
 * in client bundles; t3-env's proxy added a thin layer that surfaced
 * "Attempted to access a server-side environment variable on the client"
 * intermittently during dev hot-reloads.
 */
export function getBrowserClient(): PocketBase {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_POCKETBASE_URL is not set. Add it to .env.local and restart `npm run dev`.',
    );
  }
  _client = new PocketBase(url);
  return _client;
}
