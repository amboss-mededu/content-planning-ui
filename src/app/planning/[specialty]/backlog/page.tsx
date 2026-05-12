import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listArticleSourcesByArticle } from '@/lib/data/article-sources';
import { listNewArticleSuggestions } from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import { listAssignableUsers } from '@/lib/data/users';
import type { ArticleBacklogRecord, ArticleSourceRecord } from '@/lib/pb/types';
import type { NewArticleSuggestion } from '@/lib/types';
import { type BacklogRow, BacklogView } from '../../_components/backlog-view';
import { type CategoryLookup, extractCodes } from '../../_components/code-utils';
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

function projectSuggestion(
  r: NewArticleSuggestion,
  sourcesByArticle: Record<string, ArticleSourceRecord[]>,
): BacklogRow {
  return {
    id: r.id ?? '',
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    codes: extractCodes(r.codes),
    sourcesCount: r.id ? (sourcesByArticle[r.id]?.length ?? 0) : 0,
  };
}

async function BacklogData({ slug }: { slug: string }) {
  const [newRecs, reviewRecs, backlogRecs, sourcesByArticle, codeRecs, users, user] =
    await Promise.all([
      listNewArticleSuggestions(slug),
      listArticleReviews(slug),
      listArticleBacklog(slug),
      listArticleSourcesByArticle(slug),
      listCodes(slug),
      listAssignableUsers(),
      getCurrentUser(),
    ]);

  const categoryLookup: CategoryLookup = {};
  for (const c of codeRecs) categoryLookup[c.code] = c.category;

  const approved = newRecs.filter((r) => r.id && reviewRecs[r.id]?.status === 'approved');
  const rows = approved.map((r) => projectSuggestion(r, sourcesByArticle));

  const initialBacklog: Record<string, ArticleBacklogRecord> = backlogRecs;

  return (
    <BacklogView
      slug={slug}
      rows={rows}
      categoryLookup={categoryLookup}
      assignableUsers={users}
      initialBacklog={initialBacklog}
      initialSourcesByArticle={sourcesByArticle}
      viewerEmail={user?.email ?? undefined}
    />
  );
}
