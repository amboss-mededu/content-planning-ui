import { Suspense } from 'react';
import {
  listSpecialties,
  listSpecialtyPipelineStageStates,
} from '@/lib/data/specialties';
import { listSpecialtiesOverview } from '@/lib/data/specialties-overview';
import { DashboardEntryView } from './_components/dashboard-entry-view';
import {
  SpecialtiesGridSkeleton,
  SpecialtiesGridView,
} from './_components/specialties-grid';
import {
  SpecialtiesOverviewSkeleton,
  SpecialtiesOverviewView,
} from './_components/specialties-overview';

export default async function PlanningIndex() {
  const specialties = await listSpecialties();
  return (
    <DashboardEntryView
      specialties={specialties}
      specialtiesGrid={
        <Suspense fallback={<SpecialtiesGridSkeleton />}>
          <SpecialtiesGridData />
        </Suspense>
      }
      overview={
        <Suspense fallback={<SpecialtiesOverviewSkeleton />}>
          <AllSpecialtiesOverviewData />
        </Suspense>
      }
    />
  );
}

async function SpecialtiesGridData() {
  const [specialties, stageStatesBySlug] = await Promise.all([
    listSpecialties(),
    listSpecialtyPipelineStageStates(),
  ]);
  return (
    <SpecialtiesGridView
      specialties={specialties}
      stageStatesBySlug={stageStatesBySlug}
    />
  );
}

async function AllSpecialtiesOverviewData() {
  const rows = await listSpecialtiesOverview();
  return <SpecialtiesOverviewView rows={rows} />;
}
