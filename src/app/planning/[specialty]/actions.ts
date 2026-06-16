'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import {
  clearArticleBacklog,
  clearArticleBacklogAsAdmin,
  clearUpdateBacklogRow,
  ensureNewArticleBacklogRow,
  ensureNewArticleBacklogRowAsAdmin,
  ensureUpdateBacklogRow,
  resetArticleBacklogStatusAsAdmin,
  setArticleBacklogAssignee,
  setArticleBacklogAssigneeAsAdmin,
  setArticleBacklogDraftFolderUrl,
  setArticleBacklogStatus,
} from '@/lib/data/article-backlog';
import { deleteArticleDraftRunsByArticleKeyAsAdmin } from '@/lib/data/article-draft-runs';
import {
  mergeConsolidatedArticlesAsAdmin,
  renameConsolidatedArticleByKeyAsAdmin,
  setConsolidatedArticleCodesAsAdmin,
} from '@/lib/data/article-edits';
import { computeArticleKey } from '@/lib/data/article-keys';
import { deleteArticleLitSearchRunsByArticleKeyAsAdmin } from '@/lib/data/article-lit-search-runs';
import {
  clearArticleReview,
  clearArticleReviewAsAdmin,
  setArticleReview,
  setArticleReviewAsAdmin,
} from '@/lib/data/article-reviews';
import {
  createArticleSourceAsAdmin,
  deleteArticleSourcesByArticleKeyAsAdmin,
  getArticleSourceByIdAsAdmin,
  markSourceCortexRegisteredAsAdmin,
  setArticleSourceReviewAsAdmin,
  setSourceDoiAsAdmin,
  setSourceNotesAsAdmin,
  setSourcesPriorityAsAdmin,
  setSourceUrlAsAdmin,
  updateSourceBibliographyAsAdmin,
} from '@/lib/data/article-sources';
import {
  deleteWritingRunsForArticleAsAdmin,
  listDraftsForArticle,
} from '@/lib/data/article-writing';
import {
  createManualConsolidatedArticleAsAdmin,
  deleteConsolidatedArticleByKeyAsAdmin,
} from '@/lib/data/articles';
import {
  type BucketCode,
  listBucketCodes as listBucketCodesData,
  listCodesForPicker,
  type PickerCode,
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
  updateMilestonesAsAdmin,
} from '@/lib/data/specialties';
import { errorMessage } from '@/lib/error-message';
import { fetchSourceMetadataViaMcp } from '@/lib/integrations/cortex-mcp';
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
import { isSafeUrl } from '@/lib/url';
import { runCortexRegistrationForSource } from '@/lib/workflows/cortex-register/run';
import type { ApprovalActionResult } from './actions.types';

// NOTE: This file carries the `'use server'` directive, so every *export* must
// be an async server function. Re-exporting the type here (`export type { … }`)
// is erased by TypeScript but the server-action compiler still emits a runtime
// value reference, throwing `ApprovalActionResult is not defined` at load and
// breaking every action in this module. Import the type from `./actions.types`
// directly instead.

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

