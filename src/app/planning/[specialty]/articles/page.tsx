import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { computeArticleKey } from '@/lib/data/article-keys';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listConsolidatedSections } from '@/lib/data/sections';
import type { ConsolidatedArticle } from '@/lib/types';
import type { ReviewerMap, ReviewMap } from '../../_components/article-manager-modal-v2';
import { type ArticleRow, ArticlesView } from '../../_components/articles-view';
import {
  buildTitleOriginLookup,
  type CategoryLookup,
  extractCodes,
  type TitleOriginLookup,
} from '../../_components/code-utils';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={8} rows={10} />}>
      <ArticlesData slug={slug} />
    </Suspense>
  );
}

function projectConsolidated(slug: string, r: ConsolidatedArticle): ArticleRow {
  const codes = extractCodes(r.codes);
  return {
    id: r.id,
    articleKey:
      r.articleKey ||
      computeArticleKey({
        specialtySlug: slug,
        articleTitle: r.articleTitle,
        articleId: r.articleId,
        category: r.category,
      }),
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    category: r.category,
    codes,
    numCodes: r.numCodes ?? codes.length,
    overallCoverage: r.overallCoverage,
    overallImportance: r.overallImportance,
    justification: r.justification,
    previousArticleTitleSuggestions: r.previousArticleTitleSuggestions,
    pass: 'first',
  };
}

async function ArticlesData({ slug }: { slug: string }) {
  const [
    consolidatedRecs,
    codeRecs,
    reviewRecs,
    sectionRecs,
    commentsByArticle,
    user,
  ] = await Promise.all([
    listConsolidatedArticles(slug),
    listCodes(slug),
    listArticleReviews(slug),
    listConsolidatedSections(slug),
    listReviewComments(slug, 'article'),
    getCurrentUser(),
  ]);

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  // Lineage map: each known title → whether it's an article, a section
  // (in which article), or both. Used by the review modal to annotate
  // the flat strings in `previousArticleTitleSuggestions`.
  const titleOriginLookup: TitleOriginLookup = buildTitleOriginLookup(
    consolidatedRecs,
    sectionRecs,
  );

  // Visibility-gating: only approved 1st-consolidation candidates reach
  // this surface. The editor approves on /consolidation-review.
  const isApproved = (r: ConsolidatedArticle) => {
    const key = r.articleKey;
    if (!key) return false;
    return reviewRecs[key]?.status === 'approved';
  };
  const consolidated = consolidatedRecs
    .filter(isApproved)
    .map((r) => projectConsolidated(slug, r));

  // `reviewRecs` is keyed by articleKey (the stable id). The modal
  // displays review state by PB id (`current.id`) so it can survive
  // local row reordering. Translate at the boundary.
  const initialReviews: ReviewMap = {};
  const initialReviewers: ReviewerMap = {};
  const initialNotesByArticle: Record<string, string> = {};
  for (const row of consolidated) {
    if (!row.id || !row.articleKey) continue;
    const review = reviewRecs[row.articleKey];
    if (!review) continue;
    initialReviews[row.id] = review.status;
    initialReviewers[row.id] = {
      reviewerEmail: review.reviewerEmail,
      reviewedAt: review.reviewedAt,
    };
    if (review.notes) initialNotesByArticle[row.id] = review.notes;
  }

  return (
    <ArticlesView
      slug={slug}
      consolidated={consolidated}
      categoryLookup={categoryLookup}
      titleOriginLookup={titleOriginLookup}
      initialReviews={initialReviews}
      initialReviewers={initialReviewers}
      initialCommentsByArticle={commentsByArticle}
      initialNotesByArticle={initialNotesByArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
