'use client';

import {
  Card,
  CardBox,
  Column,
  Columns,
  H4,
  Link,
  ProgressBar,
  SegmentedProgressBar,
  Stack,
  Text,
  Tooltip,
} from '@amboss/design-system';
import NextLink from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { SpecialtyOverviewRow } from '@/lib/data/specialties-overview';
import { DataTable, type Column as TableColumn } from './data-table';
import { SkeletonLine } from './skeleton';

const fillStyle: CSSProperties = { height: '100%' };
const helpStyle: CSSProperties = { cursor: 'help' };
const barRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
const barLabelStyle: CSSProperties = {
  width: 128,
  flexShrink: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const barValueStyle: CSSProperties = { width: 64, flexShrink: 0, textAlign: 'right' };

// Warm→green ramp for coverage scores 0–5, so the ≥3 ("good coverage") share
// reads as the green portion of the stacked bar. Indexed by score.
const SCORE_COLORS = [
  '#d64545', // 0
  '#e0843c', // 1
  '#edc14b', // 2
  '#9bc24a', // 3
  '#5aa84f', // 4
  '#2f8a3e', // 5
];
const scoreValueStyle: CSSProperties = { width: 88, flexShrink: 0, textAlign: 'right' };
const stackTrackStyle: CSSProperties = {
  display: 'flex',
  height: 12,
  width: '100%',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'rgb(228, 228, 234)',
};

function pct1(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

function mappedPct(r: SpecialtyOverviewRow): number {
  const { total, mappedCount } = r.coverage;
  return total > 0 ? (mappedCount / total) * 100 : 0;
}

/** Card wrapper for a single chart, with a hover explanation on the title
 *  (mirrors the `Panel` affordance in coverage-statistics). */
function ChartCard({
  title,
  tooltip,
  children,
}: {
  title: string;
  tooltip: string;
  children: ReactNode;
}) {
  return (
    <div className="card-fill" style={fillStyle}>
      <Card outlined>
        <CardBox>
          <Stack space="s">
            <Tooltip content={tooltip}>
              <span style={helpStyle}>
                <H4>{title}</H4>
              </span>
            </Tooltip>
            {children}
          </Stack>
        </CardBox>
      </Card>
    </div>
  );
}

interface Bar {
  key: string;
  label: string;
  value: number;
  display: string;
}

/** Horizontal bar chart, one bar per specialty, ranked by value descending.
 *  Same structure as ScoreBarChart (label · ProgressBar · value). */
function SpecialtiesBarChart({ bars }: { bars: Bar[] }) {
  const sorted = [...bars].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((b) => b.value));
  return (
    <Stack space="xs">
      {sorted.map((b) => (
        <div key={b.key} style={barRowStyle}>
          <div style={barLabelStyle} title={b.label}>
            <Text size="s" color="secondary">
              {b.label}
            </Text>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProgressBar
              maxValue={max}
              progress={b.value}
              aria-label={`${b.label}: ${b.display}`}
            />
          </div>
          <div style={barValueStyle}>
            <Text size="s" weight="bold">
              {b.display}
            </Text>
          </div>
        </div>
      ))}
    </Stack>
  );
}

/** Stacked backlog-pipeline bar per specialty: green = published,
 *  yellow = drafted, grey remainder = still choosing sources. */
function SpecialtiesPipelineChart({ rows }: { rows: SpecialtyOverviewRow[] }) {
  const sorted = [...rows].sort((a, b) => b.backlog.total - a.backlog.total);
  return (
    <Stack space="s">
      <Stack space="xs">
        {sorted.map((r) => {
          const b = r.backlog;
          return (
            <div key={r.specialty.slug} style={barRowStyle}>
              <div style={barLabelStyle} title={r.specialty.name}>
                <Text size="s" color="secondary">
                  {r.specialty.name}
                </Text>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SegmentedProgressBar
                  maxValue={Math.max(1, b.total)}
                  values={{ success: b.published.total, warning: b.drafted.total }}
                  aria-label={`${r.specialty.name}: ${b.published.total} published, ${b.drafted.total} drafted, ${b.chooseSources.total} choosing sources of ${b.total} total`}
                />
              </div>
              <div style={barValueStyle}>
                <Text size="s" weight="bold">
                  {b.total.toLocaleString()}
                </Text>
              </div>
            </div>
          );
        })}
      </Stack>
      <Text size="xs" color="tertiary">
        Green = published · Yellow = drafted · Grey = choosing sources
      </Text>
    </Stack>
  );
}

function ScoreLegend() {
  return (
    <Stack space="xs">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {SCORE_COLORS.map((color, score) => (
          <span
            key={color}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: color,
                display: 'inline-block',
              }}
            />
            <Text size="xs" color="tertiary">
              {score}
            </Text>
          </span>
        ))}
      </div>
      <Text size="xs" color="tertiary">
        Coverage score 0–5 over mapped codes
      </Text>
    </Stack>
  );
}

