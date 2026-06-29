'use client';

import { SegmentedControl } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { McpEnv } from '@/lib/types';

/**
 * Settings control for which AMBOSS MCP environment a rag-corpus specialty's
 * runs query (Production / Staging). PATCHes the specialty and refreshes.
 * Mirrors {@link MappingSourceControl}'s optimistic persistence; the choice
 * only affects the NEXT run.
 */
export function McpServerControl({ slug, mcpEnv }: { slug: string; mcpEnv: McpEnv }) {
  const router = useRouter();
  const [value, setValue] = useState<McpEnv>(mcpEnv);
  const [saving, setSaving] = useState(false);

  const onChange = async (next: string) => {
    const env: McpEnv = next === 'staging' ? 'staging' : 'production';
    if (env === value) return;
    const previous = value;
    setValue(env);
    setSaving(true);
    try {
      const res = await fetch('/api/specialties', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, mcpEnv: env }),
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
      label="MCP server"
      isLabelHidden
      size="s"
      value={value}
      onChange={onChange}
      options={[
        {
          name: 'mcpEnv',
          value: 'production',
          label: 'Production',
          disabled: saving,
        },
        {
          name: 'mcpEnv',
          value: 'staging',
          label: 'Staging',
          disabled: saving,
        },
      ]}
    />
  );
}
