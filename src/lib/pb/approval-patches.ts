import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';

/**
 * Pure helpers backing `useApprovalState`. Kept separate from the hook
 * so tests can import them without dragging in the client/server-action
 * transitive deps (the hook imports server actions, which pull in
 * `server-only` and break vitest in node env).
 */

type ReviewStatus = 'approved' | 'rejected';

export type ReviewPatch = {
  collection: 'articleReviews' | 'sectionReviews';
  key: string;
  /** null = tombstone (treat as if the live row doesn't exist).
   *  status = synthetic override (force this status until the live row
   *  catches up or the patch is dropped). */
  override: ReviewStatus | null;
  appliedAt: number;
};

export type BacklogPatch = {
  key: string;
  /** null = tombstone. Object = synthetic backlog row of this type. */
  override: { type: 'new' | 'update' } | null;
  appliedAt: number;
};

export const APPROVAL_PATCH_TTL_MS = 6000;

export function applyReviewPatches<R extends ArticleReviewRecord | SectionReviewRecord>(
  collection: 'articleReviews' | 'sectionReviews',
  liveRows: R[],
  patches: ReviewPatch[],
  keyOf: (r: R) => string,
): R[] {
  const relevant = patches.filter((p) => p.collection === collection && p.key);
  if (relevant.length === 0) return liveRows;
  const latest = new Map<string, ReviewPatch>();
  for (const p of relevant) {
    const prior = latest.get(p.key);
    if (!prior || p.appliedAt >= prior.appliedAt) latest.set(p.key, p);
  }
  const out: R[] = [];
  const seen = new Set<string>();
  for (const row of liveRows) {
    const k = keyOf(row);
    if (k) seen.add(k);
    const p = k ? latest.get(k) : undefined;
    if (!p) {
      out.push(row);
      continue;
    }
    if (p.override === null) continue;
    out.push({ ...row, status: p.override });
  }
  for (const [k, p] of latest.entries()) {
    if (seen.has(k)) continue;
    if (p.override === null) continue;
    out.push(synthesizeReviewRow(collection, k, p.override) as R);
  }
  return out;
}

export function applyBacklogPatches(
  liveRows: ArticleBacklogRecord[],
  patches: BacklogPatch[],
): ArticleBacklogRecord[] {
  const relevant = patches.filter((p) => p.key);
  if (relevant.length === 0) return liveRows;
  const latest = new Map<string, BacklogPatch>();
  for (const p of relevant) {
    const prior = latest.get(p.key);
    if (!prior || p.appliedAt >= prior.appliedAt) latest.set(p.key, p);
  }
  const out: ArticleBacklogRecord[] = [];
  const seen = new Set<string>();
  for (const row of liveRows) {
    const k = row.articleKey;
    if (k) seen.add(k);
    const p = k ? latest.get(k) : undefined;
    if (!p) {
      out.push(row);
      continue;
    }
    if (p.override === null) continue;
    out.push({ ...row, type: p.override.type });
  }
  for (const [k, p] of latest.entries()) {
    if (seen.has(k)) continue;
    if (p.override === null) continue;
    out.push(synthesizeBacklogRow(k, p.override.type));
  }
  return out;
}

/**
 * Reconcile review patches against the current live arrays. A patch is
 * dropped when the live state has caught up to what the patch was
 * expressing — never before. That's the difference from the old
 * "drop on server-action response" model, which raced PB realtime and
 * caused approved rows to briefly revert.
 *
 * Rules:
 * - Status-override patch + matching live row exists with matching
 *   status → drop the patch (realtime delivered the write).
 * - Tombstone patch + no matching live row exists → drop the patch
 *   (realtime delivered the delete).
 * - Otherwise → keep the patch.
 *
 * `keyOf` is the same row-key extractor the caller uses with
 * `applyReviewPatches`.
 */
export function reconcileReviewPatches<
  R extends ArticleReviewRecord | SectionReviewRecord,
>(
  collection: 'articleReviews' | 'sectionReviews',
  patches: ReviewPatch[],
  liveRows: R[],
  keyOf: (r: R) => string,
): ReviewPatch[] {
  if (patches.length === 0) return patches;
  const liveByKey = new Map<string, R>();
  for (const row of liveRows) {
    const k = keyOf(row);
    if (k) liveByKey.set(k, row);
  }
  const next = patches.filter((p) => {
    if (p.collection !== collection) return true;
    const live = liveByKey.get(p.key);
    if (p.override === null) {
      // Tombstone: keep until the live row is actually gone.
      return live !== undefined;
    }
    // Status override: keep until the live row exists and matches.
    if (!live) return true;
    return live.status !== p.override;
  });
  return next.length === patches.length ? patches : next;
}

/**
 * Backlog version of `reconcileReviewPatches`. Status patches use the
 * row's `type` field as the convergence signal; tombstones converge
 * when the live row disappears.
 */
export function reconcileBacklogPatches(
  patches: BacklogPatch[],
  liveRows: ArticleBacklogRecord[],
): BacklogPatch[] {
  if (patches.length === 0) return patches;
  const liveByKey = new Map<string, ArticleBacklogRecord>();
  for (const row of liveRows) {
    if (row.articleKey) liveByKey.set(row.articleKey, row);
  }
  const next = patches.filter((p) => {
    const live = liveByKey.get(p.key);
    if (p.override === null) {
      return live !== undefined;
    }
    if (!live) return true;
    return live.type !== p.override.type;
  });
  return next.length === patches.length ? patches : next;
}

export function dropExpiredPatches<P extends { appliedAt: number }>(
  patches: P[],
  now: number,
  ttlMs: number = APPROVAL_PATCH_TTL_MS,
): P[] {
  const cutoff = now - ttlMs;
  const next = patches.filter((p) => p.appliedAt >= cutoff);
  return next.length === patches.length ? patches : next;
}

function synthesizeReviewRow(
  collection: 'articleReviews' | 'sectionReviews',
  key: string,
  status: ReviewStatus,
): ArticleReviewRecord | SectionReviewRecord {
  const id = `__pending::${collection}::${key}`;
  const base = {
    id,
    collectionId: collection,
    collectionName: collection,
    created: '',
    updated: '',
    specialtySlug: '',
    status,
    reviewerEmail: '',
    reviewedAt: Date.now(),
    notes: '',
  };
  if (collection === 'articleReviews') {
    return {
      ...base,
      articleKey: key,
      articleRecordId: '',
    } as unknown as ArticleReviewRecord;
  }
  return {
    ...base,
    sectionKey: key,
    sectionRecordId: '',
  } as unknown as SectionReviewRecord;
}

function synthesizeBacklogRow(key: string, type: 'new' | 'update'): ArticleBacklogRecord {
  return {
    id: `__pending::articleBacklog::${key}`,
    collectionId: 'articleBacklog',
    collectionName: 'articleBacklog',
    created: '',
    updated: '',
    specialtySlug: '',
    articleKey: key,
    articleRecordId: '',
    type,
    status: 'waiting-for-sources',
    assigneeEmail: '',
    lastChangedByEmail: '',
    lastChangedAt: Date.now(),
    notes: '',
  } as unknown as ArticleBacklogRecord;
}
