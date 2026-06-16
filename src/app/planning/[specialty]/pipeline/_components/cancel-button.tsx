'use client';

import { Button } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import { refreshSpecialty } from '../../actions';

const CONFIRM_MESSAGE =
  'Cancel this run? The workflow stops and this stage becomes re-runnable. Your existing data (mappings, consolidations, downstream work) is kept — use "Start over" if you want to clear it.';

export function CancelButton({
  runId,
  specialtySlug,
  stage,
}: {
  runId: string;
  specialtySlug: string;
  stage: StageName;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!window.confirm(CONFIRM_MESSAGE)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, specialtySlug, stage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Cancel only stops the run + resets this stage's row; no data is wiped.
      // Still purge the whole /planning/<slug> client cache so every tab
      // reflects the no-longer-running state, not just the current route.
      await refreshSpecialty(specialtySlug);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={onClick} disabled={submitting}>
        {submitting ? 'Cancelling…' : 'Cancel run'}
      </Button>
      {error ? <span style={{ color: 'var(--color-red-500)' }}>{error}</span> : null}
    </>
  );
}
