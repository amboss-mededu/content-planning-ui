'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import {
  clearArticleBacklog,
  clearUpdateBacklogRow,
  ensureNewArticleBacklogRow,
  ensureUpdateBacklogRow,
  resetArticleBacklogStatusAsAdmin,
  setArticleBacklogAssignee,
  setArticleBacklogStatus,
} from '@/lib/data/article-backlog';
import { deleteArticleLitSearchRunsByArticleKeyAsAdmin } from '@/lib/data/article-lit-search-runs';
import { clearArticleReview, setArticleReview } from '@/lib/data/article-reviews';
import {
  deleteArticleSourcesByArticleKeyAsAdmin,
  markSourceCortexRegisteredAsAdmin,
  setArticleSourceReviewAsAdmin,
  setSourcesPriorityAsAdmin,
} from '@/lib/data/article-sources';
import {
  deleteWritingRunsForArticleAsAdmin,
  listDraftsForArticle,
} from '@/lib/data/article-writing';
import {
  type BucketCode,
  listBucketCodes as listBucketCodesData,
} from '@/lib/data/categories';
import { setConsolidationCategoryReview as setConsolidationCategoryReviewData } from '@/lib/data/consolidation-category-reviews';
import {
  addReviewComment,
  deleteReviewComment,
  deleteReviewCommentsForArticleAsAdmin,
} from '@/lib/data/review-comments';
import { clearSectionReview, setSectionReview } from '@/lib/data/section-reviews';
import {
  clearApprovedSectionReviewsForParent,
  getConsolidatedSectionParentArticleId,
  hasOtherApprovedSectionsForParent,
} from '@/lib/data/sections';
import {
  setPipelineStageState as setPipelineStageStateData,
  setTabOverride as setTabOverrideData,
} from '@/lib/data/specialties';
import type {
  ArticleBacklogStatus,
  ArticleReviewStatus,
  ConsolidationCategoryReviewStatus,
  ReviewCommentRecord,
  ReviewRecordKind,
} from '@/lib/pb/types';
import {
  canSkipPipelineStage,
  isPipelineCardState,
  isPipelineStageName,
  type PipelineCardState,
} from '@/lib/pipeline-stage-state';
import type { ApprovalActionResult } from './actions.types';

// Re-exported so consumers can keep importing the type from the actions
// module if convenient. The canonical definition lives in
// `./actions.types` to stay importable from non-server code.
export type { ApprovalActionResult };

function emptyResult(): ApprovalActionResult {
  return { articleReviewKeys: [], sectionReviewKeys: [], backlogKeys: [] };
}

