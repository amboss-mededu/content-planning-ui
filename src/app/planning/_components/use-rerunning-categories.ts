'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserClient } from '@/lib/pb/browser';
import type { PipelineRunRecord } from '@/lib/pb/types';

// Maximum age of a `status='running'` row that we'll still treat as
// in-flight. Anything older is a stale row from a crashed/aborted run
// whose terminal status never landed — without this guard the UI's
// "Rebuilding…" placeholder would hide every consolidation forever
// after one bad run. Sized at 10 minutes: well over the chained stubs'
// actual runtime (seconds) and over the worst-case LLM run we expect.
const RUNNING_RECENCY_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
export type PipelineRunTerminalStatus = 'completed' | 'failed' | 'cancelled';

type PipelineRunRealtimeAction = 'create' | 'update' | 'delete';

export type PipelineRunRealtimeEvent = {
  action: PipelineRunRealtimeAction;
  record: PipelineRunRecord;
};

export type RerunningCategoriesStateChange = {
  runs: PipelineRunRecord[];
  settlements: PipelineRunSettlement[];
};

export type PipelineRunSettlement = {
  categories: string[];
  status: PipelineRunTerminalStatus;
  error?: string;
  runId: string;
};

export type UseRerunningCategoriesOptions = {
  onSettled?: (settlement: PipelineRunSettlement) => void;
};

function targetCategories(record: PipelineRunRecord): string[] {
  return Array.isArray(record.targetCategories)
    ? record.targetCategories.filter((cat): cat is string => typeof cat === 'string')
    : [];
}

function isFreshRunningTargetedRun(
  record: PipelineRunRecord,
  slug: string,
  now: number,
): boolean {
  if (record.specialtySlug !== slug || record.status !== 'running') return false;
  if (targetCategories(record).length === 0) return false;
  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : 0;
  return startedAt <= 0 || startedAt >= now - RUNNING_RECENCY_MS;
}

function isFreshTargetedRun(record: PipelineRunRecord, slug: string, now: number) {
  if (record.specialtySlug !== slug) return false;
  if (targetCategories(record).length === 0) return false;
  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : 0;
  return startedAt <= 0 || startedAt >= now - RUNNING_RECENCY_MS;
}

function terminalStatus(status: string): PipelineRunTerminalStatus | null {
  return TERMINAL_STATUSES.has(status) ? (status as PipelineRunTerminalStatus) : null;
}

export function applyPipelineRunRealtimeEvent(
  current: PipelineRunRecord[],
  event: PipelineRunRealtimeEvent,
  slug: string,
  now: number = Date.now(),
): RerunningCategoriesStateChange {
  const previous = current.find((run) => run.id === event.record.id);
  const status =
    event.action === 'delete'
      ? (terminalStatus(previous?.status ?? event.record.status) ?? 'cancelled')
      : terminalStatus(event.record.status);
  const settlementSource =
    previous ??
    (status && isFreshTargetedRun(event.record, slug, now) ? event.record : null);
  const settlements =
    status && settlementSource
      ? [
          {
            categories: targetCategories(settlementSource),
            status,
            error: event.record.error,
            runId: event.record.id,
          },
        ]
      : [];
  const without = current.filter((run) => run.id !== event.record.id);
  if (event.action === 'delete') {
    return { runs: without, settlements };
  }
  if (!isFreshRunningTargetedRun(event.record, slug, now)) {
    return { runs: without, settlements };
  }
  return { runs: [...without, event.record], settlements };
}

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
export function useRerunningCategories(
  slug: string,
  options?: UseRerunningCategoriesOptions,
): Set<string> {
  const [runs, setRuns] = useState<PipelineRunRecord[]>([]);
  const runsRef = useRef<PipelineRunRecord[]>([]);
  const onSettled = options?.onSettled;

  useEffect(() => {
    const pb = getBrowserClient();
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const initialFilter = `specialtySlug = "${slug}" && status = "running"`;
    const realtimeFilter = `specialtySlug = "${slug}"`;

    pb.collection<PipelineRunRecord>('pipelineRuns')
      .subscribe(
        '*',
        (e) => {
          if (cancelled) return;
          const action: PipelineRunRealtimeAction =
            e.action === 'create' || e.action === 'update' || e.action === 'delete'
              ? e.action
              : 'update';
          const next = applyPipelineRunRealtimeEvent(
            runsRef.current,
            { action, record: e.record },
            slug,
          );
          runsRef.current = next.runs;
          setRuns(next.runs);
          for (const settlement of next.settlements) {
            if (settlement.categories.length > 0) onSettled?.(settlement);
          }
        },
        { filter: realtimeFilter },
      )
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
        return pb
          .collection<PipelineRunRecord>('pipelineRuns')
          .getFullList({ filter: initialFilter });
      })
      .then((rows) => {
        if (!rows) return;
        if (!cancelled) {
          const now = Date.now();
          const nextRuns = rows.filter((row) =>
            isFreshRunningTargetedRun(row, slug, now),
          );
          runsRef.current = nextRuns;
          setRuns(nextRuns);
        }
      })
      .catch(() => {
        // Best-effort: if subscribe or initial fetch fails, the UI just
        // won't receive cross-tab progress for this mount.
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [slug, onSettled]);

  return useMemo(() => {
    const out = new Set<string>();
    for (const run of runs) {
      for (const cat of targetCategories(run)) out.add(cat);
    }
    return out;
  }, [runs]);
}
