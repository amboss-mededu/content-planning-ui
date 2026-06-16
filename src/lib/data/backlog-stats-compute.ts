import { statusBucket } from '@/app/planning/_components/backlog-constants';
import type { ArticleBacklogRecord } from '@/lib/pb/types';

/** Per-stage breakdown split by backlog item type. */
export interface BacklogStageCounts {
  new: number;
  update: number;
  total: number;
}

export interface BacklogStats {
  // Totals over every backlog row (a row exists iff the item was approved).
  total: number;
  newArticles: number; // type 'new' (the schema default)
  articleUpdates: number; // type 'update'

  // Pipeline-stage distribution, using the same 3-bucket collapse the badges
  // show (see `statusBucket` in backlog-constants).
  chooseSources: BacklogStageCounts;
  drafted: BacklogStageCounts;
  published: BacklogStageCounts;
}

/** A row counts as an update only when explicitly typed `'update'`; everything
 *  else (including a missing `type`) is a new article, matching the schema
 *  default and the `ArticleBacklogType` contract. */
function isUpdate(row: ArticleBacklogRecord): boolean {
  return row.type === 'update';
}

function emptyStage(): BacklogStageCounts {
  return { new: 0, update: 0, total: 0 };
}

/**
 * Per-specialty backlog statistics. The `articleBacklog` collection is the
 * approved-items table — a row only exists once a new article or section update
 * has been approved — so these counts double as "approved new articles" /
 * "article updates" and the per-stage distribution comes from the very same
 * rows. Side-effect-free so it can be unit-tested without a PocketBase
 * connection.
 */
export function computeBacklogStats(rows: ArticleBacklogRecord[]): BacklogStats {
  const chooseSources = emptyStage();
  const drafted = emptyStage();
  const published = emptyStage();
  let newArticles = 0;
  let articleUpdates = 0;

  for (const row of rows) {
    const update = isUpdate(row);
    if (update) articleUpdates++;
    else newArticles++;

    const bucket =
      statusBucket(row.status) === 'drafted'
        ? drafted
        : statusBucket(row.status) === 'published'
          ? published
          : chooseSources;
    bucket.total++;
    if (update) bucket.update++;
    else bucket.new++;
  }

  return {
    total: rows.length,
    newArticles,
    articleUpdates,
    chooseSources,
    drafted,
    published,
  };
}