/** Per-specialty stacked bar of the coverage-score distribution (scores 0–5,
 *  over mapped codes), ranked by the ≥3 share which is shown after each bar. */
function SpecialtiesScoreChart({ rows }: { rows: SpecialtyOverviewRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => b.coverage.pctCoverageGte3 - a.coverage.pctCoverageGte3,
  );
  return (
    <Stack space="s">
      <Stack space="xs">
        {sorted.map((r) => {
          const { mappedCount, scoreRows, pctCoverageGte3 } = r.coverage;
          const denom = Math.max(1, mappedCount);
          const summary =
            mappedCount > 0
              ? scoreRows.map((s) => `${s.count} at score ${s.score}`).join(', ')
              : 'no mapped codes';
          return (
            <div key={r.specialty.slug} style={barRowStyle}>
              <div style={barLabelStyle} title={r.specialty.name}>
                <Text size="s" color="secondary">
                  {r.specialty.name}
                </Text>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={stackTrackStyle}
                  role="img"
                  aria-label={`${r.specialty.name} coverage scores — ${summary}; ${pct1(pctCoverageGte3)} scored 3 or above`}
                >
                  {scoreRows.map((s) =>
                    s.count > 0 ? (
                      <div
                        key={s.score}
                        title={`Score ${s.score}: ${s.count} (${pct1(s.pct)})`}
                        style={{
                          width: `${(s.count / denom) * 100}%`,
                          background: SCORE_COLORS[s.score],
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
              <div style={scoreValueStyle}>
                <Text size="s" weight="bold">
                  {`${pct1(pctCoverageGte3)} ≥3`}
                </Text>
              </div>
            </div>
          );
        })}
      </Stack>
      <ScoreLegend />
    </Stack>
  );
}

const EXPLAIN = {
  mapping: 'Share of each specialty’s codes that have been run through mapping.',
  quality:
    'Distribution of each specialty’s mapped codes across coverage scores 0–5 (warm→green); the trailing value is the share scored 3 or above.',
  size: 'Total diagnosis codes per specialty.',
  pipeline:
    'Backlog pipeline per specialty: published, drafted, and still choosing sources, out of all approved items.',
} as const;

function tableColumns(): TableColumn<SpecialtyOverviewRow>[] {
  const numCol = (
    key: string,
    label: string,
    accessor: (r: SpecialtyOverviewRow) => number,
    render: (r: SpecialtyOverviewRow) => ReactNode,
    description: string,
  ): TableColumn<SpecialtyOverviewRow> => ({
    key,
    label,
    type: 'number',
    align: 'right',
    accessor,
    render,
    description,
  });

  return [
    {
      key: 'specialty',
      label: 'Specialty',
      type: 'string',
      width: 200,
      accessor: (r) => r.specialty.name,
      render: (r) => (
        <Link as={NextLink} href={`/planning/${r.specialty.slug}`}>
          {r.specialty.name}
        </Link>
      ),
    },
    numCol(
      'total',
      'Total codes',
      (r) => r.coverage.total,
      (r) => r.coverage.total.toLocaleString(),
      'All diagnosis codes in this specialty.',
    ),
    numCol(
      'mapped',
      '% mapped',
      (r) => mappedPct(r),
      (r) => pct1(mappedPct(r)),
      'Share of codes that have been run through mapping.',
    ),
    numCol(
      'inAmboss',
      'In AMBOSS',
      (r) => r.coverage.inAmboss,
      (r) => r.coverage.inAmboss.toLocaleString(),
      'Codes that already have an AMBOSS article.',
    ),
    numCol(
      'avgCoverage',
      'Avg coverage',
      (r) => r.coverage.avgCoverage,
      (r) => fmtNum(r.coverage.avgCoverage),
      'Mean coverage score (0–5) over mapped codes.',
    ),
    numCol(
      'gte3',
      '% ≥3',
      (r) => r.coverage.pctCoverageGte3,
      (r) => pct1(r.coverage.pctCoverageGte3),
      'Share of mapped codes scored 3 or above.',
    ),
    numCol(
      'newArticles',
      'New articles',
      (r) => r.backlog.newArticles,
      (r) => r.backlog.newArticles.toLocaleString(),
      'Approved new articles in the backlog.',
    ),
    numCol(
      'updates',
      'Updates',
      (r) => r.backlog.articleUpdates,
      (r) => r.backlog.articleUpdates.toLocaleString(),
      'Approved article updates in the backlog.',
    ),
    numCol(
      'drafted',
      'Drafted',
      (r) => r.backlog.drafted.total,
      (r) => r.backlog.drafted.total.toLocaleString(),
      'Backlog items with a draft generated (through ready-to-publish).',
    ),
    numCol(
      'published',
      'Published',
      (r) => r.backlog.published.total,
      (r) => r.backlog.published.total.toLocaleString(),
      'Published backlog items.',
    ),
  ];
}

export function SpecialtiesOverviewView({ rows }: { rows: SpecialtyOverviewRow[] }) {
  if (rows.length === 0) return null;

  const mappingBars: Bar[] = rows.map((r) => ({
    key: r.specialty.slug,
    label: r.specialty.name,
    value: mappedPct(r),
    display: pct1(mappedPct(r)),
  }));
  const sizeBars: Bar[] = rows.map((r) => ({
    key: r.specialty.slug,
    label: r.specialty.name,
    value: r.coverage.total,
    display: r.coverage.total.toLocaleString(),
  }));

  return (
    <Stack space="m">
      <DataTable
        rows={rows}
        columns={tableColumns()}
        getRowKey={(r) => r.specialty.slug}
        storageKey="specialties-overview"
        leadingNote={`${rows.length} ${rows.length === 1 ? 'specialty' : 'specialties'}`}
      />

      <Columns gap="m" vAlignItems="stretch">
        <Column size={[12, 12, 6]}>
          <ChartCard title="Mapping progress" tooltip={EXPLAIN.mapping}>
            <SpecialtiesBarChart bars={mappingBars} />
          </ChartCard>
        </Column>
        <Column size={[12, 12, 6]}>
          <ChartCard title="Coverage quality (score 0–5)" tooltip={EXPLAIN.quality}>
            <SpecialtiesScoreChart rows={rows} />
          </ChartCard>
        </Column>
        <Column size={[12, 12, 6]}>
          <ChartCard title="Total codes" tooltip={EXPLAIN.size}>
            <SpecialtiesBarChart bars={sizeBars} />
          </ChartCard>
        </Column>
        <Column size={[12, 12, 6]}>
          <ChartCard title="Backlog pipeline" tooltip={EXPLAIN.pipeline}>
            <SpecialtiesPipelineChart rows={rows} />
          </ChartCard>
        </Column>
      </Columns>
    </Stack>
  );
}

export function SpecialtiesOverviewSkeleton() {
  return (
    <Stack space="m">
      <Card outlined>
        <CardBox>
          <Stack space="s">
            <SkeletonLine width={'100%'} height={18} />
            <SkeletonLine width={'100%'} height={16} />
            <SkeletonLine width={'100%'} height={16} />
          </Stack>
        </CardBox>
      </Card>
      <Columns gap="m" vAlignItems="stretch">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Column key={k} size={[12, 12, 6]}>
            <div className="card-fill" style={fillStyle}>
              <Card outlined>
                <CardBox>
                  <Stack space="s">
                    <SkeletonLine width={'40%'} height={20} />
                    <SkeletonLine width={'90%'} height={14} />
                    <SkeletonLine width={'80%'} height={14} />
                    <SkeletonLine width={'85%'} height={14} />
                  </Stack>
                </CardBox>
              </Card>
            </div>
          </Column>
        ))}
      </Columns>
    </Stack>
  );
}
