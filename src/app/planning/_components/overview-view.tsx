'use client';

import { Card, CardBox, Stack } from '@amboss/design-system';
import type { CoverageStats as CoverageStatsData } from '@/lib/data/coverage-stats-compute';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import { CoverageStatistics } from './coverage-statistics';
import { CoverageStats, type StatItem } from './coverage-stats';
import { PipelineStageStrip } from './pipeline-stage-strip';

export function OverviewView({
  stats,
  coverageStats,
  stageStates,
}: {
  stats: StatItem[];
  coverageStats: CoverageStatsData;
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
      <CoverageStatistics stats={coverageStats} />
    </Stack>
  );
}
