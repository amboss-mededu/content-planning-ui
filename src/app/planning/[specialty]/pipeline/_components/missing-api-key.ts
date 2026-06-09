import type { ProviderId } from '@/lib/workflows/lib/llm';

const PROVIDERS: ReadonlySet<string> = new Set([
  'google',
  'anthropic',
  'openai',
] satisfies ProviderId[]);

/** Returns the provider when a workflow route 409s with MISSING_API_KEY
 *  (the caller should open `MissingKeyModal` for it), else null. */
export function missingApiKeyProvider(status: number, body: unknown): ProviderId | null {
  if (status !== 409 || typeof body !== 'object' || body === null) return null;
  const b = body as { code?: unknown; provider?: unknown };
  if (b.code !== 'MISSING_API_KEY') return null;
  return typeof b.provider === 'string' && PROVIDERS.has(b.provider)
    ? (b.provider as ProviderId)
    : null;
}
