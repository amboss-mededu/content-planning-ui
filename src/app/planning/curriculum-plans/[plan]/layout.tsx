import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { SpecialtyTabs } from '@/app/planning/_components/specialty-tabs';
import { CreateStudyPlanButton } from '@/app/planning/curriculum-plans/_components/create-study-plan-button';
import { CurriculumPlanHeader } from '@/app/planning/curriculum-plans/_components/curriculum-plan-header';
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

const BASE_PATH = '/planning/curriculum-plans';

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
  // Tabs on the left grow to fill the row (so the stepper underline spans it);
  // the "Create study plan" action floats to the far right, aligned to the
  // baseline. The button self-hides off the Overview page.
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SpecialtyTabs
          slug={slug}
          tabsComplete={tabsComplete}
          hiddenSegments={CURRICULUM_HIDDEN_SEGMENTS}
          basePath={BASE_PATH}
        />
      </div>
      <CreateStudyPlanButton slug={slug} />
    </div>
  );
}
