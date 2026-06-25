'use client';

import {
  Card,
  CardBox,
  Column,
  Columns,
  H2,
  SegmentedProgressBar,
  Stack,
  Text,
} from '@amboss/design-system';
import type { CSSProperties } from 'react';
import type { CoverageStats } from '@/lib/data/coverage-stats-compute';
import {
  fmtNum,
  fmtPct,
  Panel,
  StatRow,
} from '../../planning/_components/coverage-statistics';

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 16,
};

/**
 * Curriculum-specific coverage statistics. A trimmed variant of the Content
 * Planner's `CoverageStatistics`: keeps the mapping-progress bar and the
 * Overall / Aggregate panels, drops the 0–5 score rows and the score
 * distribution chart, and adds question totals to Aggregate coverage. Reuses the
 * shared `Panel` / `StatRow` primitives so the two stay visually identical.
 */
export function CurriculumCoverageStatistics({
  coverageStats: stats,
  questions,
}: {
  coverageStats: CoverageStats;
  questions: { total: number; unique: number };
}) {
  return (
    <Stack space="m">
      <H2>Coverage statistics</H2>

      {/* Mapping progress */}
      <Card outlined>
        <CardBox>
          <Stack space="xs">
            <div style={rowStyle}>
              <Text color="secondary" size="s">
                Mapping progress
              </Text>
              <Text size="s" weight="bold">
                {fmtPct((stats.mappedCount / Math.max(1, stats.total)) * 100)} mapped ·{' '}
                {stats.mappedCount}/{stats.total}
              </Text>
            </div>
            <SegmentedProgressBar
              maxValue={Math.max(1, stats.total)}
              values={{ success: stats.mappedCount }}
              aria-label={`${stats.mappedCount} of ${stats.total} codes mapped`}
            />
          </Stack>
        </CardBox>
      </Card>

      <Columns gap="m" vAlignItems="stretch">
        <Column size={[12, 12, 6]}>
          <Panel title="Overall coverage">
            <StatRow label="Total codes" value={stats.total} />
            <StatRow
              label="In AMBOSS"
              value={stats.inAmboss}
              sub={fmtPct(stats.pctInAmboss)}
            />
            <StatRow
              label="Not in AMBOSS"
              value={stats.notInAmboss}
              sub={fmtPct(stats.pctNotInAmboss)}
            />
          </Panel>
        </Column>
        <Column size={[12, 12, 6]}>
          <Panel title="Aggregate coverage">
            <StatRow
              label="Articles covered"
              value={stats.totalArticlesCovered}
              sub={`avg ${fmtNum(stats.avgArticlesCovered)}`}
            />
            <StatRow
              label="Unique articles covered"
              value={stats.uniqueArticlesCovered}
              sub={`avg ${fmtNum(stats.avgUniqueArticlesCovered)}`}
            />
            <StatRow
              label="Sections covered"
              value={stats.totalSectionsCovered}
              sub={`avg ${fmtNum(stats.avgSectionsCovered)}`}
            />
            <StatRow
              label="Unique sections covered"
              value={stats.uniqueSectionsCovered}
              sub={`avg ${fmtNum(stats.avgUniqueSectionsCovered)}`}
            />
            <StatRow label="Total questions" value={questions.total} />
            <StatRow label="Unique questions" value={questions.unique} />
          </Panel>
        </Column>
      </Columns>
    </Stack>
  );
}
