'use server';

import { updateTag } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import { clearArticleReview, setArticleReview } from '@/lib/data/article-reviews';
import type { ArticleReviewStatus } from '@/lib/pb/types';

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
