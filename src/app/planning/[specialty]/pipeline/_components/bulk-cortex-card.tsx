'use client';

/**
 * Pipeline-page bulk trigger for Stage 2 (register sources in Cortex).
 * Mirrors RunLitSearchButton's shape and idle/running affordance.
 *
 * Acts on every approved 2nd-pass article whose backlog status is
 * `sources-approved` AND has at least one source row without a
 * `cortexSourceId`. The loader page hands us the eligible list so the
 * button shows the exact count.
 */

import { Button, Callout, Inline, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BulkCortexRegisterButton({
  specialtySlug,
  articleRecordIds,
}: {
  specialtySlug: string;
  /** Articles eligible for Cortex registration (status='sources-approved'
   *  with at least one unregistered source). Empty → button disabled. */
  articleRecordIds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = articleRecordIds.length;
  const disabled = busy || n === 0;
  const label = busy
    ? 'Registering…'
    : n === 0
      ? 'Nothing to register'
      : `Register sources for ${n.toLocaleString()} article${n === 1 ? '' : 's'}`;

  const onClick = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/workflows/cortex-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug, articleRecordIds }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
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
    </Stack>
  );
}
