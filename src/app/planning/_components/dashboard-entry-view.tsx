'use client';

import { H1, H2, Inline, Stack, Text } from '@amboss/design-system';
import type { Specialty } from '@/lib/types';
import { AddSpecialtyButton } from './add-specialty-button';

export function DashboardEntryView({
  specialties,
  specialtiesGrid,
  overview,
}: {
  specialties: Specialty[];
  specialtiesGrid: React.ReactNode;
  overview: React.ReactNode;
}) {
  const hasSpecialties = specialties.length > 0;

  return (
    <Stack space="xl">
      <Stack space="s">
        <H1>Specialty Dashboard</H1>
        <Text color="secondary">
          Review coverage, mapped codes, and consolidation suggestions per specialty.
        </Text>
      </Stack>

      <Stack space="m">
        <Inline alignItems="spaceBetween" vAlignItems="center">
          <H2>Specialties</H2>
          <AddSpecialtyButton />
        </Inline>
        {specialtiesGrid}
      </Stack>

      {hasSpecialties ? (
        <Stack space="m">
          <H2>Specialty comparison</H2>
          {overview}
        </Stack>
      ) : null}
    </Stack>
  );
}
