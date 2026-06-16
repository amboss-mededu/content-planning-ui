import 'server-only';

import { connection } from 'next/server';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import {
  type BacklogStageCounts,
  type BacklogStats,
  computeBacklogStats,
} from '@/lib/data/backlog-stats-compute';

export type { BacklogStageCounts, BacklogStats };

/**
 * Per-specialty backlog statistics. Reads the `articleBacklog` collection (the
 * approved-items table — a row exists only once a new article or section update
 * is approved) and delegates to the pure `computeBacklogStats`. At the
 * low-thousands scale this single scan stays well under a second (same
 * assumption as `getCoverageStats` / `getOverviewCounts`).
 */
export async function getBacklogStats(slug: string): Promise<BacklogStats> {
  await connection();
  const rows = await listArticleBacklog(slug);
  return computeBacklogStats(Object.values(rows));
}
