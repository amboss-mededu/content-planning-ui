'use client';

import {
  Badge,
  Box,
  Card,
  Collapsible,
  CollapsibleHeader,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { type CSSProperties, useMemo, useState } from 'react';
import {
  buildTimeline,
  coverageLevelOf,
  depthOf,
  isMapped,
  type TimelineBar,
  type TimelineRow,
  type UnscheduledGroup,
} from '@/lib/data/curriculum-analytics';
import type { CodeRecord } from '@/lib/pb/types';
import { CURRICULUM_COVERAGE_LEVELS } from '@/lib/types';
import {
  formatDurationOrCadence,
  formatTimeframe,
} from '@/lib/workflows/lib/curriculum-meta';
import { CoverageBadge } from '../../_components/suggestion-badge';

/**
 * Timeline / Timeboxes — an academic-year gantt (Sep→Aug columns, year/phase
 * rows) over each topic's `curriculumMeta`. Topics with calendar timing render
 * as coverage-tinted bars; the rest fall into a by-block "Unscheduled" lane.
 * No chart library exists in the repo, so this is hand-rolled CSS grid, styled
 * like the bars in `specialties-overview.tsx`.
 */

// Warm→green coverage ramp for scores 0–5 (copy of the local ramp in
// specialties-overview.tsx, which isn't exported). Indexed by depth.
const SCORE_COLORS = ['#d64545', '#e0843c', '#edc14b', '#9bc24a', '#5aa84f', '#2f8a3e'];

const headerRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px repeat(12, 1fr)',
  alignItems: 'end',
};
const monthCellStyle: CSSProperties = {
  textAlign: 'center',
  borderLeft: '1px solid rgb(228, 228, 234)',
};
const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  alignItems: 'center',
  minHeight: 28,
};
const laneGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, 1fr)',
};
const barStyle: CSSProperties = {
  margin: '2px',
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 12,
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

/** Yellow / light-green bars need dark text; the rest read better in white. */
function barTextColor(depth: number): string {
  return depth === 2 || depth === 3 ? '#1f2937' : '#fff';
}

function barTitle(code: CodeRecord): string {
  const tf = formatTimeframe(code.curriculumMeta);
  const dur = formatDurationOrCadence(code.curriculumMeta);
  const cov = isMapped(code) ? coverageLevelOf(code) : 'unmapped';
  const parts = [code.description?.trim() || '(untitled)', tf];
  if (dur !== '—') parts.push(dur);
  parts.push(cov);
  return parts.join(' · ');
}

function BarView({ bar }: { bar: TimelineBar }) {
  const depth = depthOf(bar.code);
  const color = barTextColor(depth);
  const title = barTitle(bar.code);
  return (
    <div
      role="img"
      aria-label={title}
      title={title}
      style={{
        ...barStyle,
        gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
        background: SCORE_COLORS[depth],
        color,
        textShadow: color === '#fff' ? '0 1px 1px rgba(0,0,0,0.35)' : undefined,
      }}
    >
      {bar.code.description?.trim() || '(untitled)'}
    </div>
  );
}

function TimelineRowView({ row }: { row: TimelineRow }) {
  // Group bars by their packed lane (contiguous 0..laneCount-1). Key each lane
  // by its first bar's id so we never key on the array index.
  const lanes: TimelineBar[][] = [];
  for (const bar of row.bars) {
    const lane = lanes[bar.lane] ?? [];
    lane.push(bar);
    lanes[bar.lane] = lane;
  }
  return (
    <div style={rowStyle}>
      <div style={{ paddingRight: 8 }}>
        <Text size="s" weight="bold">
          {row.label}
        </Text>
      </div>
      <Stack space="xxs">
        {lanes.map((laneBars) => (
          <div key={laneBars[0]?.code.id ?? laneBars[0]?.code.code} style={laneGridStyle}>
            {laneBars.map((bar) => (
              <BarView key={bar.code.id ?? bar.code.code} bar={bar} />
            ))}
          </div>
        ))}
      </Stack>
    </div>
  );
}

function ScoreLegend() {
  return (
    <Inline space="m" vAlignItems="center">
      <Text size="s" color="tertiary">
        Coverage
      </Text>
      {CURRICULUM_COVERAGE_LEVELS.map((level, i) => (
        <Inline key={level} space="xxs" vAlignItems="center">
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 2,
              background: SCORE_COLORS[i],
            }}
          />
          <Text size="s" color="tertiary">
            {level}
          </Text>
        </Inline>
      ))}
    </Inline>
  );
}

function UnscheduledBlock({ group }: { group: UnscheduledGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <Card outlined>
      <Collapsible isExpanded={open}>
        <CollapsibleHeader
          space="m"
          vSpace="s"
          onClick={() => setOpen((v) => !v)}
          expandedIconAriaLabel={`Collapse ${group.block}`}
          collapsedIconAriaLabel={`Expand ${group.block}`}
        >
          <Text weight="bold">
            {group.block} ({group.codes.length})
          </Text>
        </CollapsibleHeader>
        <Box space="m" vSpace="s">
          <Stack space="xs">
            {group.codes.map((c) => {
              const dur = formatDurationOrCadence(c.curriculumMeta);
              return (
                <Inline
                  key={c.id ?? c.code}
                  space="s"
                  vAlignItems="center"
                  alignItems="spaceBetween"
                  fullWidth
                >
                  <Text size="s">{c.description?.trim() || '—'}</Text>
                  <Inline space="xs" vAlignItems="center">
                    {dur !== '—' ? (
                      <Text size="s" color="tertiary">
                        {dur}
                      </Text>
                    ) : null}
                    {isMapped(c) ? (
                      <CoverageBadge level={coverageLevelOf(c)} />
                    ) : (
                      <Badge text="Unmapped" color="gray" />
                    )}
                  </Inline>
                </Inline>
              );
            })}
          </Stack>
        </Box>
      </Collapsible>
    </Card>
  );
}

function UnscheduledSection({ groups }: { groups: UnscheduledGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <Stack space="s">
      <Text weight="bold">Unscheduled</Text>
      <Text size="s" color="tertiary">
        Topics without calendar timing in the source, grouped by block.
      </Text>
      {groups.map((g) => (
        <UnscheduledBlock key={g.block} group={g} />
      ))}
    </Stack>
  );
}

export function CurriculumTimelineView({ codes }: { codes: CodeRecord[] }) {
  const timeline = useMemo(() => buildTimeline(codes), [codes]);

  if (codes.length === 0) {
    return <Text color="secondary">No curriculum items have been extracted yet.</Text>;
  }

  return (
    <Stack space="l">
      {timeline.scheduledCount > 0 ? (
        <Stack space="s">
          <Card outlined>
            <Box space="m" vSpace="m">
              <Stack space="s">
                <div style={headerRowStyle}>
                  <div />
                  {timeline.months.map((m) => (
                    <div key={m} style={monthCellStyle}>
                      <Text size="s" color="tertiary">
                        {m}
                      </Text>
                    </div>
                  ))}
                </div>
                <Stack space="s">
                  {timeline.rows.map((row) => (
                    <TimelineRowView key={row.key} row={row} />
                  ))}
                </Stack>
              </Stack>
            </Box>
          </Card>
          <ScoreLegend />
        </Stack>
      ) : (
        <Text color="secondary">
          No topics have calendar timing yet — showing all {codes.length} topics grouped
          by block.
        </Text>
      )}

      <UnscheduledSection groups={timeline.unscheduled} />
    </Stack>
  );
}
