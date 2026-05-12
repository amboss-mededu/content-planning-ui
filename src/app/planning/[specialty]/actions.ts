'use server';

import { updateTag } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import {
  clearArticleBacklog,
  setArticleBacklogAssignee,
  setArticleBacklogStatus,
} from '@/lib/data/article-backlog';
import { clearArticleReview, setArticleReview } from '@/lib/data/article-reviews';
import { addReviewComment, deleteReviewComment } from '@/lib/data/review-comments';
import { clearSectionReview, setSectionReview } from '@/lib/data/section-reviews';
import {
  setPipelineStageOverride as setPipelineStageOverrideData,
  setPipelineStageSkipped as setPipelineStageSkippedData,
  setTabOverride as setTabOverrideData,
} from '@/lib/data/specialties';
import type {
  ArticleBacklogStatus,
  ArticleReviewStatus,
  ReviewCommentRecord,
  ReviewRecordKind,
} from '@/lib/pb/types';

export async function refreshSpecialty(slug: string) {
  updateTag(`specialty:${slug}`);
}

export async function submitArticleReview(
  slug: string,
  articleRecordId: string,
  status: ArticleReviewStatus,
  notes?: string,
): Promise<void> {
  const user = await getCurrentUser();
  await setArticleReview(slug, articleRecordId, status, user?.email ?? null, notes);
  updateTag(`specialty:${slug}`);
}

export async function resetArticleReview(
  slug: string,
  articleRecordId: string,
): Promise<void> {
  await clearArticleReview(slug, articleRecordId);
  updateTag(`specialty:${slug}`);
}

export async function submitSectionReview(
  slug: string,
  sectionRecordId: string,
  status: ArticleReviewStatus,
  notes?: string,
): Promise<void> {
  const user = await getCurrentUser();
  await setSectionReview(slug, sectionRecordId, status, user?.email ?? null, notes);
  updateTag(`specialty:${slug}`);
}

export async function resetSectionReview(
  slug: string,
  sectionRecordId: string,
): Promise<void> {
  await clearSectionReview(slug, sectionRecordId);
  updateTag(`specialty:${slug}`);
}

export async function postReviewComment(
  slug: string,
  kind: ReviewRecordKind,
  recordId: string,
  body: string,
): Promise<ReviewCommentRecord> {
  const user = await getCurrentUser();
  const created = await addReviewComment(slug, kind, recordId, user?.email ?? null, body);
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
  articleRecordId: string,
  status: ArticleBacklogStatus,
): Promise<void> {
  const user = await getCurrentUser();
  await setArticleBacklogStatus(slug, articleRecordId, status, user?.email ?? null);
  updateTag(`specialty:${slug}`);
}

export async function setBacklogAssignee(
  slug: string,
  articleRecordId: string,
  assigneeEmail: string | null,
): Promise<void> {
  const user = await getCurrentUser();
  await setArticleBacklogAssignee(
    slug,
    articleRecordId,
    assigneeEmail,
    user?.email ?? null,
  );
  updateTag(`specialty:${slug}`);
}

export async function clearBacklogRow(
  slug: string,
  articleRecordId: string,
): Promise<void> {
  await clearArticleBacklog(slug, articleRecordId);
  updateTag(`specialty:${slug}`);
}

const KNOWN_TAB_SEGMENTS = new Set([
  '',
  'pipeline',
  'milestones',
  'categories',
  'codes',
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
