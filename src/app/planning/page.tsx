import { Suspense } from 'react';
import {
  listSpecialties,
  listSpecialtyPipelineStageStates,
} from '@/lib/data/specialties';
import { DashboardEntryView } from './_components/dashboard-entry-view';
import {
  SpecialtiesGridSkeleton,
  SpecialtiesGridView,
} from './_components/specialties-grid';

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
