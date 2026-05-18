import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { computeArticleKey } from '@/lib/data/article-keys';
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

function projectSuggestion(
  slug: string,
  r: NewArticleSuggestion | ArticleUpdateSuggestion,
): ArticleRow {
  const codes = extractCodes(r.codes);
  return {
    id: r.id,
    articleKey:
      r.articleKey ||
      computeArticleKey({
        specialtySlug: slug,
        articleTitle: r.articleTitle,
        articleId: r.articleId,
        // 2nd-pass suggestion rows don't carry `category` in the
        // schema — the field is on consolidatedArticles only — so the
        // fallback formula kicks in (slug + title).
      }),
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

  const consolidated = consolidatedRecs.map((r) => projectConsolidated(slug, r));
  const newOnes = newRecs.map((r) => projectSuggestion(slug, r));
  const updates = updateRecs.map((r) => projectSuggestion(slug, r));

  // `reviewRecs` is keyed by articleKey (the stable id). The modal
  // displays review state by PB id (`current.id`) so it can survive
  // local row reordering. Translate at the boundary: for each row that
  // has both a key and a current PB id, copy the review's status into
  // the id-keyed map.
  const initialReviews: ReviewMap = {};
  const initialReviewers: ReviewerMap = {};
  const initialNotesByArticle: Record<string, string> = {};
  for (const row of [...consolidated, ...newOnes, ...updates]) {
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
      newOnes={newOnes}
      updates={updates}
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
