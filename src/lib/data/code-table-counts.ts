import type {
  CoveredSection,
  GuidelineCoverage,
  NewArticle,
  SectionUpdate,
} from '@/lib/pb/types';

export type CodeTableCountInput = {
  articlesWhereCoverageIs?: CoveredSection[] | string;
  existingArticleUpdates?: SectionUpdate[] | string;
  newArticlesNeeded?: NewArticle[] | string;
  guidelinesWhereCoverageIs?: GuidelineCoverage[] | string;
  coverageArticleCount?: number;
  coverageSectionCount?: number;
  existingArticleUpdateCount?: number;
  newArticleSuggestionCount?: number;
  guidelineCount?: number;
  guidelineRecommendationCount?: number;
};

export function deriveCodeTableCounts(input: CodeTableCountInput): {
  coverageArticleCount: number;
  coverageSectionCount: number;
  existingArticleUpdateCount: number;
  newArticleSuggestionCount: number;
  guidelineCount: number;
  guidelineRecommendationCount: number;
} {
  const coverage = asArray<CoveredSection>(input.articlesWhereCoverageIs);
  const updates = asArray<SectionUpdate>(input.existingArticleUpdates);
  const newArticles = asArray<NewArticle>(input.newArticlesNeeded);
  const guidelines = asArray<GuidelineCoverage>(input.guidelinesWhereCoverageIs);
  return {
    coverageArticleCount: coverage?.length ?? input.coverageArticleCount ?? 0,
    coverageSectionCount: coverage
      ? countCoveredSections(coverage)
      : (input.coverageSectionCount ?? 0),
    existingArticleUpdateCount: updates?.length ?? input.existingArticleUpdateCount ?? 0,
    newArticleSuggestionCount:
      newArticles?.length ?? input.newArticleSuggestionCount ?? 0,
    guidelineCount: guidelines?.length ?? input.guidelineCount ?? 0,
    guidelineRecommendationCount: guidelines
      ? countGuidelineRecommendations(guidelines)
      : (input.guidelineRecommendationCount ?? 0),
  };
}

function countGuidelineRecommendations(items: GuidelineCoverage[]): number {
  let n = 0;
  for (const item of items) {
    const recs = item.recommendations;
    if (Array.isArray(recs)) n += recs.length;
    else if (recs && typeof recs === 'object') n += Object.keys(recs).length;
  }
  return n;
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
