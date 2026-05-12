import { Suspense } from 'react';
import { listSpecialtyLastSteps } from '@/lib/data/last-completed-step';
import { listSpecialties } from '@/lib/data/specialties';
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
  const [specialties, lastSteps] = await Promise.all([
    listSpecialties(),
    listSpecialtyLastSteps(),
  ]);
  return <SpecialtiesGridView specialties={specialties} lastSteps={lastSteps} />;
}
