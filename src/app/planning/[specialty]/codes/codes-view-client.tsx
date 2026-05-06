'use client';

import { useMemo } from 'react';
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
}: {
  slug: string;
  canEdit: boolean;
  lockStatus: string | null;
  initialCodes: CodeRecord[];
  initialInFlight: string[];
}) {
  const codes = useLiveCollection<CodeRecord>('codes', initialCodes, {
    filter: `specialtySlug = "${slug}"`,
  });
  const inFlightRows = useLiveCollection<MappingInFlightRecord>(
    'mappingsInFlight',
    [], // initial pulled from server passes through inFlightCodes prop below
    { filter: `specialtySlug = "${slug}"` },
  );

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
    />
  );
}
