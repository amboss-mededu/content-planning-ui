'use client';

/**
 * Manual "Cancel" for an in-flight per-code literature search. POSTs the
 * codeLitSearchRuns row id to /api/workflows/cancel-code-lit-search, then
 * refreshes so the progress badge swaps back to the trigger button.
 */

import { Button } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

export function CancelCodeLitSearchButton({
  runId,
  size = 's',
}: {
  runId: string;
  size?: 's' | 'm';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/workflows/cancel-code-lit-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, runId, router]);

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
