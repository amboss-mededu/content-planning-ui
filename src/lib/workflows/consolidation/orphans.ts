/**
 * Orphan detection for preserve-mode re-runs.
 *
 * A per-bucket re-run deletes the producer rows (consolidated articles/
 * sections) and regenerates them. Editorial work — backlog rows (assignee,
 * status, draft-folder pointer), approvals, sources — is keyed by stable
 * `articleKey`/`sectionKey` and re-attaches when the re-run reproduces the
 * same key. When a re-run produces a *different* key (e.g. the consolidated
 * title changed materially), the old backlog row survives in the DB but no
 * longer matches any current consolidated output: it becomes an orphan.
 *
 * Rather than delete it (the old destructive behavior), we surface it as a
 * warning so an editor can decide whether to keep the work, re-point it, or
 * clear it. This module is pure so it can be unit-tested without PocketBase.
 */

export type BacklogOrphanInput = {
  articleKey: string;
  type?: string;
  status?: string;
  assigneeEmail?: string;
  draftFolderUrl?: string;
};

export type BacklogOrphan = {
  articleKey: string;
  type: 'new' | 'update';
  status?: string;
  assigneeEmail?: string;
  hasDraftFolder: boolean;
};

/**
 * Return the backlog rows whose `articleKey` is not in the set of keys the
 * current consolidation output produces — i.e. orphaned by a re-run.
 *
 * @param backlog            all articleBacklog rows for the specialty
 * @param currentArticleKeys keys produced by the current consolidated
 *                           output (new-article keys + `upd::<id>` keys)
 */
export function computeBacklogOrphans(
  backlog: BacklogOrphanInput[],
  currentArticleKeys: Set<string>,
): BacklogOrphan[] {
  const orphans: BacklogOrphan[] = [];
  for (const row of backlog) {
    if (!row.articleKey) continue;
    if (currentArticleKeys.has(row.articleKey)) continue;
    orphans.push({
      articleKey: row.articleKey,
      type: row.type === 'update' ? 'update' : 'new',
      status: row.status,
      assigneeEmail: row.assigneeEmail || undefined,
      hasDraftFolder: Boolean(row.draftFolderUrl),
    });
  }
  return orphans;
}