export async function refreshSpecialty(slug: string) {
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function listBucketCodes(
  slug: string,
  bucket: string,
): Promise<BucketCode[]> {
  return listBucketCodesData(slug, bucket);
}

export async function submitArticleReview(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  status: ArticleReviewStatus,
  notes?: string,
): Promise<ApprovalActionResult> {
  const user = await getCurrentUser();
  const reviewKey = await setArticleReview(
    slug,
    articleKey,
    articleRecordId,
    status,
    user?.email ?? null,
    notes,
  );
  const result = emptyResult();
  result.articleReviewKeys.push(reviewKey);
  if (status === 'approved') {
    const ensuredKey = await ensureNewArticleBacklogRow(
      slug,
      articleKey,
      articleRecordId,
      user?.email ?? null,
    );
    if (ensuredKey) result.backlogKeys.push(ensuredKey);
  } else {
    const clearedKey = await clearArticleBacklog(slug, articleKey);
    if (clearedKey) result.backlogKeys.push(clearedKey);
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

export async function resetArticleReview(
  slug: string,
  articleKey: string,
): Promise<ApprovalActionResult> {
  const reviewKey = await clearArticleReview(slug, articleKey);
  const backlogKey = await clearArticleBacklog(slug, articleKey);
  const result = emptyResult();
  if (reviewKey) result.articleReviewKeys.push(reviewKey);
  if (backlogKey) result.backlogKeys.push(backlogKey);
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

/**
 * Per-source editor decision. Pass `status: null` to clear the
 * decision. Reviewer email is taken from the current session.
 */
export async function submitSourceReview(
  slug: string,
  sourceId: string,
  status: 'approved' | 'rejected' | null,
): Promise<void> {
  const user = await getCurrentUser();
  await setArticleSourceReviewAsAdmin(sourceId, status, user?.email ?? '');
  revalidatePath(`/planning/${slug}`, 'layout');
}

/**
 * Persist editor-chosen ordering for the approved sources of an
 * article. Array order maps to `priority` 1..N.
 */
export async function submitSourcesOrder(
  slug: string,
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  await setSourcesPriorityAsAdmin(sourceIds);
  revalidatePath(`/planning/${slug}`, 'layout');
}

/**
 * Manually set the Cortex source ID on a single source row. Used as a
 * temporary editor escape hatch until automated Cortex registration
 * lands. Pass an empty string to clear.
 */
export async function submitSourceCortexId(
  slug: string,
  sourceId: string,
  value: string,
): Promise<void> {
  await markSourceCortexRegisteredAsAdmin(sourceId, value);
  revalidatePath(`/planning/${slug}`, 'layout');
}

/**
 * Return the most recent completed `copy` (final) pass output for an
 * article, or null if no completed run exists yet. Used by the modal's
 * draft-preview panel (phases 5-7). Cheap — one PB filter query.
 */
export async function getLatestDraftForArticle(
  slug: string,
  articleRecordId: string,
): Promise<{ pass: string; output: string; finishedAt?: number } | null> {
  const drafts = await listDraftsForArticle(slug, articleRecordId);
  // listDraftsForArticle returns rows sorted by -startedAt; pick the most
  // recent completed run's final pass.
  const copyPass = drafts.find((d) => d.pass === 'copy' && d.status === 'completed');
  if (copyPass?.output) {
    return {
      pass: copyPass.pass,
      output: copyPass.output,
      finishedAt: copyPass.finishedAt,
    };
  }
  // Fallback: any completed pass with output (the writer may have stopped
  // before the copy pass if earlier passes failed).
  const anyCompleted = drafts.find((d) => d.status === 'completed' && d.output);
  if (anyCompleted?.output) {
    return {
      pass: anyCompleted.pass,
      output: anyCompleted.output,
      finishedAt: anyCompleted.finishedAt,
    };
  }
  return null;
}

/**
 * Bulk-approve a batch of consolidatedArticles rows. The caller is
 * responsible for computing each row's `articleKey` (so the action
 * stays a thin transport — no key-derivation logic in the server
 * action layer).
 */
export async function bulkApproveArticleReviews(
  slug: string,
  rows: Array<{ articleKey: string; articleRecordId: string }>,
): Promise<ApprovalActionResult> {
  const result = emptyResult();
  if (rows.length === 0) return result;
  const user = await getCurrentUser();
  for (const r of rows) {
    const reviewKey = await setArticleReview(
      slug,
      r.articleKey,
      r.articleRecordId,
      'approved',
      user?.email ?? null,
    );
    result.articleReviewKeys.push(reviewKey);
    const ensuredKey = await ensureNewArticleBacklogRow(
      slug,
      r.articleKey,
      r.articleRecordId,
      user?.email ?? null,
    );
    if (ensuredKey) result.backlogKeys.push(ensuredKey);
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

/**
 * Approve + queue: a single click that approves the rows AND creates
 * the corresponding `articleBacklog` row (`type='new'`). For when the
 * editor knows the items are queue-ready and wants to skip the extra
 * "Send to backlog" step on the suggested-articles view.
 */
export async function bulkApproveAndBacklogArticleReviews(
  slug: string,
  rows: Array<{ articleKey: string; articleRecordId: string }>,
): Promise<ApprovalActionResult> {
  return bulkApproveArticleReviews(slug, rows);
}

export async function submitSectionReview(
  slug: string,
  sectionKey: string,
  sectionRecordId: string,
  status: ArticleReviewStatus,
  notes?: string,
): Promise<ApprovalActionResult> {
  const user = await getCurrentUser();
  const reviewKey = await setSectionReview(
    slug,
    sectionKey,
    sectionRecordId,
    status,
    user?.email ?? null,
    notes,
  );
  const result = emptyResult();
  result.sectionReviewKeys.push(reviewKey);
  const parentArticleId = await getConsolidatedSectionParentArticleId(sectionRecordId);
  if (status === 'approved') {
    if (parentArticleId) {
      const ensuredKey = await ensureUpdateBacklogRow(
        slug,
        parentArticleId,
        user?.email ?? null,
      );
      result.backlogKeys.push(ensuredKey);
    }
  } else if (parentArticleId) {
    const stillHasApproved = await hasOtherApprovedSectionsForParent(
      slug,
      parentArticleId,
      sectionKey,
    );
    if (!stillHasApproved) {
      const clearedKey = await clearUpdateBacklogRow(slug, parentArticleId);
      if (clearedKey) result.backlogKeys.push(clearedKey);
    }
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

export async function bulkApproveSectionReviews(
  slug: string,
  rows: Array<{ sectionKey: string; sectionRecordId: string }>,
): Promise<ApprovalActionResult> {
  const result = emptyResult();
  if (rows.length === 0) return result;
  const user = await getCurrentUser();
  const seenBacklogKeys = new Set<string>();
  for (const r of rows) {
    const reviewKey = await setSectionReview(
      slug,
      r.sectionKey,
      r.sectionRecordId,
      'approved',
      user?.email ?? null,
    );
    result.sectionReviewKeys.push(reviewKey);
    const parentArticleId = await getConsolidatedSectionParentArticleId(
      r.sectionRecordId,
    );
    if (parentArticleId) {
      const ensuredKey = await ensureUpdateBacklogRow(
        slug,
        parentArticleId,
        user?.email ?? null,
      );
      if (!seenBacklogKeys.has(ensuredKey)) {
        seenBacklogKeys.add(ensuredKey);
        result.backlogKeys.push(ensuredKey);
      }
    }
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

/**
 * Approve + queue for sections. For each row: approve, then ensure a
 * `type='update'` `articleBacklog` row exists for the parent article
 * (the section's `parentArticleId`). One backlog row covers all
 * approved sections under the same parent.
 */
export async function bulkApproveAndBacklogSectionReviews(
  slug: string,
  rows: Array<{ sectionKey: string; sectionRecordId: string }>,
): Promise<ApprovalActionResult> {
  return bulkApproveSectionReviews(slug, rows);
}

/**
 * Bulk-unapprove a batch of new-article rows. For each row: drop the
 * `articleReviews` row and remove the corresponding `articleBacklog`
 * entry. Mirrors the approve path's pairing but in reverse.
 */
export async function bulkUnapproveArticleReviews(
  slug: string,
  rows: Array<{ articleKey: string }>,
): Promise<ApprovalActionResult> {
  const result = emptyResult();
  if (rows.length === 0) return result;
  for (const r of rows) {
    const reviewKey = await clearArticleReview(slug, r.articleKey);
    if (reviewKey) result.articleReviewKeys.push(reviewKey);
    const backlogKey = await clearArticleBacklog(slug, r.articleKey);
    if (backlogKey) result.backlogKeys.push(backlogKey);
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

/**
 * Bulk-unapprove a batch of section rows. For each row, mirror the
 * single-row `resetSectionReview` logic: clear the review, then drop
 * the parent article's `articleBacklog` (`type='update'`) row only if
 * no other approved siblings remain under the same parent.
 */
export async function bulkUnapproveSectionReviews(
  slug: string,
  rows: Array<{ sectionKey: string; sectionRecordId: string }>,
): Promise<ApprovalActionResult> {
  const result = emptyResult();
  if (rows.length === 0) return result;
  const seenBacklogKeys = new Set<string>();
  for (const r of rows) {
    const parentArticleId = await getConsolidatedSectionParentArticleId(
      r.sectionRecordId,
    );
    const reviewKey = await clearSectionReview(slug, r.sectionKey);
    if (reviewKey) result.sectionReviewKeys.push(reviewKey);
    if (parentArticleId) {
      const stillHasApproved = await hasOtherApprovedSectionsForParent(
        slug,
        parentArticleId,
        r.sectionKey,
      );
      if (!stillHasApproved) {
        const clearedKey = await clearUpdateBacklogRow(slug, parentArticleId);
        if (clearedKey && !seenBacklogKeys.has(clearedKey)) {
          seenBacklogKeys.add(clearedKey);
          result.backlogKeys.push(clearedKey);
        }
      }
    }
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

export async function resetSectionReview(
  slug: string,
  sectionKey: string,
  sectionRecordId: string,
): Promise<ApprovalActionResult> {
  const result = emptyResult();
  const parentArticleId = await getConsolidatedSectionParentArticleId(sectionRecordId);
  const reviewKey = await clearSectionReview(slug, sectionKey);
  if (reviewKey) result.sectionReviewKeys.push(reviewKey);
  if (parentArticleId) {
    const stillHasApproved = await hasOtherApprovedSectionsForParent(
      slug,
      parentArticleId,
      sectionKey,
    );
    if (!stillHasApproved) {
      const clearedKey = await clearUpdateBacklogRow(slug, parentArticleId);
      if (clearedKey) result.backlogKeys.push(clearedKey);
    }
  }
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

export async function postReviewComment(
  slug: string,
  kind: ReviewRecordKind,
  recordKey: string,
  recordId: string,
  body: string,
): Promise<ReviewCommentRecord> {
  const user = await getCurrentUser();
  const created = await addReviewComment(
    slug,
    kind,
    recordKey,
    recordId,
    user?.email ?? null,
    body,
  );
  revalidatePath(`/planning/${slug}`, 'layout');
  return created;
}

/** Delete a comment by id. PB enforces author-match via the
 *  collection's deleteRule, so a stale viewer email here can't be
 *  used to delete someone else's comment — the request will 403. */
export async function deleteOwnReviewComment(
  slug: string,
  commentId: string,
): Promise<void> {
  await deleteReviewComment(commentId);
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function setBacklogStatus(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  status: ArticleBacklogStatus,
  notes?: string,
): Promise<void> {
  const user = await getCurrentUser();
  await setArticleBacklogStatus(
    slug,
    articleKey,
    articleRecordId,
    status,
    user?.email ?? null,
    notes,
  );
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function setBacklogAssignee(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  assigneeEmail: string | null,
): Promise<void> {
  const user = await getCurrentUser();
  await setArticleBacklogAssignee(
    slug,
    articleKey,
    articleRecordId,
    assigneeEmail,
    user?.email ?? null,
  );
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function clearBacklogRow(
  slug: string,
  articleKey: string,
): Promise<ApprovalActionResult> {
  const result = emptyResult();
  if (articleKey.startsWith('upd::')) {
    const deletedSectionKeys = await clearApprovedSectionReviewsForParent(
      slug,
      articleKey.slice('upd::'.length),
    );
    result.sectionReviewKeys.push(...deletedSectionKeys);
  } else {
    const reviewKey = await clearArticleReview(slug, articleKey);
    if (reviewKey) result.articleReviewKeys.push(reviewKey);
  }
  const backlogKey = await clearArticleBacklog(slug, articleKey);
  if (backlogKey) result.backlogKeys.push(backlogKey);
  revalidatePath(`/planning/${slug}`, 'layout');
  return result;
}

/**
 * Wipe every derived pipeline artifact for one article and return it
 * to phase 1 (`waiting-for-sources`). Keeps `newArticleSuggestions` and
 * the `consolidatedArticles` representation; preserves the backlog
 * row's assignee so the article doesn't disappear from `/my-backlog`.
 *
 * Order: writing runs (cascade drafts) → sources → lit-search runs →
 * comments → backlog status. Drafts come first so a mid-cascade failure
 * doesn't leave orphaned children pointing at deleted parents.
 * `articleLitSearchRuns` rows are wiped so the Phase 1 panel doesn't
 * surface a stale "Last run failed" error from before the reset.
 */
export async function resetArticle(
  slug: string,
  articleKey: string,
  articleRecordId: string,
): Promise<void> {
  const user = await getCurrentUser();
  await deleteWritingRunsForArticleAsAdmin(slug, articleRecordId);
  await deleteArticleSourcesByArticleKeyAsAdmin(slug, articleKey);
  await deleteArticleLitSearchRunsByArticleKeyAsAdmin(slug, articleKey);
  await deleteReviewCommentsForArticleAsAdmin(slug, articleKey);
  // NOTE: do NOT clear `articleReviews` here. The specialty backlog
  // page (`/planning/<slug>/backlog`) gates which articles appear by
  // `articleReviews.status === 'approved'` — deleting that row drops
  // the article out of the backlog entirely. Reset only wipes
  // pipeline-derived state; the editorial approval that put the
  // article into the pipeline stays.
  await resetArticleBacklogStatusAsAdmin(
    slug,
    articleKey,
    articleRecordId,
    'waiting-for-sources',
    user?.email ?? null,
  );
  revalidatePath(`/planning/${slug}`, 'layout');
  // Cross-specialty backlog reads the same data; without this, /my-backlog
  // shows stale sources/status until the user navigates away and back.
  revalidatePath('/my-backlog', 'layout');
}

/**
 * Flag (or clear) a consolidation category as needing the pipeline
 * re-run. `status === null` deletes the row. Used by the Consolidation
 * Review screen — does not touch underlying articleReviews /
 * sectionReviews rows for that category.
 */
export async function setConsolidationCategoryReview(
  slug: string,
  category: string,
  status: ConsolidationCategoryReviewStatus | null,
  notes?: string,
): Promise<void> {
  const user = await getCurrentUser();
  await setConsolidationCategoryReviewData(
    slug,
    category,
    status,
    user?.email ?? null,
    notes,
  );
  revalidatePath(`/planning/${slug}`, 'layout');
}

const KNOWN_TAB_SEGMENTS = new Set([
  '',
  'pipeline',
  'milestones',
  'categories',
  'mapping',
  'consolidation-review',
  'articles',
  'sections',
  'backlog',
]);

export async function setTabOverride(
  slug: string,
  segment: string,
  value: boolean,
): Promise<void> {
  if (!KNOWN_TAB_SEGMENTS.has(segment)) {
    throw new Error(`Unknown tab segment: ${segment}`);
  }
  await setTabOverrideData(slug, segment, value);
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function setPipelineStageState(
  slug: string,
  stageName: string,
  state: PipelineCardState,
): Promise<void> {
  if (!isPipelineStageName(stageName)) {
    throw new Error(`Unknown pipeline stage: ${stageName}`);
  }
  if (!isPipelineCardState(state)) {
    throw new Error(`Unknown pipeline stage state: ${state}`);
  }
  if (state === 'skipped' && !canSkipPipelineStage(stageName)) {
    throw new Error(`Pipeline stage cannot be skipped: ${stageName}`);
  }
  await setPipelineStageStateData(slug, stageName, state);
  revalidatePath(`/planning/${slug}`, 'layout');
}
