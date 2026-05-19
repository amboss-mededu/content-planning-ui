'use client';

import { useEffect, useMemo, useState } from 'react';
import { getBrowserClient } from '@/lib/pb/browser';
import type { PipelineRunRecord } from '@/lib/pb/types';

// Maximum age of a `status='running'` row that we'll still treat as
// in-flight. Anything older is a stale row from a crashed/aborted run
// whose terminal status never landed — without this guard the UI's
// "Rebuilding…" placeholder would hide every consolidation forever
// after one bad run. Sized at 10 minutes: well over the chained stubs'
// actual runtime (seconds) and over the worst-case LLM run we expect.
const RUNNING_RECENCY_MS = 10 * 60 * 1000;

/**
 * Live view of which categories currently have an in-flight per-category
 * re-run, derived from running `pipelineRuns` rows whose `targetCategories`
 * include the category name.
 *
 * Cross-tab by construction: the same PocketBase realtime stream feeds
 * every subscriber, so the Consolidation Review tab and the Categories
 * tab observe the same "Rebuilding…" state without coordinating in
 * memory. Survives page navigation: each mount re-fetches the current
 * running runs before subscribing, so a tab opened after a re-run
 * started still sees the in-flight bucket.
 *
 * Full-specialty runs (where `targetCategories` is null) are NOT
 * reflected here — those wipe everything by design and the UI surfaces
 * them through the global "Running…" indicator on the pipeline page,
 * not the per-bucket badge.
 */
export function useRerunningCategories(slug: string): Set<string> {
  const [runs, setRuns] = useState<PipelineRunRecord[]>([]);

  useEffect(() => {
    const pb = getBrowserClient();
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const filter = `specialtySlug = "${slug}" && status = "running"`;

    pb.collection<PipelineRunRecord>('pipelineRuns')
      .getFullList({ filter })
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch(() => {
        // Best-effort: on initial fetch failure we still subscribe so
        // future events populate the set; the badge just won't show
        // existing runs until one updates.
      });

    pb.collection<PipelineRunRecord>('pipelineRuns')
      .subscribe(
        '*',
        (e) => {
          if (cancelled) return;
          const record = e.record;
          const matchesSlug = record.specialtySlug === slug;
          setRuns((current) => {
            if (e.action === 'delete') {
              return current.filter((r) => r.id !== record.id);
            }
            // Treat any non-running status (or non-matching slug) as a
            // removal: completed/failed/cancelled runs shouldn't surface
            // as in-flight.
            const isRunning = matchesSlug && record.status === 'running';
            const without = current.filter((r) => r.id !== record.id);
            return isRunning ? [...without, record] : without;
          });
        },
        { filter },
      )
      .then((unsub) => {
        if (cancelled) unsub();
        else unsubscribe = unsub;
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [slug]);

  return useMemo(() => {
    const out = new Set<string>();
    const cutoff = Date.now() - RUNNING_RECENCY_MS;
    for (const run of runs) {
      // Drop stale "running" rows — see RUNNING_RECENCY_MS.
      const startedAt = typeof run.startedAt === 'number' ? run.startedAt : 0;
      if (startedAt > 0 && startedAt < cutoff) continue;
      const targets = run.targetCategories;
      if (!Array.isArray(targets)) continue;
      for (const cat of targets) {
        if (typeof cat === 'string') out.add(cat);
      }
    }
    return out;
  }, [runs]);
}
