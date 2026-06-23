import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { CodeLitSearchRunRecord } from '@/lib/pb/types';
import { maybeFinalizeCodeLitSearchRun } from '@/lib/workflows/code-lit-search/finalize';
import {
  type CodeLitSearchRunClaim,
  claimCodeLitSearchRunWithClient,
} from './code-lit-search-runs-claim';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export { type CodeLitSearchRunClaim, claimCodeLitSearchRunWithClient };

export type CodeLitSearchRunPatch = {
  status: 'completed' | 'failed';
  errorMessage?: string;
  queryCount?: number;
  candidateCount?: number;
  sourcesCount?: number;
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

function sortTime(row: CodeLitSearchRunRecord): number {
  return row.startedAt ?? (Date.parse(row.created || '') || 0);
}

/** Mirror of the article reaper: n8n owns the search, so a row stuck in
 *  `running` past this window means the callback never landed. */
const LIT_SEARCH_RUN_TIMEOUT_MS = 5 * 60 * 1000;

export async function reapStaleCodeLitSearchRunsAsAdmin(slug?: string): Promise<void> {
  try {
    const pb = await createAdminClient();
    const cutoff = Date.now() - LIT_SEARCH_RUN_TIMEOUT_MS;
    const filterParts = [`status = "running"`, `startedAt < ${cutoff}`];
    if (slug) filterParts.unshift(`specialtySlug = "${slug}"`);
    const stale = await pb
      .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
      .getFullList({ filter: filterParts.join(' && ') });
    if (stale.length === 0) return;
    await Promise.all(
      stale.map((r) =>
        pb.collection('codeLitSearchRuns').update(r.id, {
          status: 'failed',
          finishedAt: Date.now(),
          errorMessage: `Timed out after ${LIT_SEARCH_RUN_TIMEOUT_MS / 60_000} minutes`,
          sourcesCount: 0,
        }),
      ),
    );
  } catch (e) {
    log('code-lit-search').error('reapStaleCodeLitSearchRunsAsAdmin failed', {
      slug,
      error: errorMessage(e),
    });
  }
}

export async function listCodeLitSearchRuns(
  slug: string,
): Promise<CodeLitSearchRunRecord[]> {
  await connection();
  await reapStaleCodeLitSearchRunsAsAdmin(slug);
  const pb = await userClient();
  return pb.collection<CodeLitSearchRunRecord>('codeLitSearchRuns').getFullList({
    filter: `specialtySlug = "${slug}"`,
    sort: '-startedAt',
  });
}

export async function claimCodeLitSearchRunAsAdmin(input: {
  specialtySlug: string;
  codeId: string;
  code?: string;
  runId?: string;
}): Promise<CodeLitSearchRunClaim> {
  const pb = await createAdminClient();
  return claimCodeLitSearchRunWithClient(pb, input);
}

export async function finishCodeLitSearchRunAsAdmin(
  runRecordId: string,
  patch: CodeLitSearchRunPatch,
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('codeLitSearchRuns').update(runRecordId, {
    ...patch,
    finishedAt: Date.now(),
    errorMessage: patch.errorMessage ?? '',
  });
}

/**
 * Manually abort an in-flight per-code literature search. n8n owns the search,
 * so this just marks the row `cancelled` and finalizes the parent pipeline run
 * if this was the last active code. Returns the (pre-update) row for slug-scoped
 * revalidation; null if missing. No-op (returns row) when already terminal.
 */
export async function cancelCodeLitSearchRunAsAdmin(
  runRecordId: string,
): Promise<CodeLitSearchRunRecord | null> {
  const pb = await createAdminClient();
  let row: CodeLitSearchRunRecord;
  try {
    row = await pb
      .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
      .getOne(runRecordId);
  } catch {
    return null;
  }
  if (row.status !== 'running') return row;
  await pb.collection('codeLitSearchRuns').update(runRecordId, {
    status: 'cancelled',
    finishedAt: Date.now(),
    errorMessage: '',
  });
  if (row.runId) await maybeFinalizeCodeLitSearchRun(row.runId);
  return row;
}

export async function attachPipelineRunToCodeLitSearchRunsAsAdmin(
  runRecordIds: string[],
  runId: string,
): Promise<void> {
  if (runRecordIds.length === 0) return;
  const pb = await createAdminClient();
  await Promise.all(
    runRecordIds.map((id) => pb.collection('codeLitSearchRuns').update(id, { runId })),
  );
}

/**
 * Wipe every `codeLitSearchRuns` row for a whole specialty. Part of the
 * clean-slate cascade when code extraction is re-run.
 */
export async function deleteCodeLitSearchRunsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('codeLitSearchRuns').delete(r.id)));
}
