'use client';

import { Callout, Card, CardBox, Column, Columns, Stack } from '@amboss/design-system';
import type { LastStep } from '@/lib/data/last-completed-step';
import type { Specialty } from '@/lib/types';
import { SkeletonLine } from './skeleton';
import { SpecialtyCard } from './specialty-card';

export function SpecialtiesGridView({
  specialties,
  lastSteps,
}: {
  specialties: Specialty[];
  lastSteps: Record<string, LastStep>;
}) {
  if (specialties.length === 0) {
    return <Callout type="info" text="No specialties registered yet. Add one below." />;
  }
  return (
    <Columns gap="m" vAlignItems="stretch">
      {specialties.map((s) => (
        <Column key={s.slug} size={[12, 6, 4]}>
          <SpecialtyCard specialty={s} lastStep={lastSteps[s.slug]} />
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
                  <SkeletonLine width={'80%'} height={14} />
                  <SkeletonLine width={'40%'} height={14} />
                </Stack>
              </CardBox>
            </Card>
          </div>
        </Column>
      ))}
    </Columns>
  );
}
