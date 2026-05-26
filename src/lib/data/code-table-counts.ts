import type { CoveredSection, NewArticle, SectionUpdate } from '@/lib/pb/types';

export type CodeTableCountInput = {
  articlesWhereCoverageIs?: CoveredSection[] | string;
  existingArticleUpdates?: SectionUpdate[] | string;
  newArticlesNeeded?: NewArticle[] | string;
  coverageArticleCount?: number;
  coverageSectionCount?: number;
  existingArticleUpdateCount?: number;
  newArticleSuggestionCount?: number;
};

export function deriveCodeTableCounts(input: CodeTableCountInput): {
  coverageArticleCount: number;
  coverageSectionCount: number;
  existingArticleUpdateCount: number;
  newArticleSuggestionCount: number;
} {
  const coverage = asArray<CoveredSection>(input.articlesWhereCoverageIs);
  const updates = asArray<SectionUpdate>(input.existingArticleUpdates);
  const newArticles = asArray<NewArticle>(input.newArticlesNeeded);
  return {
    coverageArticleCount: coverage?.length ?? input.coverageArticleCount ?? 0,
    coverageSectionCount: coverage
      ? countCoveredSections(coverage)
      : (input.coverageSectionCount ?? 0),
    existingArticleUpdateCount: updates?.length ?? input.existingArticleUpdateCount ?? 0,
    newArticleSuggestionCount:
      newArticles?.length ?? input.newArticleSuggestionCount ?? 0,
  };
}

function countCoveredSections(items: CoveredSection[]): number {
  let n = 0;
  for (const item of items) {
    const sections = item.sections;
    if (Array.isArray(sections)) n += sections.length;
    else if (sections && typeof sections === 'object') {
      n += Object.keys(sections).length;
    }
  }
  return n;
}

function asArray<T>(value: unknown): T[] | null {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}
