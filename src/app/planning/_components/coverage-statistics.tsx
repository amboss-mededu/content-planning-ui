'use client';

import {
  Card,
  CardBox,
  Column,
  Columns,
  H2,
  H4,
  ProgressBar,
  SegmentedProgressBar,
  Stack,
  Text,
} from '@amboss/design-system';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { CoverageScoreRow, CoverageStats } from '@/lib/data/coverage-stats-compute';

const fillStyle: CSSProperties = { height: '100%' };
const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 16,
};
const valueStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline' };

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Label/value row, with an optional muted sub-value (e.g. the "< 3" count). */
function StatRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div style={rowStyle}>
      <Text color="secondary" size="s">
        {label}
      </Text>
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
  children,
}: {
  title: string;
  children: ReactElement | ReactElement[];
}) {
  return (
    <div className="card-fill" style={fillStyle}>
      <Card outlined>
        <CardBox>
          <Stack space="s">
            <H4>{title}</H4>
            <Stack space="xs">{children}</Stack>
          </Stack>
        </CardBox>
      </Card>
    </div>
  );
}

/** Horizontal bar chart: an "Unmapped" bar plus one bar per coverage score 0–5. */
function ScoreBarChart({ stats }: { stats: CoverageStats }) {
  const bars = [
    { label: 'Unmapped', count: stats.unmappedCount },
    ...stats.scoreRows.map((r) => ({ label: `Score ${r.score}`, count: r.count })),
  ];
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <Stack space="xs">
      {bars.map((b) => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 96, flexShrink: 0 }}>
            <Text size="s" color="secondary">
              {b.label}
            </Text>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProgressBar
              maxValue={max}
              progress={b.count}
              aria-label={`${b.label}: ${b.count} codes`}
            />
          </div>
          <div style={{ width: 48, flexShrink: 0, textAlign: 'right' }}>
            <Text size="s" weight="bold">
              {b.count}
            </Text>
          </div>
        </div>
      ))}
    </Stack>
  );
}

const SCORE_TABLE_HEADERS = [
  'Score',
  'Count',
  '%',
  'Cum.',
  'Cum. %',
  'Rev. cum.',
  'Rev. cum. %',
];

const cellStyle: CSSProperties = {
  padding: '4px 8px',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};
const firstCellStyle: CSSProperties = { ...cellStyle, textAlign: 'left' };

function ScoreCell({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <td style={first ? firstCellStyle : cellStyle}>
      <Text size="s">{children}</Text>
    </td>
  );
}

function ScoreTable({ rows }: { rows: CoverageScoreRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {SCORE_TABLE_HEADERS.map((h, i) => (
              <th key={h} style={i === 0 ? firstCellStyle : cellStyle} scope="col">
                <Text size="xs" weight="bold" color="secondary">
                  {h}
                </Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.score}>
              <ScoreCell first>{r.score}</ScoreCell>
              <ScoreCell>{r.count}</ScoreCell>
              <ScoreCell>{fmtPct(r.pct)}</ScoreCell>
              <ScoreCell>{r.cumCount}</ScoreCell>
              <ScoreCell>{fmtPct(r.cumPct)}</ScoreCell>
              <ScoreCell>{r.revCumCount}</ScoreCell>
              <ScoreCell>{fmtPct(r.revCumPct)}</ScoreCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CoverageStatistics({ stats }: { stats: CoverageStats }) {
  const lt3 = (n: number) => `${n} with score <3`;
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
            <StatRow label="Avg coverage" value={fmtNum(stats.avgCoverage)} />
            <StatRow label="Coverage ≥ 3" value={fmtPct(stats.pctCoverageGte3)} />
            <StatRow label="Coverage < 3" value={fmtPct(stats.pctCoverageLt3)} />
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
          </Panel>
        </Column>
      </Columns>

      <Panel title="Coverage score distribution">
        <Stack space="m">
          <ScoreBarChart stats={stats} />
          <ScoreTable rows={stats.scoreRows} />
        </Stack>
      </Panel>

      <Panel title="Consolidated suggestions">
        <StatRow
          label="Consolidations run"
          value={`${stats.consolidationsRun} / ${stats.consolidationsExpected}`}
          sub={fmtPct(
            (stats.consolidationsRun / Math.max(1, stats.consolidationsExpected)) * 100,
          )}
        />
        <StatRow
          label="New articles"
          value={stats.newArticles}
          sub={lt3(stats.newArticlesLt3)}
        />
        <StatRow
          label="Avg new articles / consolidation"
          value={fmtNum(stats.avgNewArticlesPerConsolidation)}
          sub={`${stats.consolidationsRun} run`}
        />
        <StatRow
          label="Article updates"
          value={stats.articleUpdates}
          sub={lt3(stats.articleUpdatesLt3)}
        />
        <StatRow
          label="Avg article updates / consolidation"
          value={fmtNum(stats.avgArticleUpdatesPerConsolidation)}
          sub={`${stats.consolidationsRun} run`}
        />
        <StatRow
          label="Total section changes"
          value={stats.totalSectionChanges}
          sub={lt3(stats.totalSectionChangesLt3)}
        />
        <StatRow
          label="New sections"
          value={stats.newSections}
          sub={lt3(stats.newSectionsLt3)}
        />
        <StatRow
          label="Section updates"
          value={stats.sectionUpdates}
          sub={lt3(stats.sectionUpdatesLt3)}
        />
        <StatRow
          label="Avg sections / consolidation"
          value={fmtNum(stats.avgSectionsPerConsolidation)}
        />
      </Panel>
    </Stack>
  );
}
