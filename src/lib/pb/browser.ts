'use client';

import PocketBase from 'pocketbase';
import { env } from '@/env';

let _client: PocketBase | null = null;

/**
 * Browser-side singleton PocketBase client. Auth state lives on the
 * shared default authStore — sufficient because each browser tab has
 * one user. Server code MUST use createServerClient from ./server.ts
 * instead (per-request isolation).
 */
export function getBrowserClient(): PocketBase {
  if (_client) return _client;
  if (!env.NEXT_PUBLIC_POCKETBASE_URL) {
    throw new Error('NEXT_PUBLIC_POCKETBASE_URL is not set');
  }
  _client = new PocketBase(env.NEXT_PUBLIC_POCKETBASE_URL);
  return _client;
}
