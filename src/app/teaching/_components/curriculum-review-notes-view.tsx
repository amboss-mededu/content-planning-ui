'use client';

import {
  Badge,
  Card,
  Inline,
  SegmentedControl,
  Stack,
  Text,
} from '@amboss/design-system';
import { useMemo, useState } from 'react';
import {
  buildReviewRows,
  type ReviewRow,
  type ReviewStatus,
  reviewCounts,
} from '@/lib/data/curriculum-analytics';
import type { CodeRecord } from '@/lib/pb/types';
import { rowTint } from '../../planning/_components/decision-buttons';

/**
 * Read-only review board for a curriculum plan. Shows each topic's approval
 * status, reviewer + timestamp, and the LLM-written notes/gaps/improvements,
 * filterable by status. Decisions are made on the Mapping tab — this view never
 * writes.
 */

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

function statusBadge(status: ReviewStatus) {
  if (status === 'approved') return <Badge text="Approved" color="green" />;
  if (status === 'rejected') return <Badge text="Rejected" color="red" />;
  return <Badge text="Pending" color="gray" />;
}

/** Deterministic UTC date (avoids a locale/timezone hydration mismatch). */
function formatReviewedAt(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function reviewerLine(row: ReviewRow): string {
  if (!row.reviewedAt) return 'Not yet reviewed';
  const verb =
    row.status === 'approved'
      ? 'Approved'
      : row.status === 'rejected'
        ? 'Rejected'
        : 'Reviewed';
  const who = row.reviewer ? row.reviewer.split('@')[0] : 'unknown';
  return `${verb} by ${who} · ${formatReviewedAt(row.reviewedAt)}`;
}

function NoteBlock({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Stack space="xxs">
      <Text size="s" color="secondary" weight="bold">
        {label}
      </Text>
      <Text size="s">{value}</Text>
    </Stack>
  );
}

function ReviewCard({ row }: { row: ReviewRow }) {
  return (
    <Card outlined>
      <div style={{ padding: 16, ...(rowTint(row.status) ?? {}) }}>
        <Stack space="s">
          <Inline alignItems="spaceBetween" vAlignItems="center" space="s" fullWidth>
            <Text weight="bold">{row.description}</Text>
            {statusBadge(row.status)}
          </Inline>
          <Inline space="s" vAlignItems="center">
            <Text size="s" color="tertiary">
              {row.block}
            </Text>
            <Text size="s" color="tertiary">
              ·
            </Text>
            <Text size="s" color="tertiary">
              {reviewerLine(row)}
            </Text>
          </Inline>
          {row.notes || row.gaps || row.improvements ? (
            <Stack space="xs">
              <NoteBlock label="Notes" value={row.notes} />
              <NoteBlock label="Gaps" value={row.gaps} />
              <NoteBlock label="Improvements" value={row.improvements} />
            </Stack>
          ) : null}
        </Stack>
      </div>
    </Card>
  );
}

export function CurriculumReviewNotesView({ codes }: { codes: CodeRecord[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => buildReviewRows(codes), [codes]);
  const counts = useMemo(() => reviewCounts(rows), [rows]);
  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'pending') return rows.filter((r) => r.status === '');
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  if (rows.length === 0) {
    return <Text color="secondary">No curriculum items have been extracted yet.</Text>;
  }

  return (
    <Stack space="m">
      <Inline alignItems="spaceBetween" vAlignItems="center" space="s" fullWidth>
        <SegmentedControl
          label="Filter by review status"
          isLabelHidden
          size="s"
          value={filter}
          onChange={(v) =>
            setFilter(v === 'pending' || v === 'approved' || v === 'rejected' ? v : 'all')
          }
          options={[
            { name: 'review-filter', value: 'all', label: `All (${counts.all})` },
            {
              name: 'review-filter',
              value: 'pending',
              label: `Pending (${counts.pending})`,
            },
            {
              name: 'review-filter',
              value: 'approved',
              label: `Approved (${counts.approved})`,
            },
            {
              name: 'review-filter',
              value: 'rejected',
              label: `Rejected (${counts.rejected})`,
            },
          ]}
        />
        <Text size="s" color="tertiary">
          Read-only — approve or reject on the Mapping tab.
        </Text>
      </Inline>

      {filtered.length === 0 ? (
        <Text color="secondary">No {filter === 'all' ? '' : filter} items.</Text>
      ) : (
        <Stack space="s">
          {filtered.map((row) => (
            <ReviewCard key={row.id} row={row} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
