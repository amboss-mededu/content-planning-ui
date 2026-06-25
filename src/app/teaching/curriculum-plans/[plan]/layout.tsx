import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { SpecialtyTabs } from '@/app/planning/_components/specialty-tabs';
import { CurriculumPlanHeader } from '@/app/teaching/_components/curriculum-plan-header';
import { getSpecialty } from '@/lib/data/specialties';
import { getTabsComplete } from '@/lib/data/tab-status';

// Curriculum plans reuse the specialty tab shell but only need Overview,
// Pipeline, and Mapping — the milestones / consolidation / backlog / drift
// stages don't apply to curriculum-mapping.
const CURRICULUM_HIDDEN_SEGMENTS = new Set([
  'milestones',
  'consolidation-review',
  'backlog',
  'drift',
]);

const BASE_PATH = '/teaching/curriculum-plans';

export default async function CurriculumPlanLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ plan: string }>;
}) {
  const { plan: slug } = await params;
  // Guard the whole segment: only curriculum-mapping specialties live here.
  const specialty = await getSpecialty(slug);
  if (!specialty || specialty.pipelineMode !== 'curriculum-mapping') {
    notFound();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <CurriculumPlanHeader name={specialty.name}>
        <Suspense fallback={null}>
          <CurriculumTabsData slug={slug} />
        </Suspense>
      </CurriculumPlanHeader>
      {children}
    </div>
  );
}

async function CurriculumTabsData({ slug }: { slug: string }) {
  const tabsComplete = await getTabsComplete(slug);
  return (
    <SpecialtyTabs
      slug={slug}
      tabsComplete={tabsComplete}
      hiddenSegments={CURRICULUM_HIDDEN_SEGMENTS}
      basePath={BASE_PATH}
    />
  );
}
