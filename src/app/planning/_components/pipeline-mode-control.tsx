'use client';

import { SegmentedControl } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PipelineMode } from '@/lib/types';

const MODES: readonly PipelineMode[] = [
  'full',
  'mapping-only',
  'rag-corpus',
  'curriculum-mapping',
];

function coerce(value: string): PipelineMode {
  return (MODES as readonly string[]).includes(value) ? (value as PipelineMode) : 'full';
}

/**
 * Settings control for a specialty's workflow mode. PATCHes the specialty and
 * refreshes so the tabs / dashboard / mapping sheet re-render for the new mode.
 * Mirrors {@link MappingSourceControl}'s optimistic persistence. Switching to
 * `'rag-corpus'` pins the mapping source to guidelines and `'curriculum-mapping'`
 * pins it to AMBOSS, server-side; `onChange` lets the parent gate the source
 * control in the same render.
 */
export function PipelineModeControl({
  slug,
  pipelineMode,
  onChange,
}: {
  slug: string;
  pipelineMode: PipelineMode;
  onChange?: (mode: PipelineMode) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<PipelineMode>(pipelineMode);
  const [saving, setSaving] = useState(false);

  const change = async (next: string) => {
    const mode = coerce(next);
    if (mode === value) return;
    const previous = value;
    setValue(mode);
    onChange?.(mode);
    setSaving(true);
    try {
      const res = await fetch('/api/specialties', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, pipelineMode: mode }),
      });
      if (!res.ok) {
        setValue(previous);
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
      label="Workflow"
      isLabelHidden
      size="s"
      value={value}
      onChange={change}
      options={[
        {
          name: 'pipelineMode',
          value: 'mapping-only',
          label: 'Mapping only',
          disabled: saving,
        },
        {
          name: 'pipelineMode',
          value: 'rag-corpus',
          label: 'RAG corpus',
          disabled: saving,
        },
        {
          name: 'pipelineMode',
          value: 'curriculum-mapping',
          label: 'Curriculum',
          disabled: saving,
        },
        { name: 'pipelineMode', value: 'full', label: 'Full pipeline', disabled: saving },
      ]}
    />
  );
}
