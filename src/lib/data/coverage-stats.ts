import 'server-only';

import { connection } from 'next/server';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCategoryOrchestration } from '@/lib/data/categories';
import { listCodes } from '@/lib/data/codes';
import {
  type CoverageScoreRow,
  type CoverageStats,
  computeCoverageStats,
} from '@/lib/data/coverage-stats-compute';
import { listConsolidatedSections } from '@/lib/data/sections';

export type { CoverageScoreRow, CoverageStats };

/**
 * Comprehensive per-specialty coverage statistics. The coverage-score
 * distribution and aggregate coverage come from the `codes` collection; the
 * consolidated suggestion stats are counted over the POST-consolidation output
 * (`consolidatedArticles` / `consolidatedSections`, the same rows the
 * Consolidation Review tab shows). Run progress comes from category
 * orchestration. At the low-thousands scale these scans stay well under a
 * second (same assumption as `getOverviewCounts`).
 */
export async function getCoverageStats(slug: string): Promise<CoverageStats> {
  await connection();
  const [codes, consolidatedArticles, consolidatedSections, orchestration] =
    await Promise.all([
      listCodes(slug),
      listConsolidatedArticles(slug),
      listConsolidatedSections(slug),
      listCategoryOrchestration(slug),
    ]);

  // Expected consolidations = real (bucketed) consolidation categories; run =
  // those that have produced consolidated output.
  const buckets = orchestration.filter((o) => !o.isUnbucketed);
  return computeCoverageStats(codes, {
    consolidatedArticles,
    consolidatedSections,
    consolidationsExpected: buckets.length,
    consolidationsRun: buckets.filter((o) => o.hasConsolidatedOutput).length,
  });
}