export async function submitSourceUrl(
  slug: string,
  sourceId: string,
  value: string,
): Promise<void> {
  if (value && !isSafeUrl(value)) {
    throw new Error('URL must start with http:// or https://');
  }
  await setSourceUrlAsAdmin(sourceId, value);
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function submitSourceDoi(
  slug: string,
  sourceId: string,
  value: string,
): Promise<void> {
  await setSourceDoiAsAdmin(sourceId, value);
  revalidatePath(`/planning/${slug}`, 'layout');
}

export async function submitSourceNotes(
  slug: string,
  sourceId: string,
  value: string,
): Promise<void> {
  await setSourceNotesAsAdmin(sourceId, value);
  revalidatePath(`/planning/${slug}`, 'layout');
}

/**
 * Register a single source in Cortex (per-row "Register" button). Creates the
 * source via the MCP `createSourceEnx` tool — enriching from the DOI first —
 * and fills in its Source ID (cortexSourceId + ribosomId).
 */
export async function registerSourceInCortex(
  slug: string,
  sourceId: string,
): Promise<{ ok: boolean; cortexSourceId?: string; error?: string }> {
  const user = await getCurrentUser();
  try {
    const result = await runCortexRegistrationForSource(
      slug,
      sourceId,
      user?.email ?? null,
    );
    revalidatePath(`/planning/${slug}`, 'layout');
    return { ok: true, cortexSourceId: result.cortexSourceId };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Pull bibliographic metadata for a source's DOI (read-only
 * `fetchSourceMetadataEnx`) and overwrite its title + journal. Guarded: only
 * runs when the source has a DOI and has NOT yet been registered in Cortex.
 */
export async function fetchSourceMetadataForSource(
  slug: string,
  sourceId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const source = await getArticleSourceByIdAsAdmin(sourceId);
    if (!source) return { ok: false, error: 'Source not found' };
    if (source.cortexSourceId) {
      return { ok: false, error: 'Already registered — fetch is disabled' };
    }
    const doi = source.doi?.trim();
    if (!doi) return { ok: false, error: 'No DOI on this source' };

    const fields = await fetchSourceMetadataViaMcp(doi);
    if (!fields) return { ok: false, error: 'No metadata found for this DOI' };

    await updateSourceBibliographyAsAdmin(sourceId, {
      title: typeof fields.title === 'string' ? fields.title : undefined,
      journal: typeof fields.journal === 'string' ? fields.journal : undefined,
    });
    revalidatePath(`/planning/${slug}`, 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Manually add a source to an article from the prioritisation step. The
 * editor supplies at least a ribosomId + title; it's created pre-approved
 * and appended to the priority order so it shows up in the draft.
 */
export async function addArticleSource(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  fields: {
    sourceId: string;
    title: string;
    url?: string;
    journal?: string;
    doi?: string;
    sourceType?: string;
  },
): Promise<{ error?: string }> {
  const sourceId = fields.sourceId.trim();
  const title = fields.title.trim();
  if (!sourceId) return { error: 'Source ID is required.' };
  if (!title) return { error: 'Title is required.' };
  const url = fields.url?.trim() ?? '';
  if (url && !isSafeUrl(url)) {
    return { error: 'URL must start with http:// or https://' };
  }
  const user = await getCurrentUser();
  await createArticleSourceAsAdmin(slug, articleRecordId, articleKey, {
    sourceId,
    title,
    url: url || undefined,
    journal: fields.journal?.trim() || undefined,
    doi: fields.doi?.trim() || undefined,
    sourceType: fields.sourceType?.trim() || undefined,
    reviewerEmail: user?.email ?? '',
  });
  revalidatePath(`/planning/${slug}`, 'layout');
  return {};
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

export async function setBacklogDraftFolderUrl(
  slug: string,
  articleKey: string,
  articleRecordId: string,
  draftFolderUrl: string,
): Promise<void> {
  const trimmed = draftFolderUrl.trim();
  // Reject unsafe schemes (e.g. javascript:) — same guard as submitSourceUrl;
  // empty clears the pointer.
  if (trimmed && !isSafeUrl(trimmed)) {
    throw new Error('URL must start with http:// or https://');
  }
  const user = await getCurrentUser();
  await setArticleBacklogDraftFolderUrl(
    slug,
    articleKey,
    articleRecordId,
    trimmed,
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
  await deleteArticleDraftRunsByArticleKeyAsAdmin(slug, articleKey);
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

// Plain-text milestones blob can be larger than a typical form field but is
// still bounded — the ACGME JSON output for a specialty runs tens of KB. Cap
// at 2 MB to reject accidental large pastes/uploads before they hit PB.
const MAX_MILESTONES_BYTES = 2 * 1024 * 1024;

/**
 * Save the milestones text blob for a specialty from the Milestones tab
 * editor (paste or .txt upload). Mirrors `updateMilestonesAsAdmin` but
 * intentionally does NOT bump the seed timestamp — that signals seed
 * lineage, not a manual edit. The extraction workflow remains the only
 * other writer; the editor is disabled UI-side while a run is active.
 */
export async function saveMilestones(
  slug: string,
  text: string,
): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'You must be signed in to edit milestones.' };

  const trimmed = text.trim();
  if (!trimmed) return { error: 'Milestones text cannot be empty.' };
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_MILESTONES_BYTES) {
    return { error: 'Milestones text is too large (max 2 MB).' };
  }

  await updateMilestonesAsAdmin({ slug, milestones: trimmed });
  revalidatePath(`/planning/${slug}`, 'layout');
  return {};
}

const KNOWN_TAB_SEGMENTS = new Set([
  '',
  'pipeline',
  'milestones',
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

const PERSONAL_BACKLOG_SLUG = '_personal';

export async function addManualArticle(
  slug: string,
  title: string,
  articleType?: string,
  assignToSelf?: boolean,
): Promise<{ articleKey: string; error?: string }> {
  const trimmed = title.trim();
  if (!trimmed) return { articleKey: '', error: 'Title is required.' };

  const effectiveSlug = slug || PERSONAL_BACKLOG_SLUG;

  const articleKey = computeArticleKey({
    specialtySlug: effectiveSlug,
    articleTitle: trimmed,
  });
  if (!articleKey)
    return { articleKey: '', error: 'Could not derive a valid article key.' };

  const { id } = await createManualConsolidatedArticleAsAdmin(
    effectiveSlug,
    trimmed,
    articleType,
  );

  const user = await getCurrentUser();
  const email = user?.email ?? null;

  await setArticleReviewAsAdmin(effectiveSlug, articleKey, id, 'approved', email);
  await ensureNewArticleBacklogRowAsAdmin(effectiveSlug, articleKey, id, email);

  if (assignToSelf && email) {
    await setArticleBacklogAssigneeAsAdmin(effectiveSlug, articleKey, id, email, email);
  }

  if (effectiveSlug !== PERSONAL_BACKLOG_SLUG) {
    revalidatePath(`/planning/${effectiveSlug}`, 'layout');
  }
  revalidatePath('/my-backlog', 'layout');
  return { articleKey };
}

export async function deleteManualArticle(
  slug: string,
  articleKey: string,
): Promise<void> {
  const effectiveSlug = slug || PERSONAL_BACKLOG_SLUG;
  await Promise.all([
    deleteConsolidatedArticleByKeyAsAdmin(effectiveSlug, articleKey),
    clearArticleReviewAsAdmin(effectiveSlug, articleKey),
    clearArticleBacklogAsAdmin(effectiveSlug, articleKey),
  ]);
  if (effectiveSlug !== PERSONAL_BACKLOG_SLUG) {
    revalidatePath(`/planning/${effectiveSlug}`, 'layout');
  }
  revalidatePath('/my-backlog', 'layout');
}

/**
 * Rename a consolidated article. The article key is content-derived from
 * the title, so a rename migrates every joined row (reviews, backlog,
 * comments, sources, runs) to the new key — see
 * `renameConsolidatedArticleByKeyAsAdmin`. Returns the (possibly new) key,
 * or a `conflict` flag when another article already owns the new title.
 */
export async function renameArticle(
  slug: string,
  articleKey: string,
  newTitle: string,
): Promise<{ articleKey: string; conflict?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { articleKey, error: 'You must be signed in to edit articles.' };
  const title = newTitle.trim();
  if (!title) return { articleKey, error: 'Title is required.' };

  try {
    const result = await renameConsolidatedArticleByKeyAsAdmin(slug, articleKey, title);
    if ('conflict' in result) {
      return {
        articleKey,
        conflict: true,
        error: 'Another article already uses that title. Merge them instead.',
      };
    }
    revalidatePath(`/planning/${slug}`, 'layout');
    revalidatePath('/my-backlog', 'layout');
    return { articleKey: result.newKey };
  } catch (err) {
    return {
      articleKey,
      error: err instanceof Error ? err.message : 'Failed to rename article.',
    };
  }
}

/**
 * Replace the embedded code set on a consolidated article. `numCodes` and
 * `overallCoverage` are recomputed server-side from the new set.
 */
export async function updateArticleCodes(
  slug: string,
  articleKey: string,
  codes: unknown[],
): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'You must be signed in to edit articles.' };
  try {
    await setConsolidatedArticleCodesAsAdmin(slug, articleKey, codes);
    revalidatePath(`/planning/${slug}`, 'layout');
    revalidatePath('/my-backlog', 'layout');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update codes.' };
  }
}

/**
 * Merge `sourceKeys` into `targetKey`. Source reviews are deleted, source
 * comments/sources/runs re-pointed to the target, backlog assignee
 * preserved — see `mergeConsolidatedArticlesAsAdmin`.
 */
export async function mergeArticles(
  slug: string,
  targetKey: string,
  sourceKeys: string[],
): Promise<{ mergedCodes?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'You must be signed in to merge articles.' };
  if (!targetKey) return { error: 'Pick a merge target.' };
  const sources = sourceKeys.filter((k) => k && k !== targetKey);
  if (sources.length === 0) {
    return { error: 'Pick at least one other article to merge in.' };
  }
  try {
    const { mergedCodes } = await mergeConsolidatedArticlesAsAdmin(
      slug,
      targetKey,
      sources,
    );
    revalidatePath(`/planning/${slug}`, 'layout');
    revalidatePath('/my-backlog', 'layout');
    return { mergedCodes };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to merge articles.' };
  }
}

/**
 * Codes available to add to an article in the edit modal. Defaults to the
 * article's consolidation bucket; pass no category for the "show all" view.
 */
export async function listCodesForArticlePicker(
  slug: string,
  consolidationCategory?: string,
): Promise<PickerCode[]> {
  return listCodesForPicker(slug, consolidationCategory);
}
