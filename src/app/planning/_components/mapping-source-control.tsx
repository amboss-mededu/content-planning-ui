'use client';

import { SegmentedControl } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MappingSource } from '@/lib/types';
import { COVERAGE_SOURCE_LABEL, coverageSourceOptions } from './coverage-source-copy';

/**
 * Control for a specialty's coverage source (RAG DB / AMBOSS content / Both).
 * PATCHes the specialty and refreshes so the codes table re-renders with the
 * right coverage columns. Mirrors {@link MappingOnlyToggle}'s optimistic
 * persistence; the source only changes which content the NEXT mapping run
 * queries — existing coverage is untouched until a re-map.
 */
export function MappingSourceControl({
  slug,
  mappingSource,
  disabled = false,
  onChange,
}: {
  slug: string;
  mappingSource: MappingSource;
  /** Locked (curriculum-mapping pins the source to AMBOSS). Shows AMBOSS and
   *  blocks edits. */
  disabled?: boolean;
  /** Lets a parent gate dependent UI (e.g. the staging/prod MCP-server
   *  selector) in the same render. Mirrors {@link PipelineModeControl}. */
  onChange?: (next: MappingSource) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<MappingSource>(mappingSource);
  const [saving, setSaving] = useState(false);
  const shown = disabled ? 'amboss' : value;

  const handleChange = async (next: string) => {
    if (disabled) return;
    const source: MappingSource =
      next === 'guidelines' || next === 'both' ? next : 'amboss';
    if (source === value) return;
    const previous = value;
    setValue(source);
    onChange?.(source);
    setSaving(true);
    try {
      const res = await fetch('/api/specialties', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, mappingSource: source }),
      });
      if (!res.ok) {
        setValue(previous); // revert on failure
        onChange?.(previous);
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      onChange?.(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SegmentedControl
      label={COVERAGE_SOURCE_LABEL}
      isLabelHidden
      size="s"
      value={shown}
      onChange={handleChange}
      options={coverageSourceOptions().map((o) => ({
        name: 'mappingSource',
        value: o.value,
        label: o.label,
        disabled: saving || disabled,
      }))}
    />
  );
}
