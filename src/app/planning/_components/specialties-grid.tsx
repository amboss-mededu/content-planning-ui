'use client';

import { Callout, Card, CardBox, Column, Columns, Stack } from '@amboss/design-system';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import type { Specialty } from '@/lib/types';
import { SkeletonLine } from './skeleton';
import { SpecialtyCard } from './specialty-card';

export function SpecialtiesGridView({
  specialties,
  stageStatesBySlug,
}: {
  specialties: Specialty[];
  stageStatesBySlug: Record<string, PipelineStageStates>;
}) {
  if (specialties.length === 0) {
    return <Callout type="info" text="No specialties registered yet. Add one below." />;
  }
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
