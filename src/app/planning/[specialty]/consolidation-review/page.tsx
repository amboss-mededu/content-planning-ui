import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listNewArticleSuggestions } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listConsolidationCategoryReviews } from '@/lib/data/consolidation-category-reviews';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import type { ConsolidatedSection, NewArticleSuggestion } from '@/lib/types';
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

/**
 * Pick the most common `category` from the linked codes. The
 * `newArticleSuggestions` table doesn't carry a `category` column of
 * its own (it's a deduped roll-up across categories), so we derive
 * one to drive the consolidation-review rail's per-category grouping.
 * Ties resolve to the first-seen category.
 */
function deriveCategoryFromCodes(
  codes: Array<{ category?: string | null }>,
): string | undefined {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const cat = (c.category ?? '').trim();
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  let best: string | undefined;
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

function projectArticle(slug: string, r: NewArticleSuggestion): ArticleRow {
  const codes = extractCodes(r.codes);
  const category = deriveCategoryFromCodes(codes);
  return {
    id: r.id,
    articleKey:
      r.articleKey ||
      computeArticleKey({
        specialtySlug: slug,
        articleTitle: r.articleTitle,
        articleId: r.articleId,
      }),
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    category,
    codes,
    numCodes: codes.length,
    existingAmbossCoverage: r.existingAmbossCoverage,
    overallImportance: r.overallImportance,
    justification: r.justification,
    previousArticleTitleSuggestions: r.previousArticleTitleSuggestions,
    pass: 'second',
  };
}

function projectSection(slug: string, r: ConsolidatedSection): SectionRow {
  const codes = extractCodes(r.codes);
  const updateType: 'new' | 'update' | null =
    r.exists === true ? 'update' : r.exists === false ? 'new' : null;
  return {
    id: r.id,
    sectionKey:
      r.sectionKey ||
      computeSectionKey({
        specialtySlug: slug,
        articleTitle: r.articleTitle,
        articleId: r.articleId,
        sectionName: r.sectionName,
        sectionId: r.sectionId,
        category: r.category,
      }),
    articleTitle: r.articleTitle,
    articleId: r.articleId,
    sectionName: r.sectionName,
    sectionId: r.sectionId,
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
    listNewArticleSuggestions(slug),
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

  const articles = articleRecs.map((r) => projectArticle(slug, r));
  const sections = sectionRecs.map((r) => projectSection(slug, r));

  // The data layer returns reviews keyed by articleKey / sectionKey
  // (stable across consolidation re-runs). The downstream view + modal
  // do their O(1) lookups by PB id so the inline table is responsive
  // even when a row's logical key has just changed. Translate here:
  // for each current row that has both an id and a key, copy the
  // review's status/reviewer/notes into the id-keyed map. Reviews
  // whose key doesn't match any current row (zombies — producer was
  // deleted before the keys migration) are silently dropped.
  const initialArticleReviews: ReviewMap = {};
  const initialArticleReviewers: ReviewerMap = {};
  const initialNotesByArticle: Record<string, string> = {};
  for (const a of articles) {
    if (!a.id || !a.articleKey) continue;
    const r = articleReviewRecs[a.articleKey];
    if (!r) continue;
    initialArticleReviews[a.id] = r.status;
    initialArticleReviewers[a.id] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesByArticle[a.id] = r.notes;
  }

  const initialSectionReviews: ReviewMap = {};
  const initialSectionReviewers: ReviewerMap = {};
  const initialNotesBySection: Record<string, string> = {};
  for (const s of sections) {
    if (!s.id || !s.sectionKey) continue;
    const r = sectionReviewRecs[s.sectionKey];
    if (!r) continue;
    initialSectionReviews[s.id] = r.status;
    initialSectionReviewers[s.id] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesBySection[s.id] = r.notes;
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
