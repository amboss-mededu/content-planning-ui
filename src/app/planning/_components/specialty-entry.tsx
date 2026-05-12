'use client';

import { Button, Inline, Select } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Specialty } from '@/lib/types';

export function SpecialtyEntry({
  specialties,
  initialSlug = '',
}: {
  specialties: Specialty[];
  initialSlug?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(initialSlug);

  useEffect(() => {
    if (initialSlug) setValue(initialSlug);
  }, [initialSlug]);

  const options = specialties.map((s) => ({
    value: s.slug,
    label: s.name,
  }));

  const onSubmit = () => {
    if (!value) return;
    router.push(`/planning/${encodeURIComponent(value)}`);
  };

  return (
    <Inline space="s" vAlignItems="bottom">
      <Select
        name="specialty"
        label="Open a specialty"
        placeholder="Specialty"
        options={options}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button onClick={onSubmit} disabled={!value}>
        Open
      </Button>
    </Inline>
  );
}
