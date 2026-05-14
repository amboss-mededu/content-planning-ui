import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listArticleSourcesByArticle } from '@/lib/data/article-sources';
import { listNewArticleSuggestions } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import { listAssignableUsers } from '@/lib/data/users';
import type {
  ArticleBacklogRecord,
  ArticleSourceRecord,
  ReviewCommentRecord,
} from '@/lib/pb/types';
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
  r: NewArticleSuggestion,
  sourcesByArticle: Record<string, ArticleSourceRecord[]>,
): BacklogRow {
  return {
    id: r.id ?? '',
    type: 'new',
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    codes: extractCodes(r.codes),
    sourcesCount: r.id ? (sourcesByArticle[r.id]?.length ?? 0) : 0,
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
  const approvedNew = newRecs.filter(
    (r) => r.id && reviewRecs[r.id]?.status === 'approved',
  );
  const newRows = approvedNew.map((r) => projectNewSuggestion(r, sourcesByArticle));

  // type='update' rows: aggregate approved section reviews by parent
  // article id. The articleBacklog row (when present) carries workflow
  // state; absence means default 'waiting-for-sources'.
  const sectionsByParent = new Map<string, ConsolidatedSection[]>();
  for (const s of sectionRecs) {
    if (!s.id) continue;
    if (sectionReviewRecs[s.id]?.status !== 'approved') continue;
    const parentId = s.articleId;
    if (!parentId) continue;
    const list = sectionsByParent.get(parentId) ?? [];
    list.push(s);
    sectionsByParent.set(parentId, list);
  }
  const updateRows: BacklogRow[] = [];
  for (const [parentId, sections] of sectionsByParent) {
    const projected = sections.map(projectSection);
    const codes = unionCodes(projected.flatMap((s) => s.codes));
    updateRows.push({
      id: parentId,
      type: 'update',
      articleTitle: projected[0]?.articleTitle,
      articleType: undefined,
      codes,
      sourcesCount: 0,
      sections: projected,
    });
  }

  // Split comments by recordId prefix: `pa:` = per-parent-article (used by
  // type='update' rows + the update-review article view), bare = per-PB-id
  // (used by type='new' rows + the new-article review modal).
  const initialCommentsByArticle: Record<string, ReviewCommentRecord[]> = {};
  for (const [recordId, list] of Object.entries(commentsByArticleKind)) {
    if (recordId.startsWith('pa:')) {
      initialCommentsByArticle[recordId.slice(3)] = list;
    } else {
      initialCommentsByArticle[recordId] = list;
    }
  }

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
