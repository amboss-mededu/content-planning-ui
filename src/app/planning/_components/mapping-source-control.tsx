'use client';

import { SegmentedControl } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MappingSource } from '@/lib/types';

/**
 * Header control for a specialty's mapping source (AMBOSS / Guidelines / Both).
 * PATCHes the specialty and refreshes so the codes table re-renders with the
 * right coverage columns. Mirrors {@link MappingOnlyToggle}'s optimistic
 * persistence; the source only changes which content the NEXT mapping run
 * queries — existing coverage is untouched until a re-map.
 */
export function MappingSourceControl({
  slug,
  mappingSource,
}: {
  slug: string;
  mappingSource: MappingSource;
}) {
  const router = useRouter();
  const [value, setValue] = useState<MappingSource>(mappingSource);
  const [saving, setSaving] = useState(false);

  const onChange = async (next: string) => {
    const source: MappingSource =
      next === 'guidelines' || next === 'both' ? next : 'amboss';
    if (source === value) return;
    const previous = value;
    setValue(source);
    setSaving(true);
    try {
      const res = await fetch('/api/specialties', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, mappingSource: source }),
      });
      if (!res.ok) {
        setValue(previous); // revert on failure
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SegmentedControl
      label="Mapping source"
      isLabelHidden
      size="s"
      value={value}
      onChange={onChange}
      options={[
        { name: 'mappingSource', value: 'amboss', label: 'AMBOSS', disabled: saving },
        {
          name: 'mappingSource',
          value: 'guidelines',
          label: 'Guidelines',
          disabled: saving,
        },
        { name: 'mappingSource', value: 'both', label: 'Both', disabled: saving },
      ]}
    />
  );
}
