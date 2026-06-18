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

/**
 * Runs the "Generate suggestions" backfill over codes that were coverage-mapped
 * without suggestions (e.g. after a mapping-only specialty was switched to
 * full). Reuses the map_codes model when no dedicated map_suggestions model is
 * configured.
 */
export function RunSuggestionsButton({
  specialtySlug,
  pendingCount,
  defaultContentBase,
  running,
}: {
  specialtySlug: string;
  pendingCount: number;
  defaultContentBase: string;
  running: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  if (running) return null;

  const disabled = submitting || pendingCount === 0;
  const label = submitting
    ? 'Starting…'
    : pendingCount === 0
      ? 'No codes need suggestions'
      : `Generate suggestions for ${pendingCount.toLocaleString()} code${pendingCount === 1 ? '' : 's'}`;

  const onClick = async () => {
    setError(null);
    const primaryModel =
      readSpecForStage(specialtySlug, 'map_suggestions') ??
      readSpecForStage(specialtySlug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured. Open the gear icon on Map codes to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(specialtySlug)) ?? DEFAULT_BACKUP_MODEL;

    setSubmitting(true);
    try {
      const res = await fetch('/api/workflows/map-suggestions', {
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
        <div style={{ width: 320 }}>
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
