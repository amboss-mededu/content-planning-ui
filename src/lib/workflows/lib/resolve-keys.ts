/**
 * Resolve provider API keys for a workflow run.
 *
 * Per-user keys (stored in PocketBase via the Settings page) take priority
 * over env-level fallbacks. Used by every API route that kicks off an LLM
 * workflow — they call this with the set of providers their run actually
 * needs, then pass the resulting `ProviderApiKeys` bag to the workflow
 * function.
 *
 * The key string is loaded via `getKeyForUserAsAdmin`, which goes through
 * the PocketBase admin client. The browser cannot reach the admin
 * credentials, so the key never round-trips to the client. The user's
 * identity comes from the request's PocketBase auth cookie.
 */

import { env } from '@/env';
import { getCurrentUser } from '@/lib/auth';
import { getKeyForUserAsAdmin } from '@/lib/data/user-api-keys';
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

  const user = await getCurrentUser();
  const userId = user?._id ?? null;

  if (!userId) {
    // No signed-in user (e.g. invoked from a script in dev) — env fallback only.
    for (const p of providers) {
      const fallback = ENV_BY_PROVIDER[p];
      if (fallback) result[p] = fallback;
    }
    return result;
  }

  const lookups = await Promise.all(
    providers.map(async (p) => {
      const userKey = await getKeyForUserAsAdmin({ userId, provider: p });
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
