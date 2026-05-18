'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import type { CodeRecord, MappingInFlightRecord } from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';
import type { Code } from '@/lib/types';
import { CodesView } from '../../_components/codes-view';

/**
 * Codes table — server-rendered with the initial snapshot, live-updated
 * via PocketBase WebSocket subscriptions. Replaces the Convex
 * `usePreloadedQuery` / `useQuery` pair.
 *
 * Blob fields (`articlesWhereCoverageIs` etc.) come back from PB as
 * already-parsed JSON, so no client-side hydration needed.
 */
export function CodesViewClient({
  slug,
  canEdit,
  lockStatus,
  initialCodes,
  initialInFlight,
  categories,
  unmappedCodes,
  unmappedCount,
}: {
  slug: string;
  canEdit: boolean;
  lockStatus: string | null;
  initialCodes: CodeRecord[];
  initialInFlight: string[];
  categories: CodeCategorySummary[];
  unmappedCodes: UnmappedCodePickerRow[];
  unmappedCount: number;
}) {
  const router = useRouter();
  const codes = useLiveCollection<CodeRecord>('codes', initialCodes, {
    filter: `specialtySlug = "${slug}"`,
  });
  const inFlightRows = useLiveCollection<MappingInFlightRecord>(
    'mappingsInFlight',
    [], // initial pulled from server passes through inFlightCodes prop below
    { filter: `specialtySlug = "${slug}"` },
  );

  // The browser PB client is anonymous (the `pb_auth` cookie is httpOnly),
  // so realtime subscriptions on the auth-gated `codes` collection silently
  // drop events. Until we wire a non-httpOnly auth handoff for the browser
  // client, fall back to polling on a slow interval and on tab focus so the
  // table catches mutations from sibling pages (stage reset, individual
  // remap from another tab) without forcing the user to hard-refresh.
  useEffect(() => {
    const tick = () => router.refresh();
    const id = setInterval(tick, 3000);
    const onFocus = () => router.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [router]);

  // Merge initial snapshot (string[]) with the live subscription (records)
  // so the first paint shows pulses without waiting for the WebSocket.
  const inFlightCodes = useMemo(() => {
    const live = new Set(inFlightRows.map((r) => r.code));
    for (const code of initialInFlight) live.add(code);
    return Array.from(live);
  }, [inFlightRows, initialInFlight]);

  return (
    <CodesView
      codes={codes as unknown as Code[]}
      specialtySlug={slug}
      canEdit={canEdit}
      lockStatus={lockStatus}
      inFlightCodes={inFlightCodes}
      categories={categories}
      unmappedCodes={unmappedCodes}
      unmappedCount={unmappedCount}
    />
  );
}
