import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import type { ConsolidatedArticle, ConsolidatedSection } from '@/lib/types';
import { deriveConsolidationMappingByCategory } from '@/lib/workflows/consolidation/buckets';
import type { ReviewerMap, ReviewMap } from '../../_components/article-manager-modal-v2';
import type { ArticleRow } from '../../_components/articles-view';
import {
  buildTitleOriginLookup,
  type CategoryLookup,
  type EmbeddedCode,
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

type CodeMetadataLookup = Record<
  string,
  { description?: string; category?: string | undefined } | undefined
>;

function enrichCodes(codes: EmbeddedCode[], lookup: CodeMetadataLookup): EmbeddedCode[] {
  return codes.map((code) => {
    const metadata = lookup[code.code];
    if (!metadata) return code;
    return {
      ...code,
      description: code.description ?? metadata.description,
      category: code.category ?? metadata.category,
    };
  });
}

function projectArticle(
  slug: string,
  r: ConsolidatedArticle,
  codeMetadataLookup: CodeMetadataLookup,
): ArticleRow {
  const codes = enrichCodes(extractCodes(r.codes), codeMetadataLookup);
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

function projectSection(
  slug: string,
  r: ConsolidatedSection,
  codeMetadataLookup: CodeMetadataLookup,
): SectionRow {
  const codes = enrichCodes(extractCodes(r.codes), codeMetadataLookup);
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
    commentsByArticle,
    commentsBySection,
    user,
  ] = await Promise.all([
    listConsolidatedArticles(slug),
    listConsolidatedSections(slug),
    listCodes(slug),
    listArticleReviews(slug),
    listSectionReviews(slug),
    listReviewComments(slug, 'article'),
    listReviewComments(slug, 'section'),
    getCurrentUser(),
  ]);

  const categoryLookup: CategoryLookup = {};
  const codeMetadataLookup: CodeMetadataLookup = {};
  for (const c of codeRecs) {
    categoryLookup[c.code] = c.category;
    codeMetadataLookup[c.code] = {
      description: c.description,
      category: c.category,
    };
  }

  // Review buckets are keyed by codes.consolidationCategory, not the
  // source ontology category. Unbucketed codes are excluded from this
  // review rail because there is no user-facing consolidation bucket to run.
  const mappingByCategory = deriveConsolidationMappingByCategory(codeRecs);

  // Modal drill-in needs the same lineage map the New Articles tab uses
  // so previous-title chips annotate correctly. Built from the 1st-pass
  // collections that exist on this screen.
  const titleOriginLookup: TitleOriginLookup = buildTitleOriginLookup(
    articleRecs,
    sectionRecs,
  );

  const articles = articleRecs.map((r) => projectArticle(slug, r, codeMetadataLookup));
  const sections = sectionRecs.map((r) => projectSection(slug, r, codeMetadataLookup));

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

  return (
    <ConsolidationReviewView
      slug={slug}
      initialCategory={initialCategory}
      articles={articles}
      sections={sections}
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
