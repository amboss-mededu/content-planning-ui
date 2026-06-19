'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeTableRow, PatchCodeFields } from '@/lib/data/codes';
import type { MappingInFlightRecord } from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';
import type { Code, MappingSource } from '@/lib/types';
import { CodesView } from './codes-view';

const PER_PAGE = 200;
const EMPTY_IN_FLIGHT: MappingInFlightRecord[] = [];
const FULL_RECONCILE_INTERVAL_MS = 60_000;
const PAGE_RETRY_DELAY_MS = 1500;

export type CodeRowsLoadState = 'loading' | 'retrying' | 'complete';

type SupportSummary = {
  totalCount: number;
  unmappedCount: number;
  inFlightCodes: string[];
  /** Which consolidation buckets are rebuilding right now. The sheet is
   *  always editable except during a full-specialty consolidation
   *  (`runningAll`); per-bucket runs are enforced server-side via 409. */
  activity: { runningAll: boolean; runningBuckets: string[] };
};

export function CodesViewClient({
  slug,
  initialCodes,
  initialHasMore,
  mappingOnly = false,
  mappingSource = 'amboss',
}: {
  slug: string;
  initialCodes: CodeTableRow[];
  initialHasMore: boolean;
  mappingOnly?: boolean;
  mappingSource?: MappingSource;
}) {
  const [codes, setCodes] = useState<CodeTableRow[]>(initialCodes);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadState, setLoadState] = useState<CodeRowsLoadState>(
    initialHasMore ? 'loading' : 'complete',
  );
  const [summary, setSummary] = useState<SupportSummary | null>(null);

  const currentSlugRef = useRef(slug);
  const nextPageRef = useRef(2);

  useEffect(() => {
    if (currentSlugRef.current !== slug) {
      currentSlugRef.current = slug;
      nextPageRef.current = 2;
      setCodes(initialCodes);
      setHasMore(initialHasMore);
      setLoadState(initialHasMore ? 'loading' : 'complete');
      setSummary(null);
      return;
    }

    // An authoritative empty first page means the codes were wiped (e.g. the
    // extraction was reset). The merge-only path below only adds/updates rows
    // and never drops deleted ones, so clear explicitly instead of leaving
    // stale rows on screen until the periodic full reconcile catches up.
    if (initialCodes.length === 0) {
      nextPageRef.current = 2;
      setCodes([]);
      setHasMore(false);
      setLoadState('complete');
      return;
    }

    setCodes((prev) => mergePageInto(prev, initialCodes));
  }, [slug, initialCodes, initialHasMore]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/codes/${encodeURIComponent(slug)}/summary`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as SupportSummary;
        if (!cancelled) setSummary(data);
      } catch {
        /* user actions stay disabled until the next navigation/retry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const inFlightRows = useLiveCollection<MappingInFlightRecord>(
    'mappingsInFlight',
    EMPTY_IN_FLIGHT,
    { filter: `specialtySlug = "${slug}"` },
  );

  const inFlightCodes = useMemo(() => {
    const live = new Set(inFlightRows.map((r) => r.code));
    for (const code of summary?.inFlightCodes ?? []) live.add(code);
    return Array.from(live);
  }, [inFlightRows, summary]);

  // Progressive page fetch — load remaining lean pages after first paint.
  useEffect(() => {
    if (!initialHasMore) {
      setHasMore(false);
      setLoadState('complete');
      return;
    }
    const controller = new AbortController();

    (async () => {
      while (!controller.signal.aborted) {
        const page = nextPageRef.current;
        setLoadState((prev) => (prev === 'retrying' ? prev : 'loading'));
        try {
          const res = await fetch(
            `/api/codes/${encodeURIComponent(slug)}?page=${page}&perPage=${PER_PAGE}`,
            { cache: 'no-store', signal: controller.signal },
          );
          if (!res.ok) throw new Error(`Failed to load page ${page}`);
          const data: { items: CodeTableRow[]; hasMore: boolean } = await res.json();
          if (controller.signal.aborted) break;
          setCodes((prev) => mergePageInto(prev, data.items));
          setHasMore(data.hasMore);
          if (!data.hasMore) {
            setLoadState('complete');
            break;
          }
          nextPageRef.current = page + 1;
          setLoadState('loading');
        } catch {
          if (controller.signal.aborted) break;
          setHasMore(true);
          setLoadState('retrying');
          try {
            await waitForRetry(PAGE_RETRY_DELAY_MS, controller.signal);
          } catch {
            break;
          }
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [slug, initialHasMore]);

  const newestUpdated = useMemo(() => getNewestUpdated(codes), [codes]);

  const fullReconcile = useCallback(async () => {
    const freshIds = new Set<string>();
    let page = 1;
    let more = true;

    while (more) {
      const res = await fetch(
        `/api/codes/${encodeURIComponent(slug)}?page=${page}&perPage=${PER_PAGE}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { items: CodeTableRow[]; hasMore: boolean };
      for (const r of data.items) freshIds.add(r.id);
      setCodes((prev) => mergePageInto(prev, data.items));
      more = data.hasMore;
      page++;
    }

    setCodes((prev) => prev.filter((r) => freshIds.has(r.id)));
  }, [slug]);

  useEffect(() => {
    if (loadState !== 'complete') return;
    let cancelled = false;

    const pollIncremental = async () => {
      if (!newestUpdated) return;
      try {
        let page = 1;
        let more = true;
        while (more && !cancelled) {
          const res = await fetch(
            `/api/codes/${encodeURIComponent(slug)}?page=${page}&perPage=${PER_PAGE}&updatedAfter=${encodeURIComponent(newestUpdated)}`,
            { cache: 'no-store' },
          );
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as {
            items: CodeTableRow[];
            hasMore: boolean;
          };
          if (cancelled) return;
          if (data.items.length > 0) {
            setCodes((prev) => mergePageInto(prev, data.items));
          }
          more = data.hasMore;
          page++;
        }
      } catch {
        /* next tick retries */
      }
    };

    const incrementalId = setInterval(pollIncremental, 5000);
    const reconcileId = setInterval(() => {
      fullReconcile().catch(() => undefined);
    }, FULL_RECONCILE_INTERVAL_MS);
    const onFocus = () => {
      fullReconcile().catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(incrementalId);
      clearInterval(reconcileId);
      window.removeEventListener('focus', onFocus);
    };
  }, [slug, loadState, newestUpdated, fullReconcile]);

  // Apply an inline cell edit. PATCH returns the updated lean row; merge it in
  // place so the table reflects the change (and any server-recomputed counts /
  // mappedAt stamp) immediately, without waiting for the 5s poll.
  const patchRow = useCallback(
    async (code: string, fields: PatchCodeFields): Promise<CodeTableRow> => {
      const res = await fetch(
        `/api/codes/${encodeURIComponent(slug)}/${encodeURIComponent(code)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(fields),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as CodeTableRow;
      setCodes((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      return updated;
    },
    [slug],
  );

  const supportReady = summary !== null;
  // Always editable once support data loads, except during a full-specialty
  // consolidation. Per-bucket runs don't lock the whole sheet — the server
  // 409s edits to a code in an actively-rebuilding bucket.
  const canEdit = supportReady ? !summary.activity.runningAll : false;
  const lockStatus = null;
  const allRowsLoaded = loadState === 'complete' && !hasMore;
  const totalCount = summary?.totalCount ?? (allRowsLoaded ? codes.length : undefined);

  return (
    <CodesView
      codes={codes as unknown as Code[]}
      specialtySlug={slug}
      canEdit={canEdit}
      lockStatus={lockStatus}
      supportReady={supportReady}
      inFlightCodes={inFlightCodes}
      totalCount={totalCount}
      loadState={loadState}
      onPatchRow={patchRow}
      mappingOnly={mappingOnly}
      mappingSource={mappingSource}
    />
  );
}

/** Update existing rows in-place and append new ones. */
function mergePageInto(prev: CodeTableRow[], page: CodeTableRow[]): CodeTableRow[] {
  const incoming = new Map(page.map((r) => [r.id, r]));
  let changed = false;
  const merged = prev.map((r) => {
    const updated = incoming.get(r.id);
    if (updated) {
      incoming.delete(r.id);
      if (r.updated !== updated.updated) {
        changed = true;
        return updated;
      }
    }
    return r;
  });
  if (incoming.size === 0 && !changed) return prev;
  const appended = Array.from(incoming.values());
  return (appended.length > 0 ? [...merged, ...appended] : merged).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

function getNewestUpdated(rows: CodeTableRow[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    if (!newest || row.updated > newest) newest = row.updated;
  }
  return newest;
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
