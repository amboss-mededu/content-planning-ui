'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * While `running` is true, re-fetch the current route every `intervalMs` via
 * `router.refresh()` so server-derived state (e.g. an extraction's running
 * flag) updates live without a manual reload — the same poll the pipeline
 * dashboard uses, for the Categories / Mapping / Milestones tabs that lack it.
 * No-op (and no timer) when not running.
 */
export function useRefreshWhileRunning(running: boolean, intervalMs = 2000): void {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [running, intervalMs, router]);
}
