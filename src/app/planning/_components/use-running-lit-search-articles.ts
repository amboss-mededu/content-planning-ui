'use client';

import { useMemo } from 'react';
import type { ArticleLitSearchRunRecord } from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';

export type LitSearchSnapshot = {
  latestByArticleKey: Map<string, ArticleLitSearchRunRecord>;
  inFlight: Set<string>;
  errors: Map<string, string>;
};

export function latestLitSearchRunByArticleKey(
  rows: ArticleLitSearchRunRecord[],
): Map<string, ArticleLitSearchRunRecord> {
  const out = new Map<string, ArticleLitSearchRunRecord>();
  for (const row of rows) {
    if (!row.articleKey) continue;
    const existing = out.get(row.articleKey);
    if (!existing || litSearchRunSortTime(row) >= litSearchRunSortTime(existing)) {
      out.set(row.articleKey, row);
    }
  }
  return out;
}

export function deriveLitSearchSnapshot(
  rows: ArticleLitSearchRunRecord[],
): LitSearchSnapshot {
  const latestByArticleKey = latestLitSearchRunByArticleKey(rows);
  const inFlight = new Set<string>();
  const errors = new Map<string, string>();
  for (const [articleKey, run] of latestByArticleKey.entries()) {
    if (run.status === 'running') inFlight.add(articleKey);
    if (run.status === 'failed' && run.errorMessage) {
      errors.set(articleKey, run.errorMessage);
    }
  }
  return { latestByArticleKey, inFlight, errors };
}

/**
 * Live view of durable per-article literature-search runs.
 *
 * `articleLitSearchRuns` is the source of truth for progress; pipeline
 * events remain diagnostic logs only. The keys in `inFlight` and
 * `errors` are stable `articleKey` values, not producer PB ids.
 */
export function useLitSearchState(
  initialRuns: ArticleLitSearchRunRecord[] = [],
  opts?: { filter?: string },
): LitSearchSnapshot {
  const rows = useLiveCollection<ArticleLitSearchRunRecord>(
    'articleLitSearchRuns',
    initialRuns,
    opts,
  );
  return useMemo(() => deriveLitSearchSnapshot(rows), [rows]);
}

function litSearchRunSortTime(row: ArticleLitSearchRunRecord): number {
  return row.startedAt ?? (Date.parse(row.created || '') || 0);
}
