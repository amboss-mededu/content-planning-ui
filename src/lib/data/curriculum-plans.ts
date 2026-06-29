import 'server-only';

import { connection } from 'next/server';
import { listCodes } from '@/lib/data/codes';
import { listSpecialties } from '@/lib/data/specialties';
import type { CodeRecord } from '@/lib/pb/types';
import type { Specialty } from '@/lib/types';

/**
 * Aggregate statistics for one curriculum plan (a `curriculum-mapping`
 * specialty, where each code row IS a curriculum item). Computed by a single
 * full `listCodes` scan + in-memory reduction — the same pattern as
 * `coverage-stats-compute.ts`, safe at the low-thousands-per-plan scale.
 *
 * The exact cards rendered from these are still being finalised; keep this shape
 * broad so the view can add/drop tiles without touching the query.
 */
export interface CurriculumPlanStats {
  /** Total curriculum items extracted for the plan. */
  totalItems: number;
  /** Human-approved items — the only ones eligible for mapping. */
  approved: number;
  /** Items awaiting review (`curriculumReviewStatus === ''`). */
  pending: number;
  /** Items a human excluded from mapping. */
  rejected: number;
  /** Items that have been mapped (`mappedAt > 0`). */
  mapped: number;
  /** Mapped items that exist in AMBOSS. */
  inAmboss: number;
  /** Distinct AMBOSS articles cited across all items' coverage. */
  uniqueArticles: number;
  /** Total AMBOSS Qbank question matches across all items (duplicates included). */
  totalQuestions: number;
  /** Distinct AMBOSS Qbank questions matched across all items. */
  uniqueQuestions: number;
}

/** A curriculum plan's identity plus its aggregate statistics. */
export interface CurriculumPlanRow {
  specialty: Specialty;
  stats: CurriculumPlanStats;
}

/** All curriculum plans — specialties running the `curriculum-mapping` mode. */
export async function listCurriculumPlans(): Promise<Specialty[]> {
  const specialties = await listSpecialties();
  return specialties.filter((s) => s.pipelineMode === 'curriculum-mapping');
}

/**
 * Pure reducer over a plan's codes — kept separate from the fetch so a caller
 * that already has the codes (e.g. the overview page, which also needs them for
 * the curriculum structure) can derive stats without a second round-trip.
 */
export function computeCurriculumPlanStats(codes: CodeRecord[]): CurriculumPlanStats {
  const stats: CurriculumPlanStats = {
    totalItems: codes.length,
    approved: 0,
    pending: 0,
    rejected: 0,
    mapped: 0,
    inAmboss: 0,
    uniqueArticles: 0,
    totalQuestions: 0,
    uniqueQuestions: 0,
  };
  const articleIds = new Set<string>();
  const questionIds = new Set<string>();

  for (const c of codes) {
    const status = c.curriculumReviewStatus ?? '';
    if (status === 'approved') stats.approved += 1;
    else if (status === 'rejected') stats.rejected += 1;
    else stats.pending += 1;

    if ((c.mappedAt ?? 0) > 0) stats.mapped += 1;
    if (c.isInAMBOSS === true) stats.inAmboss += 1;

    for (const a of c.articlesWhereCoverageIs ?? []) {
      if (a.articleId) articleIds.add(a.articleId);
    }
    const questions = c.questionsWhereCoverageIs ?? [];
    stats.totalQuestions += questions.length;
    for (const q of questions) {
      if (q.questionId) questionIds.add(q.questionId);
    }
  }

  stats.uniqueArticles = articleIds.size;
  stats.uniqueQuestions = questionIds.size;
  return stats;
}

/** Compute one plan's statistics from a full scan of its codes. */
export async function getCurriculumPlanStats(slug: string): Promise<CurriculumPlanStats> {
  return computeCurriculumPlanStats(await listCodes(slug));
}

/**
 * Every curriculum plan with its statistics, fanned out in parallel — mirrors
 * `listSpecialtiesOverview`. Render behind a `<Suspense>` so the page shell
 * paints before the aggregate finishes.
 */
export async function listCurriculumPlansWithStats(): Promise<CurriculumPlanRow[]> {
  await connection();
  const plans = await listCurriculumPlans();
  return Promise.all(
    plans.map(async (specialty) => ({
      specialty,
      stats: await getCurriculumPlanStats(specialty.slug),
    })),
  );
}
