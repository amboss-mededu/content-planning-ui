'use client';

/**
 * Manual "Cancel" for an in-flight per-article literature search. Shared by
 * the backlog table's Sources column and the modal's phase-1 panel. POSTs
 * the run id to /api/workflows/cancel-lit-search, then refreshes so the
 * progress badge swaps back to the trigger button.
 */

import { Button } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

export function CancelLitSearchButton({
  runId,
  onCancelled,
  size = 's',
}: {
  runId: string;
  onCancelled?: () => void;
  size?: 's' | 'm';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/workflows/cancel-lit-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      onCancelled?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, runId, onCancelled, router]);

  return (
    <Button
      variant="tertiary"
      size={size}
      disabled={busy}
      onClick={(e) => {
        (e as React.MouseEvent).stopPropagation();
        void cancel();
      }}
    >
      {busy ? 'Cancelling…' : 'Cancel'}
    </Button>
  );
}
