'use client';

import { Button, Callout, Inline, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { MissingKeyModal } from './missing-key-modal';

/**
 * Run button for the Literature search card. POSTs to
 * /api/workflows/literature-search and refreshes so the StageCard
 * picks up the new run within the next dashboard poll. Disabled when
 * no articles are waiting (the backend would skip anyway, but
 * surfacing the disabled state is cheaper feedback).
 */
export function RunLitSearchButton({
  specialtySlug,
  waitingCount,
  running,
}: {
  specialtySlug: string;
  waitingCount: number;
  /** When true, hide the button — the stage card already shows progress. */
  running: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  if (running) return null;

  const disabled = submitting || waitingCount === 0;
  const label = submitting
    ? 'Starting…'
    : waitingCount === 0
      ? 'Nothing to search'
      : `Run for ${waitingCount.toLocaleString()} article${waitingCount === 1 ? '' : 's'}`;

  const onClick = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/workflows/literature-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (
          res.status === 409 &&
          body?.code === 'MISSING_API_KEY' &&
          body.provider === 'google'
        ) {
          setMissingKey('google');
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
