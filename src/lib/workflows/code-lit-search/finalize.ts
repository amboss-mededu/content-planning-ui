/**
 * Pipeline-run/stage finalization for the code/topic-level lit-search callback
 * flow. Mirror of literature-search/finalize.ts, keyed on `codeLitSearchRuns`.
 *
 * Each code's run reaches a terminal state when its callback lands. The stage +
 * top-level pipeline run close only once every claimed code is terminal, so the
 * callback calls this after each write; it's a no-op until the last code resolves.
 */

import 'server-only';

import { createAdminClient } from '@/lib/pb/server';
import type { CodeLitSearchRunRecord } from '@/lib/pb/types';
import {
  markStageCompleted,
  markStageFailed,
  updatePipelineRunStatus,
} from '../lib/db-writes';

export async function maybeFinalizeCodeLitSearchRun(runId: string): Promise<void> {
  if (!runId) return;
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeLitSearchRunRecord>('codeLitSearchRuns')
    .getFullList({ filter: `runId = "${runId}"` });

  if (rows.length === 0) return;
  if (rows.some((r) => r.status === 'running')) return;

  const succeeded = rows.filter((r) => r.status === 'completed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const sources = rows.reduce((sum, r) => sum + (r.sourcesCount ?? 0), 0);
  const stage = 'literature_search' as const;

  if (succeeded > 0) {
    await markStageCompleted(runId, stage, undefined, {
      codes: rows.length,
      succeeded,
      failed,
      sources,
    });
    await updatePipelineRunStatus(runId, 'completed');
  } else {
    const msg = `Literature search failed for all ${failed} code(s).`;
    await markStageFailed(runId, stage, msg);
    await updatePipelineRunStatus(runId, 'failed', msg);
  }
}
