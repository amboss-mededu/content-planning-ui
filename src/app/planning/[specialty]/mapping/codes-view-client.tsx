'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CodeCategorySummary,
  CodeTableRow,
  UnmappedCodePickerRow,
} from '@/lib/data/codes';
import type { MappingInFlightRecord } from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';
import type { Code } from '@/lib/types';
import { CodesView } from '../../_components/codes-view';

const PER_PAGE = 200;
const EMPTY_IN_FLIGHT: MappingInFlightRecord[] = [];
const FULL_RECONCILE_INTERVAL_MS = 60_000;

type SupportSummary = {
  totalCount: number;
  unmappedCount: number;
  inFlightCodes: string[];
  lock: { locked: boolean; status: string | null };
};

export function CodesViewClient({
  slug,
  initialCodes,
  initialHasMore,
}: {
  slug: string;
  initialCodes: CodeTableRow[];
  initialHasMore: boolean;
}) {
  const [codes, setCodes] = useState<CodeTableRow[]>(initialCodes);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(initialHasMore);
  const [summary, setSummary] = useState<SupportSummary | null>(null);

  const [remapData, setRemapData] = useState<{
    categories: CodeCategorySummary[];
    unmappedCodes: UnmappedCodePickerRow[];
  } | null>(null);
  const [remapLoading, setRemapLoading] = useState(false);
  const currentSlugRef = useRef(slug);

  useEffect(() => {
    if (currentSlugRef.current !== slug) {
      currentSlugRef.current = slug;
      setCodes(initialCodes);
      setHasMore(initialHasMore);
      setIsLoadingMore(initialHasMore);
      setSummary(null);
      setRemapData(null);
      setRemapLoading(false);
      return;
    }

    setCodes((prev) => mergePageInto(prev, initialCodes));
    setHasMore(initialHasMore);
    setIsLoadingMore(initialHasMore);
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

  const loadRemapData = useCallback(async () => {
    if (remapData || remapLoading) return;
    setRemapLoading(true);
    try {
      const res = await fetch(
        `/api/pipeline/${encodeURIComponent(slug)}/map-codes-form-data`,
      );
      if (res.ok) {
        const data = await res.json();
        setRemapData({
          categories: data.categories,
          unmappedCodes: data.unmappedCodes,
        });
      }
    } finally {
      setRemapLoading(false);
    }
  }, [slug, remapData, remapLoading]);

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
  const progressiveLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const loadKey = `${slug}:${initialCodes.length}:${initialHasMore}`;
    if (progressiveLoadKeyRef.current === loadKey) return;
    if (!initialHasMore) {
      progressiveLoadKeyRef.current = loadKey;
      setIsLoadingMore(false);
      return;
    }
    progressiveLoadKeyRef.current = loadKey;
    let cancelled = false;

    (async () => {
      let page = 2;
      while (!cancelled) {
        if (cancelled) break;
        try {
          const res = await fetch(
            `/api/codes/${encodeURIComponent(slug)}?page=${page}&perPage=${PER_PAGE}`,
            { cache: 'no-store' },
          );
          if (!res.ok) break;
          const data: { items: CodeTableRow[]; hasMore: boolean } = await res.json();
          if (cancelled) break;
          setCodes((prev) => mergePageInto(prev, data.items));
          setHasMore(data.hasMore);
          if (!data.hasMore) break;
          page++;
        } catch {
          break;
        }
      }
      if (!cancelled) setIsLoadingMore(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, initialCodes.length, initialHasMore]);

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
    setRemapData(null);
  }, [slug]);

  useEffect(() => {
    if (isLoadingMore) return;
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
            setRemapData(null);
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
  }, [slug, isLoadingMore, newestUpdated, fullReconcile]);

  const supportReady = summary !== null;
  const canEdit = supportReady ? !summary.lock.locked : false;
  const lockStatus = summary?.lock.status ?? null;
  const allRowsLoaded = !isLoadingMore && !hasMore;
  const totalCount = summary?.totalCount ?? (allRowsLoaded ? codes.length : undefined);
  const unmappedCount = allRowsLoaded
    ? codes.filter((r) => !r.mappedAt || r.mappedAt === 0).length
    : (summary?.unmappedCount ?? 0);

  return (
    <CodesView
      codes={codes as unknown as Code[]}
      specialtySlug={slug}
      canEdit={canEdit}
      lockStatus={lockStatus}
      supportReady={supportReady}
      inFlightCodes={inFlightCodes}
      categories={remapData?.categories ?? []}
      unmappedCodes={remapData?.unmappedCodes ?? []}
      unmappedCount={unmappedCount}
      totalCount={totalCount}
      isLoadingMore={isLoadingMore || hasMore}
      remapLoading={remapLoading}
      onRequestRemapData={loadRemapData}
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
