/**
 * Per-user provider API key store.
 *
 * Storage: one `userApiKeys` row per signed-in user. Each provider
 * (google, anthropic, openai) has three associated fields:
 *
 *   <provider>ApiKey      — the secret string
 *   <provider>TestedAt    — ms-epoch of the last connection test
 *   <provider>TestStatus  — 'ok' | 'failed' from the last test
 *
 * Two read paths:
 * - `getStatusForCurrentUser` returns presence flags + test telemetry only
 *   (cookie-authed, never returns the raw key string). Powers the Settings
 *   page UI.
 * - `getKeyForUserAsAdmin` returns the raw key string for a user — only
 *   callable from server-side code via the admin client (workflow callers
 *   and the test-key route handler). The browser cannot reach the admin
 *   credentials, so the key string never round-trips to the client.
 */

import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ApiKeyTestStatus, UserApiKeyRecord } from '@/lib/pb/types';

export type ProviderId = 'google' | 'anthropic' | 'openai';

const KEY_FIELD = {
  google: 'googleApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
} as const satisfies Record<ProviderId, keyof UserApiKeyRecord>;

const TESTED_AT_FIELD = {
  google: 'googleTestedAt',
  anthropic: 'anthropicTestedAt',
  openai: 'openaiTestedAt',
} as const satisfies Record<ProviderId, keyof UserApiKeyRecord>;

const TEST_STATUS_FIELD = {
  google: 'googleTestStatus',
  anthropic: 'anthropicTestStatus',
  openai: 'openaiTestStatus',
} as const satisfies Record<ProviderId, keyof UserApiKeyRecord>;

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

async function getUserRow(
  pb: PocketBase,
  userId: string,
): Promise<UserApiKeyRecord | null> {
  try {
    return await pb
      .collection<UserApiKeyRecord>('userApiKeys')
      .getFirstListItem(pb.filter('userId = {:userId}', { userId }));
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user?._id) throw new Error('Unauthorized');
  return user._id;
}

export type ProviderStatus = {
  configured: boolean;
  testedAt: number | null;
  status: ApiKeyTestStatus | null;
};

export type AllProviderStatus = Record<ProviderId, ProviderStatus>;

/**
 * Status snapshot for the Settings page. Returns one entry per provider with
 * presence + test telemetry, never the key value itself. Cookie-authed.
 */
export async function getStatusForCurrentUser(): Promise<AllProviderStatus> {
  await connection();
  const userId = await requireUserId();
  const pb = await userClient();
  const row = await getUserRow(pb, userId);
  return {
    google: {
      configured: Boolean(row?.googleApiKey),
      testedAt: row?.googleTestedAt ?? null,
      status: row?.googleTestStatus ?? null,
    },
    anthropic: {
      configured: Boolean(row?.anthropicApiKey),
      testedAt: row?.anthropicTestedAt ?? null,
      status: row?.anthropicTestStatus ?? null,
    },
    openai: {
      configured: Boolean(row?.openaiApiKey),
      testedAt: row?.openaiTestedAt ?? null,
      status: row?.openaiTestStatus ?? null,
    },
  };
}

/**
 * Upsert a provider key for the current user. Resets the per-key tested-at /
 * status fields so the Settings UI shows the new key as "Saved · not tested
 * yet" until the user clicks Test.
 */
export async function setKeyForCurrentUser(args: {
  provider: ProviderId;
  key: string;
}): Promise<void> {
  const userId = await requireUserId();
  const trimmed = args.key.trim();
  if (trimmed.length === 0) throw new Error('Key cannot be empty');
  const pb = await userClient();
  const existing = await getUserRow(pb, userId);
  const now = Date.now();
  const patch: Record<string, unknown> = {
    [KEY_FIELD[args.provider]]: trimmed,
    [TESTED_AT_FIELD[args.provider]]: null,
    [TEST_STATUS_FIELD[args.provider]]: null,
    updatedAt: now,
  };
  if (existing) {
    await pb.collection('userApiKeys').update(existing.id, patch);
  } else {
    await pb.collection('userApiKeys').create({ userId, updatedAt: now, ...patch });
  }
}

/**
 * Clear one provider's key (and its test telemetry). Other providers'
 * keys on the same row are untouched.
 */
export async function clearKeyForCurrentUser(provider: ProviderId): Promise<void> {
  const userId = await requireUserId();
  const pb = await userClient();
  const existing = await getUserRow(pb, userId);
  if (!existing) return;
  await pb.collection('userApiKeys').update(existing.id, {
    [KEY_FIELD[provider]]: null,
    [TESTED_AT_FIELD[provider]]: null,
    [TEST_STATUS_FIELD[provider]]: null,
    updatedAt: Date.now(),
  });
}

/**
 * Record the outcome of a connection test. Called by /api/settings/test-key
 * after it pings the provider with the user's stored key.
 */
export async function markTestedForCurrentUser(args: {
  provider: ProviderId;
  status: ApiKeyTestStatus;
}): Promise<void> {
  const userId = await requireUserId();
  const pb = await userClient();
  const existing = await getUserRow(pb, userId);
  if (!existing) throw new Error('No API key configured');
  await pb.collection('userApiKeys').update(existing.id, {
    [TESTED_AT_FIELD[args.provider]]: Date.now(),
    [TEST_STATUS_FIELD[args.provider]]: args.status,
    updatedAt: Date.now(),
  });
}

/**
 * Server-only raw-key fetch. Used by the workflow path (`resolve-keys`) and
 * the test-key route handler. Browser code cannot reach this — it goes
 * through the admin client. Returns `null` when the user hasn't configured
 * a key for the requested provider.
 */
export async function getKeyForUserAsAdmin(args: {
  userId: string;
  provider: ProviderId;
}): Promise<string | null> {
  const pb = await createAdminClient();
  const row = await getUserRow(pb, args.userId);
  if (!row) return null;
  const value = row[KEY_FIELD[args.provider]];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
