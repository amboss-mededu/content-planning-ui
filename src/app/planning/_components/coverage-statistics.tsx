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
  Tooltip,
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
// Subtle affordance that a label carries a hover explanation (DS notes tooltips
// are low-discoverability). Plain inline span so it honours the parent's
// text-align (keeps the score-table headers aligned with their value columns).
const helpStyle: CSSProperties = { cursor: 'help' };

export function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Label/value row, with an optional muted sub-value (e.g. the "< 3" count) and
 *  an optional hover explanation surfaced on the label. */
export function StatRow({
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

export function Panel({
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

const SCORE_TABLE_HEADERS: { label: string; tooltip: string }[] = [
  { label: 'Score', tooltip: 'Coverage score, 0 (none) to 5 (full).' },
  { label: 'Count', tooltip: 'Mapped codes at this score.' },
  { label: '%', tooltip: 'Share of mapped codes at this score.' },
  { label: 'Cum.', tooltip: 'Codes at this score or lower.' },
  { label: 'Cum. %', tooltip: 'Cumulative share of mapped codes up to this score.' },
  { label: 'Rev. cum.', tooltip: 'Codes at this score or higher.' },
  {
    label: 'Rev. cum. %',
    tooltip: 'Reverse-cumulative share of mapped codes at this score or higher.',
  },
];

const cellStyle: CSSProperties = {
  padding: '4px 8px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};
const firstCellStyle: CSSProperties = cellStyle;

function ScoreCell({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <td style={first ? firstCellStyle : cellStyle}>
      <Text size="s" align="center">
        {children}
      </Text>
    </td>
  );
}

function ScoreTable({ rows }: { rows: CoverageScoreRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {SCORE_TABLE_HEADERS.map((h, i) => (
              <th key={h.label} style={i === 0 ? firstCellStyle : cellStyle} scope="col">
                <Tooltip content={h.tooltip}>
                  <span style={helpStyle}>
                    <Text size="xs" weight="bold" color="secondary" align="center">
                      {h.label}
                    </Text>
                  </span>
                </Tooltip>
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

/** Hover explanations, kept together so the copy is easy to scan and tweak. */
const EXPLAIN = {
  // Panel titles
  overall: 'Code-level coverage across this specialty.',
  aggregate: 'How many AMBOSS articles and sections the mapped codes touch.',
  distribution: 'How mapped codes are spread across the 0–5 coverage score.',
  // Mapping progress
  mappingProgress: 'Share of codes that have been run through mapping.',
  // Overall coverage
  total: 'All diagnosis codes in this specialty.',
  inAmboss: 'Codes that already have an AMBOSS article.',
  notInAmboss: "Codes that don't yet have an AMBOSS article.",
  avgCoverage: 'Mean coverage score (0–5) over mapped codes.',
  gte3: 'Share of mapped codes scored 3 or above.',
  lt3: 'Share of mapped codes scored below 3.',
  // Aggregate coverage
  articlesCovered:
    "Total article references across all codes' coverage (duplicates included); avg is per code.",
  uniqueArticles: 'Distinct articles covered; avg is per code.',
  sectionsCovered:
    "Total section references across all codes' coverage (duplicates included); avg is per code.",
  uniqueSections: 'Distinct sections covered; avg is per code.',
} as const;

export function CoverageStatistics({ stats }: { stats: CoverageStats }) {
  return (
    <Stack space="m">
      <H2>Coverage statistics</H2>

      {/* Mapping progress */}
      <Card outlined>
        <CardBox>
          <Stack space="xs">
            <div style={rowStyle}>
              <Tooltip content={EXPLAIN.mappingProgress}>
                <span style={helpStyle}>
                  <Text color="secondary" size="s">
                    Mapping progress
                  </Text>
                </span>
              </Tooltip>
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
          <Panel title="Overall coverage" titleTooltip={EXPLAIN.overall}>
            <StatRow label="Total codes" value={stats.total} tooltip={EXPLAIN.total} />
            <StatRow
              label="In AMBOSS"
              value={stats.inAmboss}
              sub={fmtPct(stats.pctInAmboss)}
              tooltip={EXPLAIN.inAmboss}
            />
            <StatRow
              label="Not in AMBOSS"
              value={stats.notInAmboss}
              sub={fmtPct(stats.pctNotInAmboss)}
              tooltip={EXPLAIN.notInAmboss}
            />
            <StatRow
              label="Avg coverage"
              value={fmtNum(stats.avgCoverage)}
              tooltip={EXPLAIN.avgCoverage}
            />
            <StatRow
              label="Coverage ≥ 3"
              value={fmtPct(stats.pctCoverageGte3)}
              tooltip={EXPLAIN.gte3}
            />
            <StatRow
              label="Coverage < 3"
              value={fmtPct(stats.pctCoverageLt3)}
              tooltip={EXPLAIN.lt3}
            />
          </Panel>
        </Column>
        <Column size={[12, 12, 6]}>
          <Panel title="Aggregate coverage" titleTooltip={EXPLAIN.aggregate}>
            <StatRow
              label="Articles covered"
              value={stats.totalArticlesCovered}
              sub={`avg ${fmtNum(stats.avgArticlesCovered)}`}
              tooltip={EXPLAIN.articlesCovered}
            />
            <StatRow
              label="Unique articles covered"
              value={stats.uniqueArticlesCovered}
              sub={`avg ${fmtNum(stats.avgUniqueArticlesCovered)}`}
              tooltip={EXPLAIN.uniqueArticles}
            />
            <StatRow
              label="Sections covered"
              value={stats.totalSectionsCovered}
              sub={`avg ${fmtNum(stats.avgSectionsCovered)}`}
              tooltip={EXPLAIN.sectionsCovered}
            />
            <StatRow
              label="Unique sections covered"
              value={stats.uniqueSectionsCovered}
              sub={`avg ${fmtNum(stats.avgUniqueSectionsCovered)}`}
              tooltip={EXPLAIN.uniqueSections}
            />
          </Panel>
        </Column>
      </Columns>

      <Panel title="Coverage score distribution" titleTooltip={EXPLAIN.distribution}>
        <Stack space="m">
          <ScoreBarChart stats={stats} />
          <ScoreTable rows={stats.scoreRows} />
        </Stack>
      </Panel>
    </Stack>
  );
}
