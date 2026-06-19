import 'server-only';

import { connection } from 'next/server';
import { type BacklogStats, getBacklogStats } from '@/lib/data/backlog-stats';
import { type CoverageStats, getCoverageStats } from '@/lib/data/coverage-stats';
import { listSpecialties } from '@/lib/data/specialties';
import type { Specialty } from '@/lib/types';

export type { BacklogStats, CoverageStats };

/** One specialty's identity plus its coverage + backlog statistics, used by the
 *  cross-specialty overview (comparison table + charts) on the dashboard. */
export interface SpecialtyOverviewRow {
  specialty: Specialty;
  coverage: CoverageStats;
  backlog: BacklogStats;
}

/**
 * Coverage + backlog statistics for every specialty, for the dashboard's
 * all-specialties overview. Reuses the per-specialty `getCoverageStats` /
 * `getBacklogStats` (no new PocketBase queries) and fans them out in parallel.
 *
 * Cost is N specialties × the handful of reads each stat fn already does;
 * `Promise.all` runs them concurrently and the underlying scans stay well under
 * a second at the low-thousands-per-specialty scale those functions assume.
 * Callers render this behind its own `<Suspense>` so the page shell and the
 * specialty-card grid paint before the aggregate finishes.
 */
export async function listSpecialtiesOverview(): Promise<SpecialtyOverviewRow[]> {
  await connection();
  const specialties = await listSpecialties();
  return Promise.all(
    specialties.map(async (specialty) => {
      const [coverage, backlog] = await Promise.all([
        getCoverageStats(specialty.slug),
        getBacklogStats(specialty.slug),
      ]);
      return { specialty, coverage, backlog };
    }),
  );
}
