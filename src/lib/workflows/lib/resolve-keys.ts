/**
 * Resolve provider API keys for a workflow run.
 *
 * Per-user keys (stored in Convex via the Settings page) take priority over
 * env-level fallbacks. Used by every API route that kicks off an LLM
 * workflow — they call this with the set of providers their run actually
 * needs, then pass the resulting `ProviderApiKeys` bag to the workflow
 * function.
 *
 * Why two Convex calls per resolve?
 * - `fetchQueryAsUser(users.getCurrentUser)` derives the userId from the
 *   request's auth JWT (proves who the caller is).
 * - `fetchQuery(apiKeys.getKeyForUserService, { _secret })` then reads the
 *   raw key string. This second call uses `requireService` so it ONLY
 *   accepts requests that present `WORKFLOW_SECRET` — the browser can't
 *   obtain that env var, so even an XSS payload using the user's JWT
 *   can't reach the key string. Without this split a `query` would be
 *   callable from any authenticated client.
 */

import { fetchQuery } from 'convex/nextjs';
import { env } from '@/env';
import { getCurrentUser } from '@/lib/auth';
import { api } from '../../../../convex/_generated/api';
import type { ProviderApiKeys, ProviderId } from './llm';

const ENV_BY_PROVIDER: Record<ProviderId, string | undefined> = {
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
};

export async function resolveApiKeysForRun(
  providers: readonly ProviderId[],
): Promise<ProviderApiKeys> {
  const result: ProviderApiKeys = {};

  // Identify the caller via the PocketBase cookie (proxy gates the route, so
  // we only get here authenticated; defensive null-check anyway). The
  // remaining api.apiKeys.getKeyForUserService call below still hits the
  // wiped Convex DB and will return null — userApiKeys port lands in PR 5.
  const user = await getCurrentUser();
  const userId = user?._id ?? null;

  if (!env.WORKFLOW_SECRET || !userId) {
    // No service secret configured (local dev) or no user — env fallback
    // only. Per-user keys can't be read without the secret by design.
    for (const p of providers) {
      const fallback = ENV_BY_PROVIDER[p];
      if (fallback) result[p] = fallback;
    }
    return result;
  }

  const lookups = await Promise.all(
    providers.map(async (p) => {
      const userKey = await fetchQuery(api.apiKeys.getKeyForUserService, {
        userId,
        provider: p,
        _secret: env.WORKFLOW_SECRET,
      });
      return [p, userKey] as const;
    }),
  );
  for (const [p, userKey] of lookups) {
    const fallback = ENV_BY_PROVIDER[p];
    const resolved = userKey ?? fallback;
    if (resolved) result[p] = resolved;
  }
  return result;
}
