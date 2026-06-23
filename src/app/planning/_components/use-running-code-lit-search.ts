'use client';

import { useMemo } from 'react';
import type { CodeLitSearchRunRecord } from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';

// Code/topic-level mirror of use-running-lit-search-articles.ts. Keyed by the
// code's PB id (`codeId`); drives the RAG-corpus mapping-sheet Literature column.

export type CodeLitSearchSnapshot = {
  latestByCodeId: Map<string, CodeLitSearchRunRecord>;
  inFlight: Set<string>;
  errors: Map<string, string>;
};

export function latestCodeLitSearchRunByCodeId(
  rows: CodeLitSearchRunRecord[],
): Map<string, CodeLitSearchRunRecord> {
  const out = new Map<string, CodeLitSearchRunRecord>();
  for (const row of rows) {
    if (!row.codeId) continue;
    const existing = out.get(row.codeId);
    if (!existing || sortTime(row) >= sortTime(existing)) out.set(row.codeId, row);
  }
  return out;
}

export function deriveCodeLitSearchSnapshot(
  rows: CodeLitSearchRunRecord[],
): CodeLitSearchSnapshot {
  const latestByCodeId = latestCodeLitSearchRunByCodeId(rows);
  const inFlight = new Set<string>();
  const errors = new Map<string, string>();
  for (const [codeId, run] of latestByCodeId.entries()) {
    if (run.status === 'running') inFlight.add(codeId);
    if (run.status === 'failed' && run.errorMessage) errors.set(codeId, run.errorMessage);
  }
  return { latestByCodeId, inFlight, errors };
}

/**
 * Live view of durable per-code literature-search runs. `codeLitSearchRuns` is
 * the source of truth for in-flight progress; the keys are stable code PB ids.
 */
export function useCodeLitSearchState(
  slug: string,
  initialRuns: CodeLitSearchRunRecord[] = [],
): CodeLitSearchSnapshot {
  const rows = useLiveCollection<CodeLitSearchRunRecord>(
    'codeLitSearchRuns',
    initialRuns,
    {
      filter: `specialtySlug = "${slug}"`,
    },
  );
  return useMemo(() => deriveCodeLitSearchSnapshot(rows), [rows]);
}

function sortTime(row: CodeLitSearchRunRecord): number {
  return row.startedAt ?? (Date.parse(row.created || '') || 0);
}
