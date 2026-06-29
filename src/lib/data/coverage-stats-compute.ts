import type { CodeRecord, CoveredSection } from '@/lib/pb/types';

/** Minimal shape of a post-consolidation new-article row (consolidatedArticles). */
export interface ConsolidatedArticleInput {
  overallCoverage?: number;
}

/** Minimal shape of a post-consolidation section-change row (consolidatedSections). */
export interface ConsolidatedSectionInput {
  exists?: boolean;
  overallCoverage?: number;
  articleKey?: string;
  articleId?: string;
  articleTitle?: string;
}

/** Run progress + post-consolidation output, sourced server-side. */
export interface CoverageStatsInput {
  consolidatedArticles?: ConsolidatedArticleInput[];
  consolidatedSections?: ConsolidatedSectionInput[];
  consolidationsRun?: number;
  consolidationsExpected?: number;
}

/** Distribution row for one coverage score (0–5). Percentages are relative to
 *  the number of mapped/scored codes so the (reverse-)cumulative columns end at
 *  100%. */
export interface CoverageScoreRow {
  score: number;
  count: number;
  pct: number;
  cumCount: number;
  cumPct: number;
  revCumCount: number;
  revCumPct: number;
}

export interface CoverageStats {
  // Overall
  total: number;
  mappedCount: number;
  unmappedCount: number;
  inAmboss: number;
  notInAmboss: number;
  pctInAmboss: number;
  pctNotInAmboss: number;
  avgCoverage: number;
  pctCoverageGte3: number;
  pctCoverageLt3: number;

  // Coverage score distribution (scores 0–5, over mapped codes)
  scoreRows: CoverageScoreRow[];

  // Aggregate article/section coverage (averages ÷ total codes)
  totalArticlesCovered: number;
  avgArticlesCovered: number;
  uniqueArticlesCovered: number;
  avgUniqueArticlesCovered: number;
  totalSectionsCovered: number;
  avgSectionsCovered: number;
  uniqueSectionsCovered: number;
  avgUniqueSectionsCovered: number;

  // Consolidation run progress
  consolidationsRun: number;
  consolidationsExpected: number;

  // Consolidated suggestion stats — counted over the POST-consolidation output
  // (consolidatedArticles / consolidatedSections), i.e. the articles/sections
  // that exist after the consolidation step, as shown on the Consolidation
  // Review tab. "< 3" = rows whose `overallCoverage` (0–5) is below 3.
  numConsolidations: number;
  newArticles: number;
  newArticlesLt3: number;
  avgNewArticlesPerConsolidation: number;
  articleUpdates: number;
  articleUpdatesLt3: number;
  avgArticleUpdatesPerConsolidation: number;
  totalSectionChanges: number;
  totalSectionChangesLt3: number;
  newSections: number;
  newSectionsLt3: number;
  sectionUpdates: number;
  sectionUpdatesLt3: number;
  avgSectionsPerConsolidation: number;
}

const SCORE_MIN = 0;
const SCORE_MAX = 5;
const COVERAGE_THRESHOLD = 3;

/** Percentage of n out of d, to 2 decimals; 0 when d is 0. */
function pct(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 100;
}

/** Mean to 2 decimals; 0 when d is 0. */
function avg(total: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((total / d) * 100) / 100;
}

/** PocketBase JSON fields may arrive as a parsed array or a JSON string. */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function isMapped(c: CodeRecord): boolean {
  return (c.mappedAt ?? 0) > 0;
}

/**
 * Coverage score clamped to 0–5; unset treated as 0. Prefers the overall
 * (synthesized / active-source) score, falling back to the AMBOSS score for
 * rows mapped before the overall track existed.
 *
 * The fallback is gated on `overallCoverageLevel` (written alongside the overall
 * score), NOT on `typeof overallDepthOfCoverage === 'number'`: that column is a
 * PocketBase NUMERIC that defaults to 0, so legacy AMBOSS-only rows carry
 * `overallDepthOfCoverage === 0` rather than `undefined`. A plain numeric/`??`
 * check therefore reads those rows as "scored 0" and never falls back, which
 * zeroed out the whole coverage distribution. Mirrors `coverageLevelOf` in
 * `curriculum-analytics.ts`.
 */
export function coverageScoreOf(
  c: Pick<
    CodeRecord,
    'overallCoverageLevel' | 'overallDepthOfCoverage' | 'depthOfCoverage'
  >,
): number {
  const raw = c.overallCoverageLevel
    ? (c.overallDepthOfCoverage ?? 0)
    : (c.depthOfCoverage ?? 0);
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(raw)));
}

/** A consolidated row is "low coverage" when its overallCoverage is below 3. */
function isLowCoverage(overallCoverage?: number): boolean {
  return typeof overallCoverage === 'number' && overallCoverage < COVERAGE_THRESHOLD;
}

/**
 * Per-specialty coverage statistics. The coverage-score distribution, overall
 * counts, and aggregate article/section coverage derive from the `codes`
 * collection. The consolidated suggestion stats are counted over the
 * POST-consolidation output (`consolidatedArticles` / `consolidatedSections`)
 * passed in via `input`. Side-effect-free so it can be unit-tested without a
 * PocketBase connection.
 */
