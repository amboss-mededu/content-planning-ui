'use server';

import { updateTag } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import { clearArticleReview, setArticleReview } from '@/lib/data/article-reviews';
import { addReviewComment } from '@/lib/data/review-comments';
import { clearSectionReview, setSectionReview } from '@/lib/data/section-reviews';
import type {
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
