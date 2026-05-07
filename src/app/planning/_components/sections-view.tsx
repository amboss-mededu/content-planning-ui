'use client';

import { Badge, Inline, Select, Stack, Text } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ConsolidatedSection } from '@/lib/types';
import { type Column, DataTable } from './data-table';

function kindBadge(row: ConsolidatedSection) {
  if (row.newSection) return <Badge text="new-section" color="blue" />;
  if (row.sectionUpdate) return <Badge text="section-update" color="purple" />;
  return <Badge text="—" color="gray" />;
}

const KIND_FILTER_OPTIONS = [
  { value: 'new-section', label: 'New section' },
  { value: 'section-update', label: 'Section update' },
  { value: 'none', label: '—' },
];

function kindOf(row: ConsolidatedSection): 'new-section' | 'section-update' | 'none' {
  if (row.newSection) return 'new-section';
  if (row.sectionUpdate) return 'section-update';
  return 'none';
}

const columns: Column<ConsolidatedSection>[] = [
  {
    key: 'kind',
    label: 'Kind',
    description:
      'Whether this row is a brand-new section or an update to an existing one',
    render: kindBadge,
    width: 140,
    // Sort/filter on the derived kind string; the toolbar Select above the
    // table uses the same axis but tracks its choice in URL params, so the
    // two are independent — applying both intersects.
    accessor: kindOf,
    type: 'string',
    filterable: true,
    filterValue: kindOf,
    filterOptions: KIND_FILTER_OPTIONS,
  },
  {
    key: 'article',
    label: 'Article',
    description: 'Parent article this section belongs to',
    render: (r) => r.articleTitle ?? '—',
    accessor: (r) => r.articleTitle ?? null,
    type: 'string',
    filterable: true,
    filterMode: 'contains',
  },
  {
    key: 'section',
    label: 'Section',
    description: 'Suggested section name',
    render: (r) => r.sectionName ?? '—',
    accessor: (r) => r.sectionName ?? null,
    type: 'string',
    filterable: true,
    filterMode: 'contains',
  },
  {
    key: 'category',
    label: 'Category',
    description: 'Code category that anchors this section',
    render: (r) => r.category ?? '—',
    accessor: (r) => r.category ?? null,
    type: 'string',
    filterable: true,
    verticalAlign: 'top',
  },
  {
    key: 'importance',
    label: 'Importance',
    description: 'Editorial importance score (higher = higher priority)',
    render: (r) => r.overallImportance ?? '—',
    width: 100,
    align: 'right',
    accessor: (r) => r.overallImportance ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'coverage',
    label: 'Coverage',
    description:
      'Existing AMBOSS coverage score for this section (higher = better covered)',
    render: (r) => r.overallCoverage ?? '—',
    width: 100,
    align: 'right',
    accessor: (r) => r.overallCoverage ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'editor',
    label: 'Editor',
    description: 'Editor assigned to draft or update this section',
    render: (r) => r.assignedEditor ?? '—',
    width: 140,
    accessor: (r) => r.assignedEditor ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'justification',
    label: 'Justification',
    description: 'Why this section should be created or updated',
    render: (r) => (
      <Text color="secondary" size="s">
        {r.justification ?? ''}
      </Text>
    ),
    accessor: (r) => r.justification ?? null,
    type: 'string',
    filterable: true,
    filterMode: 'contains',
    verticalAlign: 'top',
  },
];

export function SectionsView({ rows }: { rows: ConsolidatedSection[] }) {
  const params = useSearchParams();
  const [kind, setKind] = useState<string>(() => params.get('kind') ?? '');

  useEffect(() => {
    const p = new URLSearchParams();
    if (kind) p.set('kind', kind);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [kind]);

  const filtered = useMemo(() => {
    if (kind === 'new') return rows.filter((r) => r.newSection === true);
    if (kind === 'update') return rows.filter((r) => r.sectionUpdate === true);
    return rows;
  }, [rows, kind]);

  return (
    <Stack space="m">
      <Inline space="s" vAlignItems="bottom">
        <div className="filter-cell">
          <Select
            name="kind"
            label="Kind"
            value={kind}
            options={[
              { value: '', label: 'All' },
              { value: 'new', label: 'New sections' },
              { value: 'update', label: 'Section updates' },
            ]}
            onChange={(e) => setKind(e.target.value)}
          />
        </div>
      </Inline>
      <Text color="secondary">
        {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} section
        suggestions (Section_Suggestions tab).
      </Text>
      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(r, i) => `${i}-${r.uniqueId ?? r.index ?? ''}`}
      />
    </Stack>
  );
}
