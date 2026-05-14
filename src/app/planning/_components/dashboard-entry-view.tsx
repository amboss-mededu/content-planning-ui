'use client';

import { Callout, H1, Stack, Text } from '@amboss/design-system';
import { useEffect, useState } from 'react';
import type { Specialty } from '@/lib/types';
import { SpecialtyEntry } from './specialty-entry';

const STORAGE_KEY = 'lastSpecialty';

export function DashboardEntryView({
  specialties,
  specialtiesGrid,
}: {
  specialties: Specialty[];
  specialtiesGrid: React.ReactNode;
}) {
  const [lastSlug, setLastSlug] = useState<string>('');

  useEffect(() => {
    const last = window.localStorage.getItem(STORAGE_KEY) ?? '';
    if (last && specialties.some((s) => s.slug === last)) setLastSlug(last);
  }, [specialties]);

  return (
    <Stack space="xl">
      <Stack space="s">
        <H1>Specialty Dashboard</H1>
        <Text color="secondary">
          {lastSlug
            ? 'Pick a specialty to switch, or open the last one you viewed.'
            : 'Pick a specialty to view its content plan.'}
        </Text>
      </Stack>
      {specialties.length === 0 ? (
        <Callout type="info" text="No specialties registered." />
      ) : (
        <SpecialtyEntry specialties={specialties} initialSlug={lastSlug} />
      )}
      {specialtiesGrid}
    </Stack>
  );
}
