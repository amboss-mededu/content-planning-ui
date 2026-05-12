'use client';

import { Button } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setPipelineStageSkipped } from '../../actions';

/**
 * Toggles the manual "skip stage" flag on optional pipeline stages
 * (today: the 2nd-consolidation passes). A skipped stage renders as
 * "Skipped" rather than "Completed" but advances the last-completed-
 * step chain the same way a manual-complete override does.
 */
export function SkipStageButton({
  slug,
  stageName,
  isSkipped,
}: {
  slug: string;
  stageName: string;
  isSkipped: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="tertiary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setPipelineStageSkipped(slug, stageName, !isSkipped);
          router.refresh();
        })
      }
    >
      {pending ? 'Saving…' : isSkipped ? 'Unskip step' : 'Skip step'}
    </Button>
  );
}
