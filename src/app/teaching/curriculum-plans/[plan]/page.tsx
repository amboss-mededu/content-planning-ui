import { Suspense } from 'react';
import { listCodes } from '@/lib/data/codes';
import { getCoverageStats } from '@/lib/data/coverage-stats';
import { computeCurriculumPlanStats } from '@/lib/data/curriculum-plans';
import { CurriculumOverviewView } from '../../_components/curriculum-overview-view';

export default async function CurriculumPlanOverviewPage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const { plan: slug } = await params;
  return (
    <Suspense fallback={null}>
      <CurriculumPlanOverviewData slug={slug} />
    </Suspense>
  );
}

// The layout already guards that `slug` is a curriculum-mapping specialty.
async function CurriculumPlanOverviewData({ slug }: { slug: string }) {
  const [coverageStats, codes] = await Promise.all([
    getCoverageStats(slug),
    listCodes(slug),
  ]);
  const stats = computeCurriculumPlanStats(codes);

  return (
    <CurriculumOverviewView stats={stats} coverageStats={coverageStats} codes={codes} />
  );
}
