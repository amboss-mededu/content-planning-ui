'use client';

import {
  Callout,
  Card,
  CardBox,
  Column,
  Columns,
  H3,
  Stack,
} from '@amboss/design-system';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import type { PipelineMode, Specialty } from '@/lib/types';
import { SkeletonLine } from './skeleton';
import { SpecialtyCard } from './specialty-card';

/** Card-grid groupings, in display order. Specialties bucket on `pipelineMode`
 *  (legacy/undefined → `full`). */
const GROUPS: { mode: PipelineMode; label: string }[] = [
  { mode: 'full', label: 'Full pipeline' },
  { mode: 'rag-corpus', label: 'RAG corpus' },
  { mode: 'curriculum-mapping', label: 'Curriculum mapping' },
  { mode: 'mapping-only', label: 'Mapping only' },
];

function CardGrid({
  specialties,
  stageStatesBySlug,
}: {
  specialties: Specialty[];
  stageStatesBySlug: Record<string, PipelineStageStates>;
}) {
  return (
    <Columns gap="m" vAlignItems="stretch">
      {specialties.map((s) => (
        <Column key={s.slug} size={[12, 6, 4]}>
          <SpecialtyCard specialty={s} stageStates={stageStatesBySlug[s.slug]} />
        </Column>
      ))}
    </Columns>
  );
}

export function SpecialtiesGridView({
  specialties,
  stageStatesBySlug,
}: {
  specialties: Specialty[];
  stageStatesBySlug: Record<string, PipelineStageStates>;
}) {
  if (specialties.length === 0) {
    return (
      <Callout
        type="info"
        text="No specialties registered yet. Use “Add specialty” to create one."
      />
    );
  }

  const groups = GROUPS.map((g) => ({
    ...g,
    items: specialties.filter((s) => (s.pipelineMode ?? 'full') === g.mode),
  })).filter((g) => g.items.length > 0);

  // Single mode in play → keep the flat grid (no redundant heading).
  if (groups.length <= 1) {
    return <CardGrid specialties={specialties} stageStatesBySlug={stageStatesBySlug} />;
  }

  return (
    <Stack space="l">
      {groups.map((g) => (
        <Stack key={g.mode} space="s">
          <H3>{g.label}</H3>
          <CardGrid specialties={g.items} stageStatesBySlug={stageStatesBySlug} />
        </Stack>
      ))}
    </Stack>
  );
}

export function SpecialtiesGridSkeleton() {
  return (
    <Columns gap="m" vAlignItems="stretch">
      {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
        <Column key={k} size={[12, 6, 4]}>
          <div className="card-fill">
            <Card outlined>
              <CardBox>
                <Stack space="s">
                  <SkeletonLine width={'60%'} height={20} />
                  <SkeletonLine width={'95%'} height={18} />
                </Stack>
              </CardBox>
            </Card>
          </div>
        </Column>
      ))}
    </Columns>
  );
}
