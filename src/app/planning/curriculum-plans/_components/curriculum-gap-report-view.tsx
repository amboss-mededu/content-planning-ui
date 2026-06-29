'use client';

import { Badge, SegmentedControl, Stack, Text } from '@amboss/design-system';
import { useMemo, useState } from 'react';
import {
  computeGapRows,
  coverageLevelOf,
  DEFAULT_GAP_CRITERIA,
  depthOf,
  type GapCriteria,
  isMapped,
} from '@/lib/data/curriculum-analytics';
import { topBlockOf } from '@/lib/data/curriculum-category';
import type { CodeRecord } from '@/lib/pb/types';
import { type Column, DataTable } from '../../_components/data-table';
import { CoverageBadge, DepthBadge } from '../../_components/suggestion-badge';

/**
 * Gap Report — the in-scope curriculum topics AMBOSS covers poorly, as a sortable
 * table. A preset toggle narrows the gap definition; the underlying predicate
 * lives in `curriculum-analytics.ts` (`isGap`) so it stays adjustable.
 */

type Preset = 'all' | 'unmapped' | 'shallow';

const PRESET_CRITERIA: Record<Preset, GapCriteria> = {
  all: DEFAULT_GAP_CRITERIA,
  unmapped: {
    requireInScope: true,
    unmapped: true,
    notInAmboss: false,
    shallow: false,
    shallowMax: 1,
  },
  // Mapped-but-weak only: not-in-AMBOSS + shallow coverage, excluding never-mapped.
  shallow: {
    requireInScope: true,
    unmapped: false,
    notInAmboss: true,
    shallow: true,
    shallowMax: 1,
  },
};

function yearPhaseLabel(c: CodeRecord): string {
  const m = c.curriculumMeta;
  if (m?.year != null) return `Year ${m.year}`;
  const phase = m?.phase?.trim();
  return phase || '—';
}

function newArticleCount(c: CodeRecord): number {
  return c.newArticleSuggestionCount ?? c.newArticlesNeeded?.length ?? 0;
}

const GAP_COLUMNS: Column<CodeRecord>[] = [
  {
    key: 'description',
    label: 'Topic',
    render: (r) => <Text size="s">{r.description || '—'}</Text>,
    accessor: (r) => r.description ?? '',
    filterable: true,
    filterMode: 'contains',
    verticalAlign: 'top',
    group: 'metadata',
    width: 300,
  },
  {
    key: 'block',
    label: 'Block',
    render: (r) => <Text size="s">{topBlockOf(r.category)}</Text>,
    accessor: (r) => topBlockOf(r.category),
    filterable: true,
    verticalAlign: 'top',
    group: 'metadata',
  },
  {
    key: 'yearPhase',
    label: 'Year / phase',
    render: (r) => <Text size="s">{yearPhaseLabel(r)}</Text>,
    accessor: (r) => yearPhaseLabel(r),
    filterable: true,
    group: 'curriculum',
  },
  {
    key: 'coverage',
    label: 'Coverage',
    render: (r) =>
      isMapped(r) ? (
        <CoverageBadge level={coverageLevelOf(r)} />
      ) : (
        <Badge text="Unmapped" color="gray" />
      ),
    accessor: (r) => (isMapped(r) ? coverageLevelOf(r) : 'unmapped'),
    filterable: true,
    group: 'coverage',
  },
  {
    key: 'score',
    label: 'Score',
    align: 'right',
    render: (r) =>
      isMapped(r) ? (
        <DepthBadge depth={depthOf(r)} level={coverageLevelOf(r)} />
      ) : (
        <Text size="s" color="tertiary">
          —
        </Text>
      ),
    accessor: (r) => (isMapped(r) ? depthOf(r) : -1),
    type: 'number',
    filterable: true,
    group: 'coverage',
  },
  {
    key: 'gaps',
    label: "What's missing",
    render: (r) => <Text size="s">{r.gaps?.trim() || '—'}</Text>,
    accessor: (r) => r.gaps ?? '',
    filterable: true,
    filterMode: 'contains',
    verticalAlign: 'top',
    group: 'coverage',
    width: 300,
  },
  {
    key: 'newArticles',
    label: 'New articles',
    align: 'right',
    render: (r) => <Text size="s">{newArticleCount(r)}</Text>,
    accessor: (r) => newArticleCount(r),
    type: 'number',
    filterable: true,
    group: 'suggestions',
  },
];

export function CurriculumGapReportView({
  slug,
  codes,
}: {
  slug: string;
  codes: CodeRecord[];
}) {
  const [preset, setPreset] = useState<Preset>('all');
  const rows = useMemo(
    () => computeGapRows(codes, PRESET_CRITERIA[preset]),
    [codes, preset],
  );

  if (codes.length === 0) {
    return <Text color="secondary">No curriculum items have been extracted yet.</Text>;
  }

  return (
    <Stack space="m">
      <SegmentedControl
        label="Gap filter"
        isLabelHidden
        size="s"
        value={preset}
        onChange={(v) => setPreset(v === 'unmapped' || v === 'shallow' ? v : 'all')}
        options={[
          { name: 'gap-filter', value: 'all', label: 'All gaps' },
          { name: 'gap-filter', value: 'unmapped', label: 'Unmapped only' },
          { name: 'gap-filter', value: 'shallow', label: 'Shallow only' },
        ]}
      />
      <DataTable
        rows={rows}
        columns={GAP_COLUMNS}
        getRowKey={(r) => r.id ?? r.code}
        storageKey={`curriculum-gap:${slug}`}
        emptyText={
          preset === 'all'
            ? 'No gaps — every in-scope topic has coverage.'
            : 'No topics match this filter.'
        }
        countAddendum={(fr) => {
          const unmapped = fr.filter((r) => !isMapped(r)).length;
          return unmapped > 0 ? `${unmapped} unmapped` : undefined;
        }}
      />
    </Stack>
  );
}
