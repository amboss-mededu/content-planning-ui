'use client';

import { Badge, Box, Icon, Popover, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { errorMessage } from '@/lib/error-message';
import { canSkipPipelineStage, type PipelineCardState } from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import { setPipelineStageState } from '../../actions';

type BadgeColor = 'green' | 'blue' | 'yellow' | 'brand' | 'purple' | 'red' | 'gray';

const STATE_OPTIONS: Array<{ value: PipelineCardState; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'skipped', label: 'Skipped' },
];

/**
 * The stage card's header badge, now a control: clicking it opens a popover
 * menu to set the card's editor state. Replaces the old bottom-of-card
 * `Select` dropdown so the card body is reserved for actions and detail.
 *
 * `badgeLabel`/`badgeColor` are passed in (rather than derived here) so the
 * pill matches the stage card's existing display logic exactly — including the
 * "In progress" override for partially-complete stages. Selecting a state is
 * optimistic: `onOptimisticStateChange` updates the card immediately, then the
 * server action persists and we `router.refresh()`; a failure rolls back.
 */
export function StageStatePopover({
  slug,
  stageName,
  state,
  badgeLabel,
  badgeColor,
  onOptimisticStateChange,
}: {
  slug: string;
  stageName: StageName;
  state: PipelineCardState;
  badgeLabel: string;
  badgeColor: BadgeColor;
  onOptimisticStateChange?: (state: PipelineCardState) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = canSkipPipelineStage(stageName)
    ? STATE_OPTIONS
    : STATE_OPTIONS.filter((o) => o.value !== 'skipped');

  const pick = (next: PipelineCardState) => {
    setOpen(false);
    if (next === state) return;
    const previous = state;
    onOptimisticStateChange?.(next);
    setError(null);
    start(async () => {
      try {
        await setPipelineStageState(slug, stageName, next);
        router.refresh();
      } catch (err) {
        onOptimisticStateChange?.(previous);
        setError(errorMessage(err));
      }
    });
  };

  const menu = (
    <Box vSpace="xs" lSpace="xs" rSpace="xs">
      <Stack space="xxs">
        {options.map((o) => {
          const current = o.value === state;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                background: 'none',
                border: 'none',
                borderRadius: 4,
                padding: '4px 6px',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <span
                aria-hidden
                style={{ display: 'inline-flex', width: 16, justifyContent: 'center' }}
              >
                {current ? <Icon name="check" size="s" inline /> : null}
              </span>
              <Text weight={current ? 'bold' : 'normal'}>{o.label}</Text>
            </button>
          );
        })}
      </Stack>
    </Box>
  );

  return (
    <>
      <Popover
        content={menu}
        placement="bottom-left"
        maxWidth={200}
        hideArrow
        isVisible={open}
        onVisibilityChange={(visible) => setOpen(visible)}
      >
        <button
          type="button"
          disabled={pending}
          aria-label={`Set ${stageName.replace(/_/g, ' ')} status — currently ${badgeLabel}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: pending ? 'default' : 'pointer',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <Badge text={badgeLabel} color={badgeColor} />
        </button>
      </Popover>
      {error ? <Text color="error">{error}</Text> : null}
    </>
  );
}
