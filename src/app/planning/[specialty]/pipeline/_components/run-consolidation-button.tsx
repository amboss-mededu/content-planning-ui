'use client';

import { Button, Callout, Inline, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { MissingKeyModal } from './missing-key-modal';
import { readSpecForStage } from './model-selection-storage';

export function RunConsolidationButton({
  specialtySlug,
  mappedCodeCount,
}: {
  specialtySlug: string;
  mappedCodeCount: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  const disabled = submitting || mappedCodeCount === 0;
  const label = submitting
    ? 'Starting…'
    : mappedCodeCount === 0
      ? 'No mapped codes'
      : 'Run consolidation';

  const onClick = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/workflows/consolidate-primary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          model: readSpecForStage(specialtySlug, 'consolidate_primary'),
          chainSecondaries: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && body?.code === 'MISSING_API_KEY' && body.provider) {
          setMissingKey(body.provider);
          return;
        }
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack space="s">
      <Inline space="s">
        <div style={{ width: 220 }}>
          <Button onClick={onClick} disabled={disabled} fullWidth>
            {label}
          </Button>
        </div>
      </Inline>
      {error ? <Callout type="error" text={error} /> : null}
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </Stack>
  );
}
