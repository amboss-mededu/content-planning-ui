'use server';

import { updateTag } from 'next/cache';
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
  getConsolidatedSectionParentArticleId,
  hasOtherApprovedSectionsForParent,
} from '@/lib/data/sections';
import {
  setPipelineStageOverride as setPipelineStageOverrideData,
  setPipelineStageSkipped as setPipelineStageSkippedData,
  setTabOverride as setTabOverrideData,
} from '@/lib/data/specialties';
import type {
  ArticleBacklogStatus,
  ArticleReviewStatus,
  ConsolidationCategoryReviewStatus,
  ReviewCommentRecord,
  ReviewRecordKind,
} from '@/lib/pb/types';

export async function refreshSpecialty(slug: string) {
  updateTag(`specialty:${slug}`);
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
): Promise<void> {
  const user = await getCurrentUser();
  // Approve only. Backlog creation is an explicit, separate action
  // (see `bulkApproveAndBacklogArticleReviews`); approving here makes
  // the row visible on /articles but doesn't queue it.
  await setArticleReview(
    slug,
    articleKey,
    articleRecordId,
    status,
    user?.email ?? null,
    notes,
  );
  updateTag(`specialty:${slug}`);
}

export async function resetArticleReview(
  slug: string,
  articleKey: string,
): Promise<void> {
  await clearArticleReview(slug, articleKey);
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
): Promise<void> {
  if (rows.length === 0) return;
  const user = await getCurrentUser();
  for (const r of rows) {
    await setArticleReview(
      slug,
      r.articleKey,
      r.articleRecordId,
      'approved',
      user?.email ?? null,
    );
  }
  updateTag(`specialty:${slug}`);
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
): Promise<void> {
  if (rows.length === 0) return;
  const user = await getCurrentUser();
  for (const r of rows) {
    await setArticleReview(
      slug,
      r.articleKey,
      r.articleRecordId,
      'approved',
      user?.email ?? null,
    );
    await ensureNewArticleBacklogRow(
      slug,
      r.articleKey,
      r.articleRecordId,
      user?.email ?? null,
    );
  }
  updateTag(`specialty:${slug}`);
}

export async function submitSectionReview(
  slug: string,
  sectionKey: string,
  sectionRecordId: string,
  status: ArticleReviewStatus,
  notes?: string,
): Promise<void> {
  const user = await getCurrentUser();
  // Approve only. Backlog creation for the parent article is handled
  // explicitly by `bulkApproveAndBacklogSectionReviews`.
  await setSectionReview(
    slug,
    sectionKey,
    sectionRecordId,
    status,
    user?.email ?? null,
    notes,
  );
  updateTag(`specialty:${slug}`);
}

export async function bulkApproveSectionReviews(
  slug: string,
  rows: Array<{ sectionKey: string; sectionRecordId: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  const user = await getCurrentUser();
  for (const r of rows) {
    await setSectionReview(
      slug,
      r.sectionKey,
      r.sectionRecordId,
      'approved',
      user?.email ?? null,
    );
  }
  updateTag(`specialty:${slug}`);
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
): Promise<void> {
  if (rows.length === 0) return;
  const user = await getCurrentUser();
  for (const r of rows) {
    await setSectionReview(
      slug,
      r.sectionKey,
      r.sectionRecordId,
      'approved',
      user?.email ?? null,
    );
    const parentArticleId = await getConsolidatedSectionParentArticleId(
      r.sectionRecordId,
    );
    if (parentArticleId) {
      await ensureUpdateBacklogRow(slug, parentArticleId, user?.email ?? null);
    }
  }
  updateTag(`specialty:${slug}`);
}

/**
 * Bulk-unapprove a batch of new-article rows. For each row: drop the
 * `articleReviews` row and remove the corresponding `articleBacklog`
 * entry. Mirrors the approve path's pairing but in reverse.
 */
export async function bulkUnapproveArticleReviews(
  slug: string,
  rows: Array<{ articleKey: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  for (const r of rows) {
    await clearArticleReview(slug, r.articleKey);
    await clearArticleBacklog(slug, r.articleKey);
  }
  updateTag(`specialty:${slug}`);
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
): Promise<void> {
  if (rows.length === 0) return;
  for (const r of rows) {
    const parentArticleId = await getConsolidatedSectionParentArticleId(
      r.sectionRecordId,
    );
    await clearSectionReview(slug, r.sectionKey);
    if (parentArticleId) {
      const stillHasApproved = await hasOtherApprovedSectionsForParent(
        slug,
        parentArticleId,
        r.sectionRecordId,
      );
      if (!stillHasApproved) {
        await clearUpdateBacklogRow(slug, parentArticleId);
      }
    }
  }
  updateTag(`specialty:${slug}`);
}

export async function resetSectionReview(
  slug: string,
  sectionKey: string,
  sectionRecordId: string,
): Promise<void> {
  const parentArticleId = await getConsolidatedSectionParentArticleId(sectionRecordId);
  await clearSectionReview(slug, sectionKey);
  if (parentArticleId) {
    const stillHasApproved = await hasOtherApprovedSectionsForParent(
      slug,
      parentArticleId,
      sectionRecordId,
    );
    if (!stillHasApproved) {
      await clearUpdateBacklogRow(slug, parentArticleId);
    }
  }
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
}

export async function clearBacklogRow(slug: string, articleKey: string): Promise<void> {
  await clearArticleBacklog(slug, articleKey);
  updateTag(`specialty:${slug}`);
}

/**
 * Wipe every derived pipeline artifact for one article and return it
 * to phase 1 (`waiting-for-sources`). Keeps `newArticleSuggestions` and
 * the `consolidatedArticles` representation; preserves the backlog
 * row's assignee so the article doesn't disappear from `/my-backlog`.
 *
 * Order: writing runs (cascade drafts) → sources → comments → article
 * review → backlog status. Drafts come first so a mid-cascade failure
 * doesn't leave orphaned children pointing at deleted parents.
 */
export async function resetArticle(
  slug: string,
  articleKey: string,
  articleRecordId: string,
): Promise<void> {
  const user = await getCurrentUser();
  await deleteWritingRunsForArticleAsAdmin(slug, articleRecordId);
  await deleteArticleSourcesByArticleKeyAsAdmin(slug, articleKey);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
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
  updateTag(`specialty:${slug}`);
}

const KNOWN_PIPELINE_STAGES = new Set([
  'extract_codes',
  'extract_milestones',
  'map_codes',
  'consolidate_primary',
  'consolidate_articles',
  'consolidate_sections',
  'literature_search',
]);

export async function setPipelineStageOverride(
  slug: string,
  stageName: string,
  value: boolean,
): Promise<void> {
  if (!KNOWN_PIPELINE_STAGES.has(stageName)) {
    throw new Error(`Unknown pipeline stage: ${stageName}`);
  }
  await setPipelineStageOverrideData(slug, stageName, value);
  updateTag(`specialty:${slug}`);
}

export async function setPipelineStageSkipped(
  slug: string,
  stageName: string,
  value: boolean,
): Promise<void> {
  if (!KNOWN_PIPELINE_STAGES.has(stageName)) {
    throw new Error(`Unknown pipeline stage: ${stageName}`);
  }
  await setPipelineStageSkippedData(slug, stageName, value);
  updateTag(`specialty:${slug}`);
}
