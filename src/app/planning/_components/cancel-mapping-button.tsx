'use client';

import { Button, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { refreshSpecialty } from '../[specialty]/actions';

const CONFIRM_MESSAGE =
  'Cancel the running mapping? The workflow stops and the stage becomes re-runnable. Coverage already written for finished codes is kept.';

/**
 * Universal "Cancel mapping" control — stops a specialty's in-progress (or
 * stuck) map/remap run. Reusable from every surface that shows mapping progress
 * (the Mapping-sheet badge, the Map-codes modal, the code-detail modal): it only
 * needs the slug because the active run is resolved server-side by
 * `/api/workflows/cancel-mapping`. Non-destructive — coverage already written is
 * kept; the run is cancelled, the stage reset to pending, and the in-flight
 * "Mapping…" markers cleared so the pulses disappear at once.
 */
export function CancelMappingButton({
  slug,
  size = 's',
  leftIcon,
  onCancelled,
}: {
  slug: string;
  size?: 's' | 'm';
  leftIcon?: 'x' | 'stop-filled';
  /** Called after a successful cancel (e.g. to close the modal it lives in). */
  onCancelled?: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!window.confirm(CONFIRM_MESSAGE)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/cancel-mapping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug: slug }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Cancel is non-destructive — it only stops the run, resets the stage,
      // and clears the pulses. Purge the whole /planning/<slug> client cache so
      // every tab reflects the no-longer-running state, then refresh the route.
      await refreshSpecialty(slug);
      router.refresh();
      onCancelled?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack space="xxs">
      <Button
        variant="secondary"
        size={size}
        leftIcon={leftIcon}
        onClick={onClick}
        loading={submitting}
        disabled={submitting}
      >
        {submitting ? 'Cancelling…' : 'Cancel mapping'}
      </Button>
      {error ? (
        <Text size="s" color="error">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
