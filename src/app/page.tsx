import { Suspense } from 'react';
import {
  listSpecialties,
  listSpecialtyPipelineStageStates,
} from '@/lib/data/specialties';
import { HomeShell, SpecialtiesJumpToShell } from './planning/_components/home-shell';
import {
  SpecialtiesGridSkeleton,
  SpecialtiesGridView,
} from './planning/_components/specialties-grid';
import { SpecialtyEntry } from './planning/_components/specialty-entry';

export default function Home() {
  return (
    <HomeShell
      specialtiesGrid={
        <Suspense fallback={<SpecialtiesGridSkeleton />}>
          <SpecialtiesGridData />
        </Suspense>
      }
      jumpTo={
        <Suspense fallback={null}>
          <SpecialtiesJumpToData />
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

async function SpecialtiesJumpToData() {
  const specialties = await listSpecialties();
  if (specialties.length === 0) return null;
  return <SpecialtiesJumpToShell entry={<SpecialtyEntry specialties={specialties} />} />;
}
