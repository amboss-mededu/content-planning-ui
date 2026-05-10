import { Suspense } from 'react';
import {
  listArticleUpdateSuggestions,
  listConsolidatedArticles,
  listNewArticleSuggestions,
} from '@/lib/data/articles';
import { listCodes } from '@/lib/data/codes';
import type { CodeRecord } from '@/lib/pb/types';
import type {
  ArticleUpdateSuggestion,
  ConsolidatedArticle,
  NewArticleSuggestion,
} from '@/lib/types';
import { type ArticleRow, ArticlesView } from '../../_components/articles-view';
import { extractCodeStrings } from '../../_components/code-utils';
import { TableSkeleton } from '../../_components/table-skeleton';

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<TableSkeleton columns={8} rows={10} />}>
      <ArticlesData slug={slug} />
    </Suspense>
  );
}

function projectConsolidated(r: ConsolidatedArticle): ArticleRow {
  const codes = extractCodeStrings(r.codes);
  return {
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    category: r.category,
    codes,
    numCodes: r.numCodes ?? codes.length,
    overallCoverage: r.overallCoverage,
    overallImportance: r.overallImportance,
    justification: r.justification,
    pass: 'first',
  };
}

function projectSuggestion(
  r: NewArticleSuggestion | ArticleUpdateSuggestion,
): ArticleRow {
  const codes = extractCodeStrings(r.codes);
  return {
    articleTitle: r.articleTitle,
    articleType: r.articleType,
    // category + numCodes are not on the 2nd-pass schema; fall back where we can.
    category: undefined,
    codes,
    numCodes: codes.length,
    existingAmbossCoverage: r.existingAmbossCoverage,
    overallImportance: r.overallImportance,
    justification: r.justification,
    pass: 'second',
  };
}

async function ArticlesData({ slug }: { slug: string }) {
  const [consolidatedRecs, newRecs, updateRecs, codeRecs] = await Promise.all([
    listConsolidatedArticles(slug),
    listNewArticleSuggestions(slug),
    listArticleUpdateSuggestions(slug),
    listCodes(slug),
  ]);

  const codeMap: Record<string, CodeRecord> = {};
  for (const c of codeRecs) codeMap[c.code] = c;

  const consolidated = consolidatedRecs.map(projectConsolidated);
  const newOnes = newRecs.map(projectSuggestion);
  const updates = updateRecs.map(projectSuggestion);

  return (
    <ArticlesView
      consolidated={consolidated}
      newOnes={newOnes}
      updates={updates}
      codeMap={codeMap}
    />
  );
}
