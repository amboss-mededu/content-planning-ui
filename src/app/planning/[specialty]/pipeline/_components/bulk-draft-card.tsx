'use client';

/**
 * Pipeline-page bulk trigger for Stage 3 (draft articles).
 *
 * Enqueues a write-article run for every approved article whose
 * backlog status is `ready-for-llm-draft`. The dispatcher
 * (src/lib/workflows/dispatcher.ts) drains the queue under a
 * semaphore of 3 — bulk-launching 50 articles will only ever have 3
 * running concurrently, the rest stay in `queued` until a slot frees.
 *
 * Uses the per-specialty stored model spec for the `write_article`
 * stage; falls back to DEFAULT_MODELS.write_article when nothing's
 * stored (same path the per-row StartWritingButton takes).
 */

import { Button, Callout, Inline, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { MissingKeyModal } from './missing-key-modal';
import { readSpecForStage } from './model-selection-storage';

export function BulkDraftArticlesButton({
  specialtySlug,
  articleRecordIds,
}: {
  specialtySlug: string;
  /** Articles eligible to enqueue (status='ready-for-llm-draft').
   *  Empty → button disabled. */
  articleRecordIds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  const n = articleRecordIds.length;
  const disabled = busy || n === 0;
  const label = busy
    ? 'Enqueueing…'
    : n === 0
      ? 'Nothing to draft'
      : `Draft ${n.toLocaleString()} article${n === 1 ? '' : 's'}`;

  const onClick = async () => {
    setError(null);
    setBusy(true);
    try {
      const model = readSpecForStage(specialtySlug, 'write_article');
      if (!model) {
        setError('No model configured for write_article stage.');
        return;
      }
      const res = await fetch('/api/workflows/write-article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          articleRecordIds,
          model,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        provider?: ProviderId;
        enqueued?: number;
        skipped?: number;
      };
      if (!res.ok) {
        if (res.status === 409 && body.code === 'MISSING_API_KEY' && body.provider) {
          setMissingKey(body.provider);
          return;
        }
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.skipped && body.skipped > 0) {
        setError(
          `${body.enqueued ?? 0} enqueued · ${body.skipped} skipped (no sources / not found).`,
        );
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
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </Stack>
  );
}
