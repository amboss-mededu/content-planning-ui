'use client';

import { Button, Inline, Select, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { canSkipPipelineStage, type PipelineCardState } from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import { setPipelineStageState } from '../../actions';

const STATE_OPTIONS: Array<{ value: PipelineCardState; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'skipped', label: 'Skipped' },
];

export function StageStateControl({
  slug,
  stageName,
  state,
  onOptimisticStateChange,
}: {
  slug: string;
  stageName: StageName;
  state: PipelineCardState;
  onOptimisticStateChange?: (state: PipelineCardState) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localState, setLocalState] = useState(state);
  const [error, setError] = useState<string | null>(null);
  const options = canSkipPipelineStage(stageName)
    ? STATE_OPTIONS
    : STATE_OPTIONS.filter((option) => option.value !== 'skipped');

  useEffect(() => {
    setLocalState(state);
  }, [state]);

  const saveState = (nextState: PipelineCardState) => {
    const previousState = localState;
    setLocalState(nextState);
    onOptimisticStateChange?.(nextState);
    setError(null);
    start(async () => {
      try {
        await setPipelineStageState(slug, stageName, nextState);
        router.refresh();
      } catch (err) {
        setLocalState(previousState);
        onOptimisticStateChange?.(previousState);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <>
      <Inline space="xs" vAlignItems="center">
        <div style={{ width: 160 }}>
          <Select
            name={`${stageName}-state`}
            value={localState}
            disabled={pending}
            onChange={(event) => saveState(event.target.value as PipelineCardState)}
            options={options}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || localState === 'not_started'}
          onClick={() => saveState('not_started')}
        >
          {pending ? 'Saving...' : 'Reset state'}
        </Button>
      </Inline>
      {error ? <Text color="error">{error}</Text> : null}
    </>
  );
}
