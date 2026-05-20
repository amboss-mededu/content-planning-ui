'use client';

import { Card, CardBox, Stack } from '@amboss/design-system';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import { CoverageStats, type StatItem } from './coverage-stats';
import { PipelineStageStrip } from './pipeline-stage-strip';

export function OverviewView({
  stats,
  stageStates,
}: {
  stats: StatItem[];
  stageStates?: PipelineStageStates;
}) {
  return (
    <Stack space="l">
      {stageStates ? (
        <Card outlined>
          <CardBox>
            <PipelineStageStrip stageStates={stageStates} />
          </CardBox>
        </Card>
      ) : null}
      <CoverageStats stats={stats} />
    </Stack>
  );
}
