'use client';

import { Card, CardBox, Stack } from '@amboss/design-system';
import type { BacklogStats as BacklogStatsData } from '@/lib/data/backlog-stats-compute';
import type { CoverageStats as CoverageStatsData } from '@/lib/data/coverage-stats-compute';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import { CoverageStatistics } from './coverage-statistics';
import { CoverageStats, type StatItem } from './coverage-stats';
import { NewContentStatistics } from './new-content-statistics';
import { PipelineStageStrip } from './pipeline-stage-strip';

export function OverviewView({
  stats,
  coverageStats,
  backlogStats,
  stageStates,
  mappingOnly = false,
}: {
  stats: StatItem[];
  coverageStats: CoverageStatsData;
  backlogStats: BacklogStatsData;
  stageStates?: PipelineStageStates;
  mappingOnly?: boolean;
}) {
  return (
    <Stack space="l">
      {stageStates ? (
        <Card outlined>
          <CardBox>
            <PipelineStageStrip stageStates={stageStates} mappingOnly={mappingOnly} />
          </CardBox>
        </Card>
      ) : null}
      <CoverageStats stats={stats} />
      <CoverageStatistics stats={coverageStats} />
      <NewContentStatistics coverageStats={coverageStats} backlogStats={backlogStats} />
    </Stack>
  );
}
