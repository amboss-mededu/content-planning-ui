'use client';

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import type { NumericFilter, SortState } from './types';

/**
 * localStorage persistence for a DataTable's interactive view state. Loads
 * the saved snapshot on mount (and on storageKey change), then persists
 * every subsequent state change under a `v: 1` payload.
 *
 * Must be called AFTER the state hooks it restores into so the load effect
 * runs with their setters in scope — the interlocking `hydrated` flag below
 * is what keeps the persist effect from clobbering saved state.
 */
export function useDataTableStorage({
  storageKey,
  sort,
  setSort,
  numFilters,
  setNumFilters,
  stringFilters,
  setStringFilters,
  textFilters,
  setTextFilters,
  hidden,
  setHidden,
  widths,
  setWidths,
}: {
  storageKey: string | undefined;
  sort: SortState;
  setSort: Dispatch<SetStateAction<SortState>>;
  numFilters: Record<string, NumericFilter | null>;
  setNumFilters: Dispatch<SetStateAction<Record<string, NumericFilter | null>>>;
  stringFilters: Record<string, string[] | null>;
  setStringFilters: Dispatch<SetStateAction<Record<string, string[] | null>>>;
  textFilters: Record<string, string | null>;
  setTextFilters: Dispatch<SetStateAction<Record<string, string | null>>>;
  hidden: Set<string>;
  setHidden: Dispatch<SetStateAction<Set<string>>>;
  widths: Record<string, number>;
  setWidths: Dispatch<SetStateAction<Record<string, number>>>;
}) {
  // Persisted-state plumbing. `hydrated` flips to true after the load
  // effect runs. State (not a ref) so the persist effect re-runs with
  // the loaded values — a ref version had a race where the persist
  // effect's first run used the closure's still-empty initial state
  // and overwrote the saved widths/filters with `{}` on every remount.
  const [hydrated, setHydrated] = useState(false);
  // Derived-state reset: if storageKey changes (e.g. /sections toggling
  // between section and article view), reset `hydrated` SYNCHRONOUSLY
  // during render so the persist effect doesn't fire one tick with the
  // old state values keyed under the new storageKey.
  const lastStorageKey = useRef<string | undefined>(storageKey);
  if (lastStorageKey.current !== storageKey) {
    lastStorageKey.current = storageKey;
    setHydrated(false);
  }
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      setHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          v?: number;
          sort?: SortState;
          numFilters?: Record<string, NumericFilter | null>;
          // Persisted format historically stored a single string per column
          // (pre-multi-select). Accept either shape and normalize on load.
          stringFilters?: Record<string, string | string[] | null>;
          textFilters?: Record<string, string | null>;
          hidden?: string[];
          widths?: Record<string, number>;
        };
        if (parsed.v === 1) {
          if (parsed.sort !== undefined) setSort(parsed.sort);
          if (parsed.numFilters) setNumFilters(parsed.numFilters);
          if (parsed.stringFilters) {
            const normalized: Record<string, string[] | null> = {};
            for (const [k, v] of Object.entries(parsed.stringFilters)) {
              if (v === null || v === undefined || v === '') normalized[k] = null;
              else if (Array.isArray(v)) normalized[k] = v.length > 0 ? v : null;
              else normalized[k] = [v];
            }
            setStringFilters(normalized);
          }
          if (parsed.textFilters) setTextFilters(parsed.textFilters);
          if (Array.isArray(parsed.hidden)) setHidden(new Set(parsed.hidden));
          if (parsed.widths) setWidths(parsed.widths);
        }
      }
    } catch {
      // Corrupted entry — fall back to defaults silently rather than crashing.
    }
    setHydrated(true);
  }, [
    storageKey,
    setSort,
    setNumFilters,
    setStringFilters,
    setTextFilters,
    setHidden,
    setWidths,
  ]);

  useEffect(() => {
    if (!storageKey || !hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          sort,
          numFilters,
          stringFilters,
          textFilters,
          hidden: [...hidden],
          widths,
        }),
      );
    } catch {
      // QuotaExceeded or storage disabled — non-fatal; user just loses
      // persistence for this session.
    }
  }, [
    storageKey,
    hydrated,
    sort,
    numFilters,
    stringFilters,
    textFilters,
    hidden,
    widths,
  ]);
}
