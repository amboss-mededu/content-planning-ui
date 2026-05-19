'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

type Options = {
  /** Show window.confirm before firing. Defaults to true. */
  confirm?: boolean;
  /** Forward chainSecondaries to the workflow route. Defaults to true. */
  chainSecondaries?: boolean;
};

/**
 * Trigger a per-category consolidation re-run via the workflow route, with
 * an in-flight set keyed by category, last-error state, and a router
 * refresh on success. Used from both the consolidation review screen and
 * the Category modal so they share approval/refresh behavior.
 *
 * The in-flight set is held in a ref (not state) to avoid the stale-closure
 * trap when consecutive clicks land before the previous mutation flushes.
 */
export function useConsolidationRerun(slug: string) {
  const router = useRouter();
  const inFlight = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const bump = useCallback(() => forceRender((n) => n + 1), []);

  const rerun = useCallback(
    async (category: string, options?: Options) => {
      const { confirm = true, chainSecondaries = true } = options ?? {};
      if (inFlight.current.has(category)) return;
      if (
        confirm &&
        typeof window !== 'undefined' &&
        !window.confirm(
          `Re-run consolidation for "${category}"? This will erase the current consolidation output for this category.`,
        )
      ) {
        return;
      }
      setError(null);
      inFlight.current.add(category);
      bump();
      try {
        const res = await fetch('/api/workflows/consolidate-primary', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            specialtySlug: slug,
            categories: [category],
            chainSecondaries,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(
            body.error ?? `HTTP ${res.status} starting consolidation for ${category}`,
          );
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current.delete(category);
        bump();
      }
    },
    [slug, router, bump],
  );

  const isRunning = useCallback((category: string) => inFlight.current.has(category), []);

  const dismissError = useCallback(() => setError(null), []);

  return { rerun, isRunning, error, dismissError };
}
