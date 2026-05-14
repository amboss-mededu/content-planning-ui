import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklogForAssignee } from '@/lib/data/article-backlog';
import { listArticleSourcesForArticleIds } from '@/lib/data/article-sources';
import { listNewArticleSuggestionsForIds } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listReviewComments } from '@/lib/data/review-comments';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import { listSpecialties } from '@/lib/data/specialties';
import { listAssignableUsers } from '@/lib/data/users';
import type {
  ArticleBacklogRecord,
  ArticleSourceRecord,
  ReviewCommentRecord,
} from '@/lib/pb/types';
import type { ConsolidatedSection } from '@/lib/types';
import {
  type CategoryLookup,
  type EmbeddedCode,
  extractCodes,
} from '../planning/_components/code-utils';
import type { SectionRow } from '../planning/_components/sections-view';
import { TableSkeleton } from '../planning/_components/table-skeleton';
import { type MyBacklogRow, MyBacklogView } from './_components/my-backlog-view';

export default function MyBacklogPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={9} rows={10} />}>
      <MyBacklogData />
    </Suspense>
  );
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

async function MyBacklogData() {
  const user = await getCurrentUser();
  if (!user?.email) {
    return <p>Sign in to see articles assigned to you.</p>;
  }

  const backlogRows = await listArticleBacklogForAssignee(user.email);
  const specialtySlugs = Array.from(new Set(backlogRows.map((r) => r.specialtySlug)));

  // type='new' rows mirror approved newArticleSuggestions; look those up
  // by PB id. Update rows need per-specialty section data and are batched
  // by slug to keep the query count bounded.
  const newRowArticleIds = backlogRows
    .filter((r) => (r.type ?? 'new') === 'new')
    .map((r) => r.articleRecordId);

  const [
    suggestions,
    sourcesByArticle,
    specialties,
    users,
    codesBySlug,
    commentsBySlug,
    sectionsBySlug,
    sectionReviewsBySlug,
  ] = await Promise.all([
    listNewArticleSuggestionsForIds(newRowArticleIds),
    listArticleSourcesForArticleIds(newRowArticleIds),
    listSpecialties(),
    listAssignableUsers(),
    Promise.all(
      specialtySlugs.map(async (slug) => [slug, await listCodes(slug)] as const),
    ),
    Promise.all(
      specialtySlugs.map(
        async (slug) => [slug, await listReviewComments(slug, 'article')] as const,
      ),
    ),
    Promise.all(
      specialtySlugs.map(
        async (slug) => [slug, await listConsolidatedSections(slug)] as const,
      ),
    ),
    Promise.all(
      specialtySlugs.map(async (slug) => [slug, await listSectionReviews(slug)] as const),
    ),
  ]);

  // `pa:`-prefixed comments belong to type='update' rows; rest belong to
  // type='new'. PB record ids are globally unique, so flattening into one
  // map is safe.
  const initialCommentsByArticle: Record<string, ReviewCommentRecord[]> = {};
  for (const [, byArticle] of commentsBySlug) {
    for (const [recordId, list] of Object.entries(byArticle)) {
      if (recordId.startsWith('pa:')) {
        initialCommentsByArticle[recordId.slice(3)] = list;
      } else {
        initialCommentsByArticle[recordId] = list;
      }
    }
  }

  const specialtyNameBySlug: Record<string, string> = {};
  for (const s of specialties) specialtyNameBySlug[s.slug] = s.name;

  const categoryLookup: CategoryLookup = {};
  for (const [, codes] of codesBySlug) {
    for (const c of codes) categoryLookup[c.code] = c.category;
  }

  const sectionsBySpecialty = new Map(sectionsBySlug);
  const sectionReviewsBySpecialty = new Map(sectionReviewsBySlug);

  const rows: MyBacklogRow[] = [];
  const initialBacklog: Record<string, ArticleBacklogRecord> = {};
  const initialSourcesByArticle: Record<string, ArticleSourceRecord[]> = {};

  for (const b of backlogRows) {
    const type = b.type ?? 'new';
    if (type === 'new') {
      const suggestion = suggestions[b.articleRecordId];
      if (!suggestion) continue;
      rows.push({
        id: b.articleRecordId,
        type: 'new',
        specialtySlug: b.specialtySlug,
        specialtyName: specialtyNameBySlug[b.specialtySlug] ?? b.specialtySlug,
        articleTitle: suggestion.articleTitle,
        articleType: suggestion.articleType,
        codes: extractCodes(suggestion.codes),
        sourcesCount: sourcesByArticle[b.articleRecordId]?.length ?? 0,
      });
      initialBacklog[b.articleRecordId] = b;
      initialSourcesByArticle[b.articleRecordId] =
        sourcesByArticle[b.articleRecordId] ?? [];
    } else {
      // type='update': aggregate approved sections for the parent article.
      const sectionRecs = sectionsBySpecialty.get(b.specialtySlug) ?? [];
      const sectionReviews = sectionReviewsBySpecialty.get(b.specialtySlug) ?? {};
      const approvedSections = sectionRecs
        .filter(
          (s) =>
            s.articleId === b.articleRecordId &&
            s.id &&
            sectionReviews[s.id]?.status === 'approved',
        )
        .map(projectSection);
      if (approvedSections.length === 0) continue;
      rows.push({
        id: b.articleRecordId,
        type: 'update',
        specialtySlug: b.specialtySlug,
        specialtyName: specialtyNameBySlug[b.specialtySlug] ?? b.specialtySlug,
        articleTitle: approvedSections[0].articleTitle,
        articleType: undefined,
        codes: unionCodes(approvedSections.flatMap((s) => s.codes)),
        sourcesCount: 0,
        sections: approvedSections,
      });
      initialBacklog[b.articleRecordId] = b;
    }
  }

  rows.sort(
    (a, b) =>
      (a.specialtyName ?? '').localeCompare(b.specialtyName ?? '') ||
      (a.articleTitle ?? '').localeCompare(b.articleTitle ?? ''),
  );

  return (
    <MyBacklogView
      rows={rows}
      categoryLookup={categoryLookup}
      assignableUsers={users}
      initialBacklog={initialBacklog}
      initialSourcesByArticle={initialSourcesByArticle}
      initialCommentsByArticle={initialCommentsByArticle}
      viewerEmail={user.email}
    />
  );
}
