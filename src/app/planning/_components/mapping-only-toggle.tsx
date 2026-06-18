'use client';

import { Toggle } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Header toggle for a specialty's "Mapping only" mode. Flipping it PATCHes
 * the specialty and refreshes so the server-derived tab list, pipeline, and
 * mapping sheet re-render. Flipping OFF surfaces the "Generate suggestions"
 * backfill stage on the pipeline dashboard.
 */
export function MappingOnlyToggle({
  slug,
  mappingOnly,
}: {
  slug: string;
  mappingOnly: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // Optimistic local value so the switch reflects the click immediately.
  const [value, setValue] = useState(mappingOnly);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch('/api/specialties', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, mappingOnly: next }),
      });
      if (!res.ok) {
        setValue(!next); // revert on failure
        return;
      }
      router.refresh();
    } catch {
      setValue(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Toggle
      name="mappingOnly"
      label="Mapping only"
      alignLabel="after"
      size="s"
      checked={value}
      disabled={saving}
      onChange={onChange}
    />
  );
}
