/**
 * Per-user provider API key store.
 *
 * Storage layout: one `userApiKeys` row per signed-in user. Each provider
 * (google, anthropic, openai) has three associated fields:
 *
 *   <provider>ApiKey      — the secret string
 *   <provider>TestedAt    — ms-epoch of the last connection test
 *   <provider>TestStatus  — 'ok' | 'failed' from the last test
 *
 * Two read paths:
 * - `getStatusForCurrentUser` returns presence flags + test telemetry only.
 *   It's a normal user-auth query — anything callable with the user's JWT
 *   can hit it. The raw key string is never returned here.
 * - `getKeyForUserService` returns the raw key string but only for callers
 *   that present `WORKFLOW_SECRET`. The browser cannot obtain the secret,
 *   so even an XSS payload running with the user's JWT cannot pull keys
 *   out of this query. The Next.js API route handlers (server-side, with
 *   `env.WORKFLOW_SECRET` in scope) are the only legitimate callers.
 */

import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireService, serviceSecretArg } from './_lib/access';
import { auth } from './auth';

const providerArg = v.union(
  v.literal('google'),
  v.literal('anthropic'),
  v.literal('openai'),
);

type Provider = 'google' | 'anthropic' | 'openai';

type Row = {
  googleApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleTestedAt?: number;
  googleTestStatus?: 'ok' | 'failed';
  anthropicTestedAt?: number;
  anthropicTestStatus?: 'ok' | 'failed';
  openaiTestedAt?: number;
  openaiTestStatus?: 'ok' | 'failed';
};

const KEY_FIELD = {
  google: 'googleApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
} as const;

const TESTED_AT_FIELD = {
  google: 'googleTestedAt',
  anthropic: 'anthropicTestedAt',
  openai: 'openaiTestedAt',
} as const;

const TEST_STATUS_FIELD = {
  google: 'googleTestStatus',
  anthropic: 'anthropicTestStatus',
  openai: 'openaiTestStatus',
} as const;

/**
 * Status snapshot for the Settings page. Returns one entry per provider with
 * presence + test telemetry, never the key value itself.
 */
export const getStatusForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new ConvexError('Unauthorized');
    const row = (await ctx.db
      .query('userApiKeys')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()) as Row | null;
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
  },
});

/**
 * Server-only raw-key fetch.
 *
 * Even though Convex `query` is technically callable from any authenticated
 * client, this function refuses every request that doesn't include the
 * shared `WORKFLOW_SECRET` — only the Next.js API route handlers (running
 * server-side, with the env var in scope) can invoke it. The browser cannot
 * obtain the secret, so an XSS payload using the user's JWT can't pull keys
 * out of this query.
 *
 * Callers must resolve `userId` separately (e.g. via
 * `fetchQueryAsUser(api.users.getCurrentUser)`) and pass it in alongside
 * the secret. Returns `null` when the user hasn't configured a key for
 * the requested provider.
 */
export const getKeyForUserService = query({
  args: {
    userId: v.string(),
    provider: providerArg,
    _secret: serviceSecretArg,
  },
  handler: async (ctx, { userId, provider, _secret }) => {
    await requireService(_secret);
    const row = (await ctx.db
      .query('userApiKeys')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()) as Row | null;
    if (!row) return null;
    const value = row[KEY_FIELD[provider as Provider]];
    return typeof value === 'string' && value.length > 0 ? value : null;
  },
});

/**
 * Upsert a provider key for the current user. Resets the per-key tested-at /
 * status fields so the Settings UI shows the new key as "Saved · not tested
 * yet" until the user clicks Test.
 */
export const setKeyForCurrentUser = mutation({
  args: { provider: providerArg, key: v.string() },
  handler: async (ctx, { provider, key }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new ConvexError('Unauthorized');
    const trimmed = key.trim();
    if (trimmed.length === 0) throw new ConvexError('Key cannot be empty');
    const existing = await ctx.db
      .query('userApiKeys')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    const now = Date.now();
    const patch = {
      [KEY_FIELD[provider as Provider]]: trimmed,
      [TESTED_AT_FIELD[provider as Provider]]: undefined,
      [TEST_STATUS_FIELD[provider as Provider]]: undefined,
      updatedAt: now,
    } as Record<string, unknown>;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('userApiKeys', { userId, updatedAt: now, ...patch });
    }
  },
});

/**
 * Clear one provider's key (and its test telemetry). Other providers'
 * keys on the same row are untouched.
 */
export const clearKeyForCurrentUser = mutation({
  args: { provider: providerArg },
  handler: async (ctx, { provider }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new ConvexError('Unauthorized');
    const existing = await ctx.db
      .query('userApiKeys')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      [KEY_FIELD[provider as Provider]]: undefined,
      [TESTED_AT_FIELD[provider as Provider]]: undefined,
      [TEST_STATUS_FIELD[provider as Provider]]: undefined,
      updatedAt: Date.now(),
    } as Record<string, unknown>);
  },
});

/**
 * Record the outcome of a connection test. Called by /api/settings/test-key
 * after it pings the provider with the user's stored key.
 */
export const markTestedForCurrentUser = mutation({
  args: {
    provider: providerArg,
    status: v.union(v.literal('ok'), v.literal('failed')),
  },
  handler: async (ctx, { provider, status }) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new ConvexError('Unauthorized');
    const existing = await ctx.db
      .query('userApiKeys')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!existing) throw new ConvexError('No API key configured');
    await ctx.db.patch(existing._id, {
      [TESTED_AT_FIELD[provider as Provider]]: Date.now(),
      [TEST_STATUS_FIELD[provider as Provider]]: status,
      updatedAt: Date.now(),
    } as Record<string, unknown>);
  },
});
