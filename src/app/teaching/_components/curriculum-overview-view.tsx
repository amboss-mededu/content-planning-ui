'use client';

import { Stack, Text } from '@amboss/design-system';
import type { CoverageStats } from '@/lib/data/coverage-stats-compute';
import type { CurriculumPlanStats } from '@/lib/data/curriculum-plans';
import type { CodeRecord } from '@/lib/pb/types';
import {
  type StatItem,
  CoverageStats as StatTiles,
} from '../../planning/_components/coverage-stats';
import { CurriculumCoverageStatistics } from './curriculum-coverage-statistics';
import { CurriculumStructure } from './curriculum-structure';

function statTiles(stats: CurriculumPlanStats): StatItem[] {
  const approvedPct =
    stats.totalItems > 0 ? Math.round((stats.approved / stats.totalItems) * 100) : 0;
  return [
    {
      label: 'Curriculum items',
      value: stats.totalItems,
      hint: `${stats.pending} pending · ${stats.rejected} rejected`,
    },
    {
      label: 'Approved',
      value: `${approvedPct}%`,
      hint: `${stats.approved} of ${stats.totalItems}`,
    },
    {
      label: 'Mapped',
      value: stats.mapped,
      hint: `${stats.inAmboss} in AMBOSS`,
    },
    {
      label: 'Articles',
      value: stats.uniqueArticles,
      hint: 'unique articles covered',
    },
    {
      label: 'Questions',
      value: stats.uniqueQuestions,
      hint: `${stats.totalQuestions} total`,
    },
  ];
}

// The plan title + breadcrumb + tab bar are rendered by the curriculum layout;
// this view is just the Overview tab's body.
export function CurriculumOverviewView({
  stats,
  coverageStats,
  codes,
}: {
  stats: CurriculumPlanStats;
  coverageStats: CoverageStats;
  codes: CodeRecord[];
}) {
  return (
    <Stack space="xl">
      <StatTiles stats={statTiles(stats)} />

      <CurriculumCoverageStatistics
        coverageStats={coverageStats}
        questions={{ total: stats.totalQuestions, unique: stats.uniqueQuestions }}
      />

      <CurriculumStructure codes={codes} />

      {codes.length === 0 ? (
        <Text color="secondary">No curriculum items have been extracted yet.</Text>
      ) : null}
    </Stack>
  );
}
