import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listConsolidationCategoryReviews } from '@/lib/data/consolidation-category-reviews';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import type { ConsolidatedArticle, ConsolidatedSection } from '@/lib/types';
import type { ReviewerMap, ReviewMap } from '../../_components/article-manager-modal-v2';
import type { ArticleRow } from '../../_components/articles-view';
import {
  buildTitleOriginLookup,
  type CategoryLookup,
  extractCodes,
  type TitleOriginLookup,
} from '../../_components/code-utils';
import { ConsolidationReviewView } from '../../_components/consolidation-review-view';
import type { SectionRow } from '../../_components/sections-view';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function ConsolidationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ specialty: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { specialty: slug } = await params;
  // Read the initial selected category on the server (Cache Components
  // mode treats this as the dynamic boundary) instead of via
  // useSearchParams() in the client component, which under
  // `cacheComponents: true` requires its own Suspense wrapper and was
  // surfacing a misleading "window is not defined" SSR error.
  const sp = await searchParams;
  const rawCategory = sp.category;
  const initialCategory = Array.isArray(rawCategory)
    ? (rawCategory[0] ?? null)
    : (rawCategory ?? null);
  return (
    <Suspense fallback={<TableSkeleton columns={6} rows={10} />}>
      <ConsolidationReviewData slug={slug} initialCategory={initialCategory} />
    </Suspense>
  );
}

function projectArticle(r: ConsolidatedArticle): ArticleRow {
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

function projectSection(r: ConsolidatedSection): SectionRow {
  const codes = extractCodes(r.codes);
  const updateType: 'new' | 'update' | null =
    r.exists === true ? 'update' : r.exists === false ? 'new' : null;
  return {
    id: r.id,
    articleTitle: r.articleTitle,
    articleId: r.articleId,
    sectionName: r.sectionName,
    updateType,
    category: r.category,
    codes,
    numCodes: r.numCodes ?? codes.length,
    overallImportance: r.overallImportance,
    overallCoverage: r.overallCoverage,
    justification: r.justification,
    previousSectionNames: r.previousSectionNames,
  };
}

async function ConsolidationReviewData({
  slug,
  initialCategory,
}: {
  slug: string;
  initialCategory: string | null;
}) {
  const [
    articleRecs,
    sectionRecs,
    codeRecs,
    articleReviewRecs,
    sectionReviewRecs,
    categoryReviewRecs,
    commentsByArticle,
    commentsBySection,
    user,
  ] = await Promise.all([
    listConsolidatedArticles(slug),
    listConsolidatedSections(slug),
    listCodes(slug),
    listArticleReviews(slug),
    listSectionReviews(slug),
    listConsolidationCategoryReviews(slug),
    listReviewComments(slug, 'article'),
    listReviewComments(slug, 'section'),
    getCurrentUser(),
  ]);

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  // Per-category mapping readiness. Computed from the same `codeRecs` we
  // already fetched — no extra query. Drives the "ready for consolidation"
  // chip in the rail and (in a follow-up branch) the per-category
  // consolidation trigger button.
  const mappingByCategory: Record<
    string,
    { mapped: number; total: number; ready: boolean }
  > = {};
  for (const c of codeRecs) {
    const cat = c.category ?? '(uncategorized)';
    const entry = mappingByCategory[cat] ?? { mapped: 0, total: 0, ready: false };
    entry.total += 1;
    if ((c.mappedAt ?? 0) > 0) entry.mapped += 1;
    mappingByCategory[cat] = entry;
  }
  for (const cat of Object.keys(mappingByCategory)) {
    const e = mappingByCategory[cat];
    e.ready = e.total > 0 && e.mapped === e.total;
  }

  // Modal drill-in needs the same lineage map the New Articles tab uses
  // so previous-title chips annotate correctly. Built from the 1st-pass
  // collections that exist on this screen.
  const titleOriginLookup: TitleOriginLookup = buildTitleOriginLookup(
    articleRecs,
    sectionRecs,
  );

  const initialArticleReviews: ReviewMap = {};
  const initialArticleReviewers: ReviewerMap = {};
  const initialNotesByArticle: Record<string, string> = {};
  for (const [id, r] of Object.entries(articleReviewRecs)) {
    initialArticleReviews[id] = r.status;
    initialArticleReviewers[id] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesByArticle[id] = r.notes;
  }

  const initialSectionReviews: ReviewMap = {};
  const initialSectionReviewers: ReviewerMap = {};
  const initialNotesBySection: Record<string, string> = {};
  for (const [id, r] of Object.entries(sectionReviewRecs)) {
    initialSectionReviews[id] = r.status;
    initialSectionReviewers[id] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesBySection[id] = r.notes;
  }

  // Article-level update threads live under recordKind='article' with a
  // 'pa:' prefix to separate them from per-PB-id new-article threads.
  // Strip the prefix for the modal's keyed lookup.
  const commentsByParentArticle: Record<string, (typeof commentsByArticle)[string]> = {};
  for (const [recordId, list] of Object.entries(commentsByArticle)) {
    if (recordId.startsWith('pa:')) {
      commentsByParentArticle[recordId.slice(3)] = list;
    }
  }

  const flaggedCategories = new Set<string>();
  for (const [cat, r] of Object.entries(categoryReviewRecs)) {
    if (r.status === 'flagged-for-rerun') flaggedCategories.add(cat);
  }

  const articles = articleRecs.map(projectArticle);
  const sections = sectionRecs.map(projectSection);

  return (
    <ConsolidationReviewView
      slug={slug}
      initialCategory={initialCategory}
      articles={articles}
      sections={sections}
      flaggedCategories={Array.from(flaggedCategories)}
      mappingByCategory={mappingByCategory}
      categoryLookup={categoryLookup}
      titleOriginLookup={titleOriginLookup}
      initialArticleReviews={initialArticleReviews}
      initialArticleReviewers={initialArticleReviewers}
      initialSectionReviews={initialSectionReviews}
      initialSectionReviewers={initialSectionReviewers}
      initialNotesByArticle={initialNotesByArticle}
      initialNotesBySection={initialNotesBySection}
      initialCommentsByArticle={commentsByArticle}
      initialCommentsBySection={commentsBySection}
      initialCommentsByParentArticle={commentsByParentArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
