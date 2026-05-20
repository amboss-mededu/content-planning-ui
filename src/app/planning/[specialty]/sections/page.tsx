import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { computeSectionKey } from '@/lib/data/article-keys';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import type { ConsolidatedSection } from '@/lib/types';
import type { ReviewerMap, ReviewMap } from '../../_components/article-manager-modal-v2';
import {
  buildTitleOriginLookup,
  type CategoryLookup,
  extractCodes,
  type TitleOriginLookup,
} from '../../_components/code-utils';
import { type SectionRow, SectionsView } from '../../_components/sections-view';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function SectionsPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={10} rows={10} />}>
      <SectionsData slug={slug} />
    </Suspense>
  );
}

function projectSection(slug: string, r: ConsolidatedSection): SectionRow {
  const codes = extractCodes(r.codes);
  // `exists` reflects whether the section already lives in AMBOSS today.
  // True → this proposal updates the existing section; false → it's a
  // brand-new section to be added under the parent article. The legacy
  // `newSection` / `sectionUpdate` booleans on the raw record are kept
  // for compatibility with seed scripts but no longer drive the UI.
  const updateType: 'new' | 'update' | null =
    r.exists === true ? 'update' : r.exists === false ? 'new' : null;
  return {
    id: r.id,
    // Mirror the consolidation-review projection so per-row ✓ in the
    // article-updates modal can resolve a stable key — without this,
    // rows reach the modal with `sectionKey: undefined` and the
    // mutation surfaces a "missing stable key" banner.
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

async function SectionsData({ slug }: { slug: string }) {
  const [
    sectionRecs,
    codeRecs,
    reviewRecs,
    articleRecs,
    commentsBySection,
    commentsByArticleKind,
    user,
  ] = await Promise.all([
    listConsolidatedSections(slug),
    listCodes(slug),
    listSectionReviews(slug),
    listConsolidatedArticles(slug),
    listReviewComments(slug, 'section'),
    listReviewComments(slug, 'article'),
    getCurrentUser(),
  ]);

  // Per-AMBOSS-article comments live in the same `reviewComments`
  // collection under recordKind='article' (the only allowed select
  // value alongside 'section'), with a 'pa:' recordId prefix to
  // distinguish them from the New Articles modal's per-PB-record
  // comments. Strip the prefix so the modal can look up by article id.
  const commentsByParentArticle: Record<string, (typeof commentsByArticleKind)[string]> =
    {};
  for (const [recordId, comments] of Object.entries(commentsByArticleKind)) {
    if (recordId.startsWith('pa:')) {
      commentsByParentArticle[recordId.slice(3)] = comments;
    }
  }

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  // Annotate "previousSectionNames" entries with where they came from
  // (article in its own right, or a section in a specific article).
  const titleOriginLookup: TitleOriginLookup = buildTitleOriginLookup(
    articleRecs,
    sectionRecs,
  );

  // Only approved sections reach the article-updates surface.
  // Approval happens on /consolidation-review; until that flips,
  // the row shouldn't be visible here. Match the same fallback
  // section-key computation the consolidation-review page uses
  // (article title / id + section name / id + category).
  const approvedSections = sectionRecs.filter((r) => {
    const key =
      r.sectionKey ||
      computeSectionKey({
        specialtySlug: slug,
        articleTitle: r.articleTitle,
        articleId: r.articleId,
        sectionName: r.sectionName,
        sectionId: r.sectionId,
        category: r.category,
      });
    if (!key) return false;
    return reviewRecs[key]?.status === 'approved';
  });
  const rows = approvedSections.map((r) => projectSection(slug, r));

  // Review maps in the client are keyed by the current consolidatedSections
  // PB row id for fast table/modal lookup. The data layer returns stable
  // sectionKey-keyed rows, so translate after projection.
  const initialReviews: ReviewMap = {};
  const initialReviewers: ReviewerMap = {};
  const initialNotesBySection: Record<string, string> = {};
  for (const row of rows) {
    if (!row.id || !row.sectionKey) continue;
    const review = reviewRecs[row.sectionKey];
    if (!review) continue;
    initialReviews[row.id] = review.status;
    initialReviewers[row.id] = {
      reviewerEmail: review.reviewerEmail,
      reviewedAt: review.reviewedAt,
    };
    if (review.notes) initialNotesBySection[row.id] = review.notes;
  }

  return (
    <SectionsView
      slug={slug}
      rows={rows}
      categoryLookup={categoryLookup}
      titleOriginLookup={titleOriginLookup}
      initialReviews={initialReviews}
      initialReviewers={initialReviewers}
      initialCommentsBySection={commentsBySection}
      initialCommentsByParentArticle={commentsByParentArticle}
      initialNotesBySection={initialNotesBySection}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
