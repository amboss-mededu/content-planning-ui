'use client';

import type { RecordModel, RecordSubscription } from 'pocketbase';
import { useEffect, useState } from 'react';
import { getBrowserClient } from './browser';

/**
 * Server-snapshot + client-subscribe pattern for keeping a PocketBase
 * collection's rows in sync with the UI. The page's RSC fetches the
 * initial snapshot and passes it as `initial`; this hook then opens a
 * WebSocket subscription and applies create / update / delete events as
 * they fire.
 *
 * Mirrors the Convex `usePreloadedQuery` / `useQuery` pair — same shape,
 * different transport.
 */
export function useLiveCollection<T extends RecordModel>(
  collection: string,
  initial: T[],
  opts?: { filter?: string },
): T[] {
  const [rows, setRows] = useState<T[]>(initial);

  useEffect(() => {
    setRows(initial);
  }, [initial]);

  useEffect(() => {
    const pb = getBrowserClient();
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    pb.collection(collection)
      .subscribe<T>(
        '*',
        (e: RecordSubscription<T>) => {
          if (cancelled) return;
          // Server-side filtering would be ideal here, but PB's subscribe
          // filter is collection-scoped and not all our queries map cleanly
          // to a single filter expression. Apply the filter client-side
          // when present.
          if (opts?.filter && !matchesFilter(e.record, opts.filter)) return;
          setRows((current) => applyEvent(current, e));
        },
        opts?.filter ? { filter: opts.filter } : undefined,
      )
      .then((unsub) => {
        if (cancelled) {
          unsub();
        } else {
          unsubscribe = unsub;
        }
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [collection, opts?.filter]);

  return rows;
}

function applyEvent<T extends RecordModel>(current: T[], e: RecordSubscription<T>): T[] {
  switch (e.action) {
    case 'create':
      return [...current.filter((r) => r.id !== e.record.id), e.record];
    case 'update':
      return current.map((r) => (r.id === e.record.id ? e.record : r));
    case 'delete':
      return current.filter((r) => r.id !== e.record.id);
    default:
      return current;
  }
}

// PB subscribe filter strings use API-rule syntax. Re-applying it client-side
// is best-effort — covers the common `field = "value"` and
// `field = "value" && other = "x"` shapes we use in this app. Anything more
// exotic should be handled by ditching the filter and projecting in the
// caller.
function matchesFilter(record: RecordModel, filter: string): boolean {
  const clauses = filter.split(/&&/).map((s) => s.trim());
  for (const clause of clauses) {
    const m = clause.match(/^(\w+)\s*=\s*"([^"]*)"$/);
    if (!m) return true; // can't parse — let it through
    const [, field, value] = m;
    if (String((record as unknown as Record<string, unknown>)[field]) !== value) {
      return false;
    }
  }
  return true;
}
