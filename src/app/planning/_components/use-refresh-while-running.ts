'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * While `running` is true, re-fetch the current route every `intervalMs` via
 * `router.refresh()` so server-derived state (e.g. an extraction's running
 * flag) updates live without a manual reload — the same poll the pipeline
 * dashboard uses, for the Categories / Mapping / Milestones tabs that lack it.
 * No-op (and no timer) when not running.
 *
 * On the running → idle transition it fires two trailing refreshes (one
 * immediate, one after a short settle delay) so the server-rendered tables
 * (Source categories, consolidation buckets, codes) reflect the *final* state
 * the instant a map/remap completes — the periodic poll stops on that edge, so
 * without this the last codes to finish would only show after a manual reload.
 */
export function useRefreshWhileRunning(running: boolean, intervalMs = 2000): void {
  const router = useRouter();
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      const id = window.setInterval(() => router.refresh(), intervalMs);
      return () => window.clearInterval(id);
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    router.refresh();
    const settleId = window.setTimeout(() => router.refresh(), 1500);
    return () => window.clearTimeout(settleId);
  }, [running, intervalMs, router]);
}
