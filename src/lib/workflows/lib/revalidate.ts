/**
 * Workflow-side cache invalidation.
 *
 * Step function that POSTs to `/api/internal/revalidate` so the workflow can
 * bust Next.js cache tags after mutating DB state (e.g. after promoting
 * extracted codes into the canonical `codes` table). Workflows can't call
 * `revalidateTag` directly — it's a Next.js cache API unavailable in the
 * workflow sandbox.
 */

function baseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return 'http://localhost:3000';
}

export async function revalidateSpecialtyCache(slug: string): Promise<void> {
  const tags = [
    `codes:${slug}`,
    `specialty:${slug}`,
    `pipeline:${slug}`,
    'specialty-phases',
    'specialties',
  ];
  console.log('[pipeline] revalidateSpecialtyCache', { slug, tags });
  try {
    const res = await fetch(`${baseUrl()}/api/internal/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tags,
        secret: process.env.INTERNAL_REVALIDATE_SECRET,
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      console.warn('[pipeline] revalidateSpecialtyCache non-OK', res.status, msg);
    }
  } catch (e) {
    // Never fail the workflow just because revalidation failed — the UI will
    // still see fresh data once the cache tags naturally expire.
    console.warn('[pipeline] revalidateSpecialtyCache threw', e);
  }
}
