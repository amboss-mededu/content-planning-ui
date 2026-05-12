'use client';

import { Button } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setTabOverride } from '../[specialty]/actions';

/**
 * Toggles the manual "mark step complete" override for a tab. Used on
 * pages where the planning sub-nav can't auto-derive completion from
 * data (Overview, Categories). Writes via `setTabOverride` then
 * `router.refresh()` so the tab indicator updates on the next paint.
 */
export function MarkStepCompleteButton({
  slug,
  segment,
  isComplete,
}: {
  slug: string;
  segment: string;
  isComplete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="tertiary"
      onClick={() =>
        start(async () => {
          await setTabOverride(slug, segment, !isComplete);
          router.refresh();
        })
      }
      disabled={pending}
    >
      {pending ? 'Saving…' : isComplete ? 'Mark step incomplete' : 'Mark step complete'}
    </Button>
  );
}
