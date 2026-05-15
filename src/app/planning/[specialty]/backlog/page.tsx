import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listArticleSourcesByArticle } from '@/lib/data/article-sources';
import { listNewArticleSuggestions } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import { listAssignableUsers } from '@/lib/data/users';
import type { ArticleBacklogRecord, ArticleSourceRecord } from '@/lib/pb/types';
import type { ConsolidatedSection, NewArticleSuggestion } from '@/lib/types';
import { type BacklogRow, BacklogView } from '../../_components/backlog-view';
import {
  type CategoryLookup,
  type EmbeddedCode,
  extractCodes,
} from '../../_components/code-utils';
import type { SectionRow } from '../../_components/sections-view';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function BacklogPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={8} rows={10} />}>
      <BacklogData slug={slug} />
    </Suspense>
  );
}

function projectNewSuggestion(
  slug: string,
  r: NewArticleSuggestion,
  sourcesByArticle: Record<string, ArticleSourceRecord[]>,
): BacklogRow {
  return {
    id: r.id ?? '',
    articleKey: computeArticleKey({
      specialtySlug: slug,
      articleTitle: r.articleTitle,
      articleId: r.articleId,
    }),
    type: 'new',
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    codes: extractCodes(r.codes),
    sourcesCount: r.id ? (sourcesByArticle[r.id]?.length ?? 0) : 0,
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

/** Dedupe codes union across an article's approved sections by `code`. */
function unionCodes(codes: EmbeddedCode[]): EmbeddedCode[] {
  const out: EmbeddedCode[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    out.push(c);
  }
  return out;
}

async function BacklogData({ slug }: { slug: string }) {
  const [
    newRecs,
    reviewRecs,
    sectionRecs,
    sectionReviewRecs,
    backlogRecs,
    sourcesByArticle,
    codeRecs,
    users,
    commentsByArticleKind,
    user,
  ] = await Promise.all([
    listNewArticleSuggestions(slug),
    listArticleReviews(slug),
    listConsolidatedSections(slug),
    listSectionReviews(slug),
    listArticleBacklog(slug),
    listArticleSourcesByArticle(slug),
    listCodes(slug),
    listAssignableUsers(),
    listReviewComments(slug, 'article'),
    getCurrentUser(),
  ]);

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  // type='new' rows: approved 2nd-pass new article suggestions.
  // Approval is joined by articleKey (stable across consolidation re-
  // runs), not by PB id. Suggestions whose key can't be computed (no
  // title) are filtered out — they couldn't be reviewed in the first
  // place.
  const newRows: BacklogRow[] = [];
  for (const r of newRecs) {
    const key = computeArticleKey({
      specialtySlug: slug,
      articleTitle: r.articleTitle,
      articleId: r.articleId,
    });
    if (!key) continue;
    if (reviewRecs[key]?.status !== 'approved') continue;
    newRows.push(projectNewSuggestion(slug, r, sourcesByArticle));
  }

  // type='update' rows: aggregate approved section reviews by parent
  // CMS articleId. We join on the section's `sectionKey`.
  const sectionsByParent = new Map<string, ConsolidatedSection[]>();
  for (const s of sectionRecs) {
    if (!s.id) continue;
    // The section's review state is looked up by its sectionKey, which
    // the data layer already provides on the record. Fall back to the
    // PB id keyed reviewMap entry only if sectionKey is empty (zombie
    // safety). The new lookup is the load-bearing path.
    const reviewKeyCandidates = [s.sectionKey].filter((k): k is string => !!k);
    const approved = reviewKeyCandidates.some(
      (k) => sectionReviewRecs[k]?.status === 'approved',
    );
    if (!approved) continue;
    const parentId = s.articleId;
    if (!parentId) continue;
    const list = sectionsByParent.get(parentId) ?? [];
    list.push(s);
    sectionsByParent.set(parentId, list);
  }
  const updateRows: BacklogRow[] = [];
  for (const [parentId, sections] of sectionsByParent) {
    const projected = sections.map((s) => projectSection(slug, s));
    const codes = unionCodes(projected.flatMap((s) => s.codes));
    updateRows.push({
      id: parentId,
      articleKey: `upd::${parentId}`,
      type: 'update',
      articleTitle: projected[0]?.articleTitle,
      articleType: undefined,
      codes,
      sourcesCount: 0,
      sections: projected,
    });
  }

  // `listReviewComments` now returns comments grouped by recordKey
  // (article-key or section-key depending on kind), so the map is
  // already in the namespace the UI consumes. No `pa:` prefix
  // unpacking — that was a workaround for the now-deprecated
  // recordId-based join.
  const initialCommentsByArticle = commentsByArticleKind;

  const rows = [...newRows, ...updateRows];

  const initialBacklog: Record<string, ArticleBacklogRecord> = backlogRecs;

  return (
    <BacklogView
      slug={slug}
      rows={rows}
      categoryLookup={categoryLookup}
      assignableUsers={users}
      initialBacklog={initialBacklog}
      initialSourcesByArticle={sourcesByArticle}
      initialCommentsByArticle={initialCommentsByArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
