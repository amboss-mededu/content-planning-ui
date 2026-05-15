import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklogForAssignee } from '@/lib/data/article-backlog';
import { computeSectionKey } from '@/lib/data/article-keys';
import { listArticleSourcesForArticleIds } from '@/lib/data/article-sources';
import { listNewArticleSuggestionsForKeys } from '@/lib/data/articles';
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

  // type='new' rows resolve their current suggestion by `articleKey`
  // (stable across consolidation re-runs). Once we have the
  // suggestion, its `.id` is the current PB id we use to look up
  // attached sources.
  const newRowKeys = backlogRows
    .filter((r) => (r.type ?? 'new') === 'new')
    .map((r) => r.articleKey)
    .filter((k): k is string => !!k);

  const [
    suggestions,
    specialties,
    users,
    codesBySlug,
    commentsBySlug,
    sectionsBySlug,
    sectionReviewsBySlug,
  ] = await Promise.all([
    listNewArticleSuggestionsForKeys(newRowKeys),
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

  // Now that we know the current PB id of each resolved suggestion,
  // fetch its sources.
  const currentNewIds = Object.values(suggestions)
    .map((s) => s.id)
    .filter((id): id is string => !!id);
  const sourcesByArticle = await listArticleSourcesForArticleIds(currentNewIds);

  // `listReviewComments` now returns comments grouped by `recordKey`
  // (the stable id). Merge across specialties into one flat map for
  // O(1) lookup in the view.
  const initialCommentsByArticle: Record<string, ReviewCommentRecord[]> = {};
  for (const [, byArticle] of commentsBySlug) {
    for (const [recordKey, list] of Object.entries(byArticle)) {
      initialCommentsByArticle[recordKey] = list;
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
      // Resolve current suggestion through the stable key. Zombies
      // (key doesn't resolve to any row) are silently skipped — they
      // remain in the DB but never reach the UI.
      const suggestion = suggestions[b.articleKey];
      if (!suggestion?.id) continue;
      const currentId = suggestion.id;
      rows.push({
        id: currentId,
        articleKey: b.articleKey,
        type: 'new',
        specialtySlug: b.specialtySlug,
        specialtyName: specialtyNameBySlug[b.specialtySlug] ?? b.specialtySlug,
        articleTitle: suggestion.articleTitle,
        articleType: suggestion.articleType,
        codes: extractCodes(suggestion.codes),
        sourcesCount: sourcesByArticle[currentId]?.length ?? 0,
      });
      initialBacklog[b.articleKey] = b;
      initialSourcesByArticle[currentId] = sourcesByArticle[currentId] ?? [];
    } else {
      // type='update': the backlog row's articleKey is `upd::<cms-articleId>`.
      // Resolve to approved sections under the same parent CMS articleId.
      const parentArticleId = b.articleRecordId;
      const sectionRecs = sectionsBySpecialty.get(b.specialtySlug) ?? [];
      const sectionReviews = sectionReviewsBySpecialty.get(b.specialtySlug) ?? {};
      const approvedSections = sectionRecs
        .filter(
          (s) =>
            s.articleId === parentArticleId &&
            s.sectionKey &&
            sectionReviews[s.sectionKey]?.status === 'approved',
        )
        .map((s) => projectSection(b.specialtySlug, s));
      if (approvedSections.length === 0) continue;
      rows.push({
        id: parentArticleId,
        articleKey: b.articleKey,
        type: 'update',
        specialtySlug: b.specialtySlug,
        specialtyName: specialtyNameBySlug[b.specialtySlug] ?? b.specialtySlug,
        articleTitle: approvedSections[0].articleTitle,
        articleType: undefined,
        codes: unionCodes(approvedSections.flatMap((s) => s.codes)),
        sourcesCount: 0,
        sections: approvedSections,
      });
      initialBacklog[b.articleKey] = b;
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