export function computeCoverageStats(
  codes: CodeRecord[],
  input?: CoverageStatsInput,
): CoverageStats {
  const total = codes.length;
  const mapped = codes.filter(isMapped);
  const mappedCount = mapped.length;
  const unmappedCount = total - mappedCount;

  // --- Overall --------------------------------------------------------------
  let inAmboss = 0;
  let depthSum = 0;
  let countGte3 = 0;
  const scoreCounts = new Array(SCORE_MAX + 1).fill(0) as number[];
  for (const c of mapped) {
    if (c.isInAMBOSS === true) inAmboss++;
    const s = coverageScoreOf(c);
    depthSum += s;
    scoreCounts[s]++;
    if (s >= COVERAGE_THRESHOLD) countGte3++;
  }
  const notInAmboss = total - inAmboss;
  const countLt3 = mappedCount - countGte3;

  // --- Coverage score distribution -----------------------------------------
  const scoreRows: CoverageScoreRow[] = [];
  let cum = 0;
  for (let s = SCORE_MIN; s <= SCORE_MAX; s++) {
    const count = scoreCounts[s];
    cum += count;
    const revCum = mappedCount - (cum - count);
    scoreRows.push({
      score: s,
      count,
      pct: pct(count, mappedCount),
      cumCount: cum,
      cumPct: pct(cum, mappedCount),
      revCumCount: revCum,
      revCumPct: pct(revCum, mappedCount),
    });
  }

  // --- Aggregate article/section coverage (from the per-code mapping) -------
  let totalArticlesCovered = 0;
  let totalSectionsCovered = 0;
  const uniqueArticleIds = new Set<string>();
  const uniqueSectionIds = new Set<string>();
  const consolidations = new Set<string>();

  for (const c of codes) {
    if (c.consolidationCategory) consolidations.add(c.consolidationCategory);

    const coverage = asArray<CoveredSection>(c.articlesWhereCoverageIs);
    for (const cov of coverage) {
      totalArticlesCovered++;
      if (cov.articleId) uniqueArticleIds.add(cov.articleId);
      const sections = Array.isArray(cov.sections) ? cov.sections : [];
      for (const sec of sections) {
        totalSectionsCovered++;
        if (sec.sectionId) uniqueSectionIds.add(sec.sectionId);
      }
    }
  }

  // --- Consolidated suggestions (post-consolidation output) ----------------
  const consolidatedArticles = input?.consolidatedArticles ?? [];
  const consolidatedSections = input?.consolidatedSections ?? [];

  const newArticles = consolidatedArticles.length;
  const newArticlesLt3 = consolidatedArticles.filter((a) =>
    isLowCoverage(a.overallCoverage),
  ).length;

  let totalSectionChanges = 0;
  let totalSectionChangesLt3 = 0;
  let newSections = 0;
  let newSectionsLt3 = 0;
  let sectionUpdates = 0;
  let sectionUpdatesLt3 = 0;
  const updatedArticles = new Set<string>();
  const updatedArticlesLt3 = new Set<string>();

  for (const s of consolidatedSections) {
    const lt3 = isLowCoverage(s.overallCoverage);
    totalSectionChanges++;
    if (lt3) totalSectionChangesLt3++;
    // exists === true → update an existing section; false → brand-new section
    // (matches the Consolidation Review tab's updateType derivation).
    if (s.exists === false) {
      newSections++;
      if (lt3) newSectionsLt3++;
    } else if (s.exists === true) {
      sectionUpdates++;
      if (lt3) sectionUpdatesLt3++;
    }
    const articleKey = s.articleKey || s.articleId || s.articleTitle || '';
    if (articleKey) {
      updatedArticles.add(articleKey);
      if (lt3) updatedArticlesLt3.add(articleKey);
    }
  }

  const articleUpdates = updatedArticles.size;
  const articleUpdatesLt3 = updatedArticlesLt3.size;
  const numConsolidations = consolidations.size;
  const consolidationsExpected = input?.consolidationsExpected ?? numConsolidations;
  const consolidationsRun = input?.consolidationsRun ?? 0;

  return {
    total,
    mappedCount,
    unmappedCount,
    inAmboss,
    notInAmboss,
    pctInAmboss: pct(inAmboss, total),
    pctNotInAmboss: pct(notInAmboss, total),
    avgCoverage: avg(depthSum, mappedCount),
    pctCoverageGte3: pct(countGte3, mappedCount),
    pctCoverageLt3: pct(countLt3, mappedCount),

    scoreRows,

    totalArticlesCovered,
    avgArticlesCovered: avg(totalArticlesCovered, total),
    uniqueArticlesCovered: uniqueArticleIds.size,
    avgUniqueArticlesCovered: avg(uniqueArticleIds.size, total),
    totalSectionsCovered,
    avgSectionsCovered: avg(totalSectionsCovered, total),
    uniqueSectionsCovered: uniqueSectionIds.size,
    avgUniqueSectionsCovered: avg(uniqueSectionIds.size, total),

    consolidationsRun,
    consolidationsExpected,

    numConsolidations,
    newArticles,
    newArticlesLt3,
    // Per-consolidation averages divide by the consolidations that have RUN
    // (suggestions only exist for run consolidations), not the total expected.
    avgNewArticlesPerConsolidation: avg(newArticles, consolidationsRun),
    articleUpdates,
    articleUpdatesLt3,
    avgArticleUpdatesPerConsolidation: avg(articleUpdates, consolidationsRun),
    totalSectionChanges,
    totalSectionChangesLt3,
    newSections,
    newSectionsLt3,
    sectionUpdates,
    sectionUpdatesLt3,
    avgSectionsPerConsolidation: avg(totalSectionChanges, consolidationsRun),
  };
}
