'use client';

import {
  Card,
  CardBox,
  Column,
  Columns,
  H2,
  H4,
  Stack,
  Text,
  Tooltip,
} from '@amboss/design-system';
import type { CSSProperties, ReactElement } from 'react';
import type { BacklogStageCounts, BacklogStats } from '@/lib/data/backlog-stats-compute';
import type { CoverageStats } from '@/lib/data/coverage-stats-compute';

const fillStyle: CSSProperties = { height: '100%' };
const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 16,
};
const valueStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline' };
// Subtle affordance that a label carries a hover explanation (DS notes tooltips
// are low-discoverability). Plain inline span so it honours the parent layout.
const helpStyle: CSSProperties = { cursor: 'help' };

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Label/value row, with an optional muted sub-value and an optional hover
 *  explanation surfaced on the label. Mirrors the coverage-statistics row. */
function StatRow({
  label,
  value,
  sub,
  tooltip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tooltip?: string;
}) {
  const labelText = (
    <Text color="secondary" size="s">
      {label}
    </Text>
  );
  return (
    <div style={rowStyle}>
      {tooltip ? (
        <Tooltip content={tooltip}>
          <span style={helpStyle}>{labelText}</span>
        </Tooltip>
      ) : (
        labelText
      )}
      <div style={valueStyle}>
        <Text size="s" weight="bold">
          {value}
        </Text>
        {sub ? (
          <Text size="xs" color="tertiary">
            {sub}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  titleTooltip,
  children,
}: {
  title: string;
  titleTooltip?: string;
  children: ReactElement | ReactElement[];
}) {
  return (
    <div className="card-fill" style={fillStyle}>
      <Card outlined>
        <CardBox>
          <Stack space="s">
            {titleTooltip ? (
              <Tooltip content={titleTooltip}>
                <span style={helpStyle}>
                  <H4>{title}</H4>
                </span>
              </Tooltip>
            ) : (
              <H4>{title}</H4>
            )}
            <Stack space="xs">{children}</Stack>
          </Stack>
        </CardBox>
      </Card>
    </div>
  );
}

/** The new/update split shown as the muted sub-value on a stage row. */
function splitSub(stage: BacklogStageCounts): string {
  return `${stage.new} new · ${stage.update} update`;
}

/** Hover explanations, kept together so the copy is easy to scan and tweak. */
const EXPLAIN = {
  // Panel titles
  consolidation:
    'New and updated articles & sections proposed by the consolidation step — the rows shown on the Consolidation Review tab.',
  backlog: 'Approved articles & updates that have entered the writing backlog.',
  // Consolidation suggestions
  consolidationsRun:
    'Consolidation categories that have produced output, out of the number expected.',
  cNewArticles: 'Brand-new articles proposed after consolidation.',
  avgNewArticles:
    'New articles divided by the number of consolidations that have actually run.',
  cArticleUpdates: 'Existing articles with proposed section changes.',
  avgArticleUpdates:
    'Article updates divided by the number of consolidations that have actually run.',
  totalSectionChanges: 'All proposed section changes (new sections plus updates).',
  newSections: 'Brand-new sections proposed after consolidation.',
  sectionUpdates: 'Proposed changes to existing sections.',
  avgSections:
    'Total section changes divided by the number of consolidations that have actually run.',
  // Backlog
  total: 'All items in the backlog (approved new articles plus article updates).',
  newArticles: 'Approved new articles in the backlog.',
  articleUpdates: 'Existing articles with approved section updates.',
  chooseSources:
    'Before a draft exists — searching, picking and approving sources (every status up to ready-for-llm-draft).',
  drafted: 'A draft has been generated and is being edited or is ready to publish.',
  published: 'Live in AMBOSS.',
} as const;

function ConsolidationPanel({ stats }: { stats: CoverageStats }) {
  const lt3 = (n: number) => `${n} with score <3`;
  return (
    <Panel title="Consolidation suggestions" titleTooltip={EXPLAIN.consolidation}>
      <StatRow
        label="Consolidations run"
        value={`${stats.consolidationsRun} / ${stats.consolidationsExpected}`}
        sub={fmtPct(
          (stats.consolidationsRun / Math.max(1, stats.consolidationsExpected)) * 100,
        )}
        tooltip={EXPLAIN.consolidationsRun}
      />
      <StatRow
        label="New articles"
        value={stats.newArticles}
        sub={lt3(stats.newArticlesLt3)}
        tooltip={EXPLAIN.cNewArticles}
      />
      <StatRow
        label="Avg new articles / consolidation"
        value={fmtNum(stats.avgNewArticlesPerConsolidation)}
        tooltip={EXPLAIN.avgNewArticles}
      />
      <StatRow
        label="Article updates"
        value={stats.articleUpdates}
        sub={lt3(stats.articleUpdatesLt3)}
        tooltip={EXPLAIN.cArticleUpdates}
      />
      <StatRow
        label="Avg article updates / consolidation"
        value={fmtNum(stats.avgArticleUpdatesPerConsolidation)}
        tooltip={EXPLAIN.avgArticleUpdates}
      />
      <StatRow
        label="Total section changes"
        value={stats.totalSectionChanges}
        sub={lt3(stats.totalSectionChangesLt3)}
        tooltip={EXPLAIN.totalSectionChanges}
      />
      <StatRow
        label="New sections"
        value={stats.newSections}
        sub={lt3(stats.newSectionsLt3)}
        tooltip={EXPLAIN.newSections}
      />
      <StatRow
        label="Section updates"
        value={stats.sectionUpdates}
        sub={lt3(stats.sectionUpdatesLt3)}
        tooltip={EXPLAIN.sectionUpdates}
      />
      <StatRow
        label="Avg sections / consolidation"
        value={fmtNum(stats.avgSectionsPerConsolidation)}
        tooltip={EXPLAIN.avgSections}
      />
    </Panel>
  );
}

function BacklogPanel({ stats }: { stats: BacklogStats }) {
  return (
    <Panel title="Backlog" titleTooltip={EXPLAIN.backlog}>
      <StatRow label="Total in backlog" value={stats.total} tooltip={EXPLAIN.total} />
      <StatRow
        label="New articles"
        value={stats.newArticles}
        tooltip={EXPLAIN.newArticles}
      />
      <StatRow
        label="Article updates"
        value={stats.articleUpdates}
        tooltip={EXPLAIN.articleUpdates}
      />
      <StatRow
        label="Choose sources"
        value={stats.chooseSources.total}
        sub={splitSub(stats.chooseSources)}
        tooltip={EXPLAIN.chooseSources}
      />
      <StatRow
        label="Drafted"
        value={stats.drafted.total}
        sub={splitSub(stats.drafted)}
        tooltip={EXPLAIN.drafted}
      />
      <StatRow
        label="Published"
        value={stats.published.total}
        sub={splitSub(stats.published)}
        tooltip={EXPLAIN.published}
      />
    </Panel>
  );
}

/** "New content statistics": the consolidation step's proposed output and the
 *  approved backlog derived from it, shown side by side. */
export function NewContentStatistics({
  coverageStats,
  backlogStats,
}: {
  coverageStats: CoverageStats;
  backlogStats: BacklogStats;
}) {
  return (
    <Stack space="m">
      <H2>New content statistics</H2>
      <Columns gap="m" vAlignItems="stretch">
        <Column size={[12, 12, 6]}>
          <ConsolidationPanel stats={coverageStats} />
        </Column>
        <Column size={[12, 12, 6]}>
          <BacklogPanel stats={backlogStats} />
        </Column>
      </Columns>
    </Stack>
  );
}
