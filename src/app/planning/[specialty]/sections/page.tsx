import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
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

function projectSection(r: ConsolidatedSection): SectionRow {
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

  const initialReviews: ReviewMap = {};
  const initialReviewers: ReviewerMap = {};
  const initialNotesBySection: Record<string, string> = {};
  for (const [id, r] of Object.entries(reviewRecs)) {
    initialReviews[id] = r.status;
    initialReviewers[id] = {
      reviewerEmail: r.reviewerEmail,
      reviewedAt: r.reviewedAt,
    };
    if (r.notes) initialNotesBySection[id] = r.notes;
  }

  const rows = sectionRecs.map(projectSection);

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
