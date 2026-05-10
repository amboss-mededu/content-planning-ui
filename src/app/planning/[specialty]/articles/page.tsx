import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleReviews } from '@/lib/data/article-reviews';
import {
  listArticleUpdateSuggestions,
  listConsolidatedArticles,
  listNewArticleSuggestions,
} from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listConsolidatedSections } from '@/lib/data/sections';
import type {
  ArticleUpdateSuggestion,
  ConsolidatedArticle,
  NewArticleSuggestion,
} from '@/lib/types';
import { type ArticleRow, ArticlesView } from '../../_components/articles-view';
import {
  buildTitleOriginLookup,
  type CategoryLookup,
  extractCodes,
  type TitleOriginLookup,
} from '../../_components/code-utils';
import type { ReviewerMap, ReviewMap } from '../../_components/review-modal';
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

function projectConsolidated(r: ConsolidatedArticle): ArticleRow {
  const codes = extractCodes(r.codes);
  return {
    id: r.id,
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

function projectSuggestion(
  r: NewArticleSuggestion | ArticleUpdateSuggestion,
): ArticleRow {
  const codes = extractCodes(r.codes);
  return {
    id: r.id,
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    // category + numCodes are not on the 2nd-pass schema; fall back where we can.
    category: undefined,
    codes,
    numCodes: codes.length,
    existingAmbossCoverage: r.existingAmbossCoverage,
    overallImportance: r.overallImportance,
    justification: r.justification,
    previousArticleTitleSuggestions: r.previousArticleTitleSuggestions,
    pass: 'second',
  };
}

async function ArticlesData({ slug }: { slug: string }) {
  const [
    consolidatedRecs,
    newRecs,
    updateRecs,
    codeRecs,
    reviewRecs,
    sectionRecs,
    commentsByArticle,
    user,
  ] = await Promise.all([
    listConsolidatedArticles(slug),
    listNewArticleSuggestions(slug),
    listArticleUpdateSuggestions(slug),
    listCodes(slug),
    listArticleReviews(slug),
    listConsolidatedSections(slug),
    listReviewComments(slug, 'article'),
    getCurrentUser(),
  ]);

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  // Lineage map: each known title → whether it's an article, a section
  // (in which article), or both. Used by the review modal to annotate the
  // flat strings in `previousArticleTitleSuggestions`.
  const titleOriginLookup: TitleOriginLookup = buildTitleOriginLookup(
    consolidatedRecs,
    sectionRecs,
  );

  const initialReviews: ReviewMap = {};
  const initialReviewers: ReviewerMap = {};
  for (const [id, r] of Object.entries(reviewRecs)) {
    initialReviews[id] = r.status;
    initialReviewers[id] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
  }

  const consolidated = consolidatedRecs.map(projectConsolidated);
  const newOnes = newRecs.map(projectSuggestion);
  const updates = updateRecs.map(projectSuggestion);

  return (
    <ArticlesView
      slug={slug}
      consolidated={consolidated}
      newOnes={newOnes}
      updates={updates}
      categoryLookup={categoryLookup}
      titleOriginLookup={titleOriginLookup}
      initialReviews={initialReviews}
      initialReviewers={initialReviewers}
      initialCommentsByArticle={commentsByArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
