import { Suspense } from 'react';
import {
  listSpecialties,
  listSpecialtyPipelineStageStates,
} from '@/lib/data/specialties';
import { listSpecialtiesOverview } from '@/lib/data/specialties-overview';
import type { PipelineMode } from '@/lib/types';
import { DashboardEntryView } from './dashboard-entry-view';
import { SpecialtiesGridSkeleton, SpecialtiesGridView } from './specialties-grid';
import {
  SpecialtiesOverviewSkeleton,
  SpecialtiesOverviewView,
} from './specialties-overview';

// Specialties bucket on `pipelineMode` (legacy/undefined → `full`). Each
// Content Planner subtab renders this dashboard scoped to one mode.
const matchesMode = (mode: PipelineMode) => (s: { pipelineMode?: PipelineMode }) =>
  (s.pipelineMode ?? 'full') === mode;

export function ModeDashboard({ mode }: { mode: PipelineMode }) {
  return (
    <Suspense fallback={null}>
      <ModeDashboardData mode={mode} />
    </Suspense>
  );
}

async function ModeDashboardData({ mode }: { mode: PipelineMode }) {
  const specialties = (await listSpecialties()).filter(matchesMode(mode));
  return (
    <DashboardEntryView
      specialties={specialties}
      specialtiesGrid={
        <Suspense fallback={<SpecialtiesGridSkeleton />}>
          <SpecialtiesGridData mode={mode} />
        </Suspense>
      }
      overview={
        <Suspense fallback={<SpecialtiesOverviewSkeleton />}>
          <OverviewData mode={mode} />
        </Suspense>
      }
    />
  );
}

async function SpecialtiesGridData({ mode }: { mode: PipelineMode }) {
  const [specialties, stageStatesBySlug] = await Promise.all([
    listSpecialties(),
    listSpecialtyPipelineStageStates(),
  ]);
  return (
    <SpecialtiesGridView
      specialties={specialties.filter(matchesMode(mode))}
      stageStatesBySlug={stageStatesBySlug}
    />
  );
}

async function OverviewData({ mode }: { mode: PipelineMode }) {
  const rows = await listSpecialtiesOverview();
  return (
    <SpecialtiesOverviewView rows={rows.filter((r) => matchesMode(mode)(r.specialty))} />
  );
}
