'use client';

import { Callout, Stack, Text } from '@amboss/design-system';
import { useEffect, useState } from 'react';
import type { AmbossLibraryStats } from '@/lib/data/amboss-library';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import { StartMapCodesForm } from './start-map-codes-form';

type FormData = {
  libraryStats: AmbossLibraryStats;
  categories: CodeCategorySummary[];
  unmappedCodes: UnmappedCodePickerRow[];
};

export function LazyStartMapCodesForm({
  specialtySlug,
  unmappedCount,
  defaultContentBase,
}: {
  specialtySlug: string;
  unmappedCount: number;
  defaultContentBase: string;
}) {
  const [data, setData] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/pipeline/${encodeURIComponent(specialtySlug)}/map-codes-form-data`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) setData(body as FormData);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [specialtySlug]);

  if (error) return <Callout type="error" text={error} />;
  if (!data) {
    return (
      <Stack space="xs">
        <Text color="secondary">Loading mapping options...</Text>
      </Stack>
    );
  }

  return (
    <StartMapCodesForm
      specialtySlug={specialtySlug}
      unmappedCount={unmappedCount}
      defaultContentBase={defaultContentBase}
      libraryStats={data.libraryStats}
      categories={data.categories}
      unmappedCodes={data.unmappedCodes}
    />
  );
}
