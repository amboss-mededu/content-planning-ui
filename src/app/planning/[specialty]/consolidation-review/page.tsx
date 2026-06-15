import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCategoryOrchestration } from '@/lib/data/categories';
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
  | {
      description?: string;
      category?: string | undefined;
      coverageScore?: number;
      existingArticleUpdates?: Array<{
        articleTitle?: string;
        articleId?: string;
        sections?: Array<{
          sectionTitle?: string;
          sectionId?: string;
          importance?: number;
        }>;
      }>;
      newArticlesNeeded?: Array<{ articleTitle?: string; importance?: number }>;
    }
  | undefined
>;

function firstCodeSuggestion(
  metadata: NonNullable<CodeMetadataLookup[string]>,
  context: {
    articleTitle?: string;
    articleId?: string;
    sectionName?: string;
    sectionId?: string;
  },
): Pick<EmbeddedCode, 'importance' | 'previouslySuggestedArticleTitle'> {
  if (context.sectionName || context.sectionId) {
    for (const update of metadata.existingArticleUpdates ?? []) {
      const articleMatches = context.articleId
        ? update.articleId === context.articleId ||
          update.articleTitle === context.articleTitle
        : !context.articleTitle || update.articleTitle === context.articleTitle;
      if (!articleMatches) continue;
      for (const section of update.sections ?? []) {
        const sectionMatches = context.sectionId
          ? section.sectionId === context.sectionId
          : section.sectionTitle === context.sectionName;
        if (!sectionMatches) continue;
        return {
          importance: section.importance,
          previouslySuggestedArticleTitle: update.articleTitle,
        };
      }
      return {
        previouslySuggestedArticleTitle: update.articleTitle,
      };
    }
  }

  const articleSuggestion =
    metadata.newArticlesNeeded?.find(
      (article) => article.articleTitle === context.articleTitle,
    ) ?? metadata.newArticlesNeeded?.[0];
  if (articleSuggestion) {
    return {
      importance: articleSuggestion.importance,
      previouslySuggestedArticleTitle: articleSuggestion.articleTitle,
    };
  }

  const updateSuggestion = metadata.existingArticleUpdates?.[0];
  return {
    previouslySuggestedArticleTitle: updateSuggestion?.articleTitle,
    importance: updateSuggestion?.sections?.find(
      (section) => typeof section.importance === 'number',
    )?.importance,
  };
}

function enrichCodes(
  codes: EmbeddedCode[],
  lookup: CodeMetadataLookup,
  context: {
    articleTitle?: string;
    articleId?: string;
    sectionName?: string;
    sectionId?: string;
  },
): EmbeddedCode[] {
  return codes.map((code) => {
    const metadata = lookup[code.code];
    if (!metadata) return code;
    const suggestion = firstCodeSuggestion(metadata, context);
    return {
      ...code,
      description: code.description ?? metadata.description,
      category: code.category ?? metadata.category,
      coverageScore: code.coverageScore ?? metadata.coverageScore,
      importance: code.importance ?? suggestion.importance,
      previouslySuggestedArticleTitle:
        code.previouslySuggestedArticleTitle ??
        suggestion.previouslySuggestedArticleTitle,
    };
  });
}

function projectArticle(
  slug: string,
  r: ConsolidatedArticle,
  codeMetadataLookup: CodeMetadataLookup,
): ArticleRow {
  const codes = enrichCodes(extractCodes(r.codes), codeMetadataLookup, {
    articleTitle: r.articleTitle,
    articleId: r.articleId,
  });
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
  const codes = enrichCodes(extractCodes(r.codes), codeMetadataLookup, {
    articleTitle: r.articleTitle,
    articleId: r.articleId,
    sectionName: r.sectionName,
    sectionId: r.sectionId,
  });
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
    orchestration,
    user,
  ] = await Promise.all([
    listConsolidatedArticles(slug),
    listConsolidatedSections(slug),
    listCodes(slug),
    listArticleReviews(slug),
    listSectionReviews(slug),
    listReviewComments(slug, 'article'),
    listReviewComments(slug, 'section'),
    listCategoryOrchestration(slug),
    getCurrentUser(),
  ]);

  // Per-bucket staleness for the rail badge — keyed by consolidationCategory.
  const staleByCategory: Record<string, boolean> = {};
  for (const o of orchestration) staleByCategory[o.consolidationCategory] = o.isStale;

  const categoryLookup: CategoryLookup = {};
  const codeMetadataLookup: CodeMetadataLookup = {};
  for (const c of codeRecs) {
    categoryLookup[c.code] = c.category;
    codeMetadataLookup[c.code] = {
      description: c.description,
      category: c.category,
      coverageScore: c.depthOfCoverage,
      existingArticleUpdates: c.existingArticleUpdates,
      newArticlesNeeded: c.newArticlesNeeded,
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
  // (stable across consolidation re-runs). Keep the client maps in
  // that same namespace so this screen agrees with the dedicated New
  // Articles and Article Updates tabs.
  const initialArticleReviews: ReviewMap = {};
  const initialArticleReviewers: ReviewerMap = {};
  const initialNotesByArticle: Record<string, string> = {};
  for (const [articleKey, r] of Object.entries(articleReviewRecs)) {
    initialArticleReviews[articleKey] = r.status;
    initialArticleReviewers[articleKey] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesByArticle[articleKey] = r.notes;
  }

  const initialSectionReviews: ReviewMap = {};
  const initialSectionReviewers: ReviewerMap = {};
  const initialNotesBySection: Record<string, string> = {};
  for (const [sectionKey, r] of Object.entries(sectionReviewRecs)) {
    initialSectionReviews[sectionKey] = r.status;
    initialSectionReviewers[sectionKey] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesBySection[sectionKey] = r.notes;
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
      staleByCategory={staleByCategory}
      categoryLookup={categoryLookup}
      titleOriginLookup={titleOriginLookup}
      initialArticleReviews={initialArticleReviews}
      initialArticleReviewers={initialArticleReviewers}
      initialArticleReviewRows={Object.values(articleReviewRecs)}
      initialSectionReviews={initialSectionReviews}
      initialSectionReviewers={initialSectionReviewers}
      initialSectionReviewRows={Object.values(sectionReviewRecs)}
      initialNotesByArticle={initialNotesByArticle}
      initialNotesBySection={initialNotesBySection}
      initialCommentsByArticle={commentsByArticle}
      initialCommentsBySection={commentsBySection}
      initialCommentsByParentArticle={commentsByParentArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
