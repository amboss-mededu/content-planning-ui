/**
 * Pipeline-run/stage finalization for the async n8n callback flow.
 *
 * Each article's `articleLitSearchRuns` row reaches a terminal state
 * (`completed` or `failed`) when its callback lands. The stage row +
 * top-level pipeline run can only be closed once every claimed article
 * is terminal — so the callback handler calls `maybeFinalizePipelineRun`
 * after each write, and the helper is a no-op until the last article
 * resolves.
 */

import 'server-only';

import { createAdminClient } from '@/lib/pb/server';
import type { ArticleLitSearchRunRecord } from '@/lib/pb/types';
import {
  markStageCompleted,
  markStageFailed,
  updatePipelineRunStatus,
} from '../lib/db-writes';

export async function maybeFinalizePipelineRun(runId: string): Promise<void> {
  if (!runId) return;
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ArticleLitSearchRunRecord>('articleLitSearchRuns')
    .getFullList({ filter: `runId = "${runId}"` });

  if (rows.length === 0) return;
  const anyRunning = rows.some((r) => r.status === 'running');
  if (anyRunning) return;

  const succeeded = rows.filter((r) => r.status === 'completed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const sources = rows.reduce((sum, r) => sum + (r.sourcesCount ?? 0), 0);
  const stage = 'literature_search' as const;

  if (succeeded > 0) {
    await markStageCompleted(runId, stage, undefined, {
      articles: rows.length,
      succeeded,
      failed,
      sources,
    });
    await updatePipelineRunStatus(runId, 'completed');
  } else {
    const msg = `Literature search failed for all ${failed} article(s).`;
    await markStageFailed(runId, stage, msg);
    await updatePipelineRunStatus(runId, 'failed', msg);
  }
}
