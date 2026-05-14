'use client';

import { Button } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setPipelineStageOverride } from '../../actions';

/**
 * Toggles the manual "mark stage complete" override for a pipeline
 * stage. Disabled when the stage hasn't produced any output yet (the
 * caller passes `hasOutput`). The 2nd-consolidation stages are always
 * allowed (the parent passes `hasOutput=true` unconditionally), since
 * those passes are optional and can legitimately produce nothing.
 */
export function MarkStageCompleteButton({
  slug,
  stageName,
  hasOutput,
  isComplete,
}: {
  slug: string;
  stageName: string;
  hasOutput: boolean;
  isComplete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="tertiary"
      disabled={pending || (!hasOutput && !isComplete)}
      onClick={() =>
        start(async () => {
          await setPipelineStageOverride(slug, stageName, !isComplete);
          router.refresh();
        })
      }
    >
      {pending ? 'Saving…' : isComplete ? 'Mark step incomplete' : 'Mark step complete'}
    </Button>
  );
}
