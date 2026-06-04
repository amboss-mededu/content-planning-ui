import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { listLatestDraftRunsForArticles } from '@/lib/data/article-draft-runs';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { listArticleLitSearchRuns } from '@/lib/data/article-lit-search-runs';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listArticleSourcesByArticleKey } from '@/lib/data/article-sources';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import { listAssignableUsers } from '@/lib/data/users';
import type { ArticleBacklogRecord, ArticleSourceRecord } from '@/lib/pb/types';
import type { ConsolidatedArticle, ConsolidatedSection } from '@/lib/types';
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

/**
 * Project a `consolidatedArticles` row (the 1st-consolidation output
 * the editor approves on the consolidation-review screen) into a
 * backlog row. The review-pass and the backlog read the same
 * collection so the approve→backlog flow lives in one ID space,
 * joined by `articleKey` (with the `category` fed into the fallback
 * key formula since 1st-pass rows carry a category).
 */
function projectNewArticle(
  slug: string,
  r: ConsolidatedArticle,
  sourcesByKey: Record<string, ArticleSourceRecord[]>,
): BacklogRow {
  const articleKey =
    r.articleKey ||
    computeArticleKey({
      specialtySlug: slug,
      articleTitle: r.articleTitle,
      articleId: r.articleId,
      category: r.category,
    });
  const sources = sourcesByKey[articleKey] ?? [];
  return {
    id: r.id ?? '',
    articleKey,
    type: 'new',
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    codes: extractCodes(r.codes),
    sourcesCount: sources.length,
    registeredSourcesCount: sources.filter((s) => s.cortexSourceId).length,
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
    articleRecs,
    reviewRecs,
    sectionRecs,
    sectionReviewRecs,
    backlogRecs,
    sourcesByKey,
    litSearchRuns,
    codeRecs,
    users,
    commentsByArticleKind,
    user,
    draftRunsByArticle,
  ] = await Promise.all([
    listConsolidatedArticles(slug),
    listArticleReviews(slug),
    listConsolidatedSections(slug),
    listSectionReviews(slug),
    listArticleBacklog(slug),
    listArticleSourcesByArticleKey(slug),
    listArticleLitSearchRuns(slug),
    listCodes(slug),
    listAssignableUsers(),
    listReviewComments(slug, 'article'),
    getCurrentUser(),
    listLatestDraftRunsForArticles(slug),
  ]);

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  const articleByKey = new Map<string, ConsolidatedArticle>();
  for (const r of articleRecs) {
    const key =
      r.articleKey ||
      computeArticleKey({
        specialtySlug: slug,
        articleTitle: r.articleTitle,
        articleId: r.articleId,
        category: r.category,
      });
    if (key) articleByKey.set(key, r);
  }

  // Candidate rows are the current consolidated output. BacklogView
  // applies live articleBacklog + live review membership so rows can
  // appear/disappear across tabs without waiting on a server refresh.
  const newRows: BacklogRow[] = [];
  for (const article of articleByKey.values()) {
    newRows.push(projectNewArticle(slug, article, sourcesByKey));
  }

  // type='update' rows: each parent article appears only if the
  // backlog row exists. Approved sections are joined in as the review
  // details for that parent article.
  const sectionsByParent = new Map<string, ConsolidatedSection[]>();
  for (const s of sectionRecs) {
    if (!s.id) continue;
    const parentId = s.articleId;
    if (!parentId) continue;
    const list = sectionsByParent.get(parentId) ?? [];
    list.push(s);
    sectionsByParent.set(parentId, list);
  }
  const updateRows: BacklogRow[] = [];
  for (const [parentId, sections] of sectionsByParent.entries()) {
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
      registeredSourcesCount: 0,
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
      initialArticleReviewRows={Object.values(reviewRecs)}
      initialSectionReviewRows={Object.values(sectionReviewRecs)}
      initialSourcesByArticleKey={sourcesByKey}
      initialLitSearchRuns={litSearchRuns}
      initialCommentsByArticle={initialCommentsByArticle}
      initialDraftRuns={draftRunsByArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
