import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklogForAssignee } from '@/lib/data/article-backlog';
import { listArticleSourcesForArticleIds } from '@/lib/data/article-sources';
import { listNewArticleSuggestionsForIds } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listSpecialties } from '@/lib/data/specialties';
import { listAssignableUsers } from '@/lib/data/users';
import type { ArticleBacklogRecord, ArticleSourceRecord } from '@/lib/pb/types';
import { type CategoryLookup, extractCodes } from '../planning/_components/code-utils';
import { TableSkeleton } from '../planning/_components/table-skeleton';
import { type MyBacklogRow, MyBacklogView } from './_components/my-backlog-view';

export default function MyBacklogPage() {
  return (
    <Suspense fallback={<TableSkeleton columns={9} rows={10} />}>
      <MyBacklogData />
    </Suspense>
  );
}

async function MyBacklogData() {
  const user = await getCurrentUser();
  if (!user?.email) {
    return <p>Sign in to see articles assigned to you.</p>;
  }

  const backlogRows = await listArticleBacklogForAssignee(user.email);

  const articleIds = backlogRows.map((r) => r.articleRecordId);
  const specialtySlugs = Array.from(new Set(backlogRows.map((r) => r.specialtySlug)));

  const [suggestions, sourcesByArticle, specialties, users, codesBySlug] =
    await Promise.all([
      listNewArticleSuggestionsForIds(articleIds),
      listArticleSourcesForArticleIds(articleIds),
      listSpecialties(),
      listAssignableUsers(),
      Promise.all(
        specialtySlugs.map(async (slug) => [slug, await listCodes(slug)] as const),
      ),
    ]);

  const specialtyNameBySlug: Record<string, string> = {};
  for (const s of specialties) specialtyNameBySlug[s.slug] = s.name;

  // Flatten the per-specialty code lookups into one global map. Code
  // identifiers can repeat across specialties but their category is the
  // same source-ontology label, so the merge is safe.
  const categoryLookup: CategoryLookup = {};
  for (const [, codes] of codesBySlug) {
    for (const c of codes) categoryLookup[c.code] = c.category;
  }

  const rows: MyBacklogRow[] = [];
  const initialBacklog: Record<string, ArticleBacklogRecord> = {};
  const initialSourcesByArticle: Record<string, ArticleSourceRecord[]> = {};

  for (const b of backlogRows) {
    const suggestion = suggestions[b.articleRecordId];
    if (!suggestion) continue;
    rows.push({
      id: b.articleRecordId,
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
      viewerEmail={user.email}
    />
  );
}
