'use client';

import type { RecordModel, RecordSubscription } from 'pocketbase';
import { useEffect, useRef, useState } from 'react';
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
  const initialSnapshotToken = snapshotToken(initial);
  const lastAppliedSnapshotToken = useRef(initialSnapshotToken);

  // Seed from the server-rendered snapshot; subsequent RSC refreshes
  // are applied by the snapshot-token effect below.
  const [rows, setRows] = useState<T[]>(initial);

  useEffect(() => {
    if (lastAppliedSnapshotToken.current === initialSnapshotToken) return;
    lastAppliedSnapshotToken.current = initialSnapshotToken;
    setRows(initial);
  }, [initial, initialSnapshotToken]);

  const filter = opts?.filter;

  useEffect(() => {
    const pb = getBrowserClient();
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    pb.collection(collection)
      .subscribe<T>('*', (e: RecordSubscription<T>) => {
        if (cancelled) return;
        // Apply filtering client-side. Server-side subscribe filters
        // can suppress sparse delete payloads before they reach us,
        // which strands stale approval/backlog rows in mounted views.
        setRows((current) => applyFilteredEvent(current, e, filter));
      })
      .then((unsub) => {
        if (cancelled) {
          unsub();
        } else {
          unsubscribe = unsub;
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn('PocketBase realtime subscribe failed', {
          collection,
          filter,
          error: e,
        });
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [collection, filter]);

  return rows;
}

export function snapshotToken(rows: RecordModel[]): string {
  return rows.map((r) => `${r.id}:${snapshotUpdatedValue(r)}`).join('|');
}

function snapshotUpdatedValue(row: RecordModel): string {
  const updated = (row as Record<string, unknown>).updated;
  return typeof updated === 'string' || typeof updated === 'number'
    ? String(updated)
    : '';
}

export function applyFilteredEvent<T extends RecordModel>(
  current: T[],
  e: RecordSubscription<T>,
  filter?: string,
): T[] {
  if (!filter) return applyEvent(current, e);
  const matches = matchesFilter(e.record, filter);
  if (matches) return applyEvent(current, e);

  // PocketBase delete events may be delivered with only enough record
  // data to identify the row. If we reject those by field filter first,
  // any already-seeded row remains visible forever. For updates that no
  // longer match, removing the existing local row mirrors a filtered
  // live query.
  if (current.some((r) => r.id === e.record.id)) {
    return current.filter((r) => r.id !== e.record.id);
  }
  return current;
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
