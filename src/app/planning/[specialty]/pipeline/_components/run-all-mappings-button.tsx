'use client';

import { Button, Callout, Inline, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { missingApiKeyProvider } from './missing-api-key';
import { MissingKeyModal } from './missing-key-modal';
import {
  backupModelKey,
  DEFAULT_BACKUP_MODEL,
  readSpec,
  readSpecForStage,
} from './model-selection-storage';

export function RunMapAllButton({
  specialtySlug,
  unmappedCount,
  defaultContentBase,
  running,
}: {
  specialtySlug: string;
  unmappedCount: number;
  defaultContentBase: string;
  running: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  if (running) return null;

  const disabled = submitting || unmappedCount === 0;
  const label = submitting
    ? 'Starting…'
    : unmappedCount === 0
      ? 'No unmapped codes'
      : `Map ${unmappedCount.toLocaleString()} unmapped code${unmappedCount === 1 ? '' : 's'}`;

  const onClick = async () => {
    setError(null);
    const primaryModel = readSpecForStage(specialtySlug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured for Map codes. Open the gear icon to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(specialtySlug)) ?? DEFAULT_BACKUP_MODEL;

    setSubmitting(true);
    try {
      const res = await fetch('/api/workflows/map-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          contentBase: defaultContentBase,
          primaryModel,
          backupModel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = missingApiKeyProvider(res.status, body);
        if (missing) {
          setMissingKey(missing);
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
        <div style={{ width: 280 }}>
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
