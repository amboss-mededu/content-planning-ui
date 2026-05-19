'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  /** Show window.confirm before firing. Defaults to true. */
  confirm?: boolean;
  /** Forward chainSecondaries to the workflow route. Defaults to true. */
  chainSecondaries?: boolean;
  /** Extra categories to include in the workflow's `categories` filter
   *  beyond the primary one. The Category modal uses this to translate
   *  a `consolidationCategory` bucket into the source categories its
   *  codes actually carry — the workflow filters codes by source
   *  `category`, so passing just the bucket name silently produces 0
   *  staging rows. The primary category still drives the in-flight Set
   *  key, confirm message, and "Rebuilding…" badge for the bucket. */
  additionalCategories?: string[];
};

export type RerunResult = {
  category: string;
  stagingArticles: number;
  stagingSections: number;
  consolidatedArticles: number;
  consolidatedSections: number;
};

const LAST_RESULT_TTL_MS = 8000;

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
  const [lastResult, setLastResult] = useState<RerunResult | null>(null);

  const bump = useCallback(() => forceRender((n) => n + 1), []);

  // Auto-dismiss the success banner so it doesn't linger after the
  // editor has acknowledged the count. Reset on every new lastResult.
  useEffect(() => {
    if (!lastResult) return;
    const id = window.setTimeout(() => setLastResult(null), LAST_RESULT_TTL_MS);
    return () => window.clearTimeout(id);
  }, [lastResult]);

  const rerun = useCallback(
    async (category: string, options?: Options) => {
      const {
        confirm = true,
        chainSecondaries = true,
        additionalCategories,
      } = options ?? {};
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
      setLastResult(null);
      inFlight.current.add(category);
      bump();
      try {
        // Dedupe in case the caller already included the primary
        // category in the additional list.
        const categories = Array.from(
          new Set([category, ...(additionalCategories ?? [])]),
        );
        const res = await fetch('/api/workflows/consolidate-primary', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            specialtySlug: slug,
            categories,
            chainSecondaries,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          result?: {
            stagingArticles?: number;
            stagingSections?: number;
            consolidatedArticles?: number;
            consolidatedSections?: number;
          } | null;
        };
        if (!res.ok) {
          setError(
            body.error ?? `HTTP ${res.status} starting consolidation for ${category}`,
          );
          return;
        }
        if (body.result) {
          setLastResult({
            category,
            stagingArticles: body.result.stagingArticles ?? 0,
            stagingSections: body.result.stagingSections ?? 0,
            consolidatedArticles: body.result.consolidatedArticles ?? 0,
            consolidatedSections: body.result.consolidatedSections ?? 0,
          });
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
  const dismissLastResult = useCallback(() => setLastResult(null), []);

  return { rerun, isRunning, error, dismissError, lastResult, dismissLastResult };
}
