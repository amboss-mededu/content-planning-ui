import { Suspense } from 'react';
import { listCodes } from '@/lib/data/codes';
import { getCoverageStats } from '@/lib/data/coverage-stats';
import { computeCurriculumPlanStats } from '@/lib/data/curriculum-plans';
import { listStudyPlans } from '@/lib/data/study-plans';
import { CurriculumDashboard } from '../_components/curriculum-dashboard';

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
  const [coverageStats, codes, studyPlans] = await Promise.all([
    getCoverageStats(slug),
    listCodes(slug),
    listStudyPlans(slug),
  ]);
  const stats = computeCurriculumPlanStats(codes);

  return (
    <CurriculumDashboard
      slug={slug}
      stats={stats}
      coverageStats={coverageStats}
      codes={codes}
      studyPlans={studyPlans}
    />
  );
}
