'use client';

import { Badge, Inline, Select, Stack, Text } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CodeChipList, type CodeMap } from './code-chip';
import { type Column, DataTable } from './data-table';

/**
 * Unified row shape for the Sections tab. ConsolidatedSection records are
 * projected into this shape upstream so the table can render code chips
 * and a derived `updateType` without re-deriving on every render.
 */
export type SectionRow = {
  articleTitle?: string;
  articleId?: string;
  sectionName?: string;
  updateType: 'new' | 'update' | null;
  category?: string;
  codes: string[];
  numCodes: number;
  overallImportance?: number;
  overallCoverage?: number;
  justification?: string;
};

const UPDATE_TYPE_FILTER_OPTIONS = [
  { value: 'new', label: 'new' },
  { value: 'update', label: 'update' },
  { value: 'none', label: '—' },
];

function updateTypeBadge(r: SectionRow) {
  if (r.updateType === 'new') return <Badge text="new" color="blue" />;
  if (r.updateType === 'update') return <Badge text="update" color="purple" />;
  return <Badge text="—" color="gray" />;
}

export function SectionsView({
  rows,
  codeMap,
}: {
  rows: SectionRow[];
  codeMap: CodeMap;
}) {
  const params = useSearchParams();
  const [kind, setKind] = useState<string>(() => params.get('kind') ?? '');
  const [article, setArticle] = useState<string>(() => params.get('article') ?? '');

  useEffect(() => {
    const p = new URLSearchParams();
    if (kind) p.set('kind', kind);
    if (article) p.set('article', article);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [kind, article]);

  // Article options come from the full row set so the dropdown is stable
  // when the kind filter changes. Counts are per-article totals across
  // all kinds.
  const articleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const t = r.articleTitle;
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, n]) => ({ value: title, label: `${title} (${n})` }));
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (kind === 'new') out = out.filter((r) => r.updateType === 'new');
    else if (kind === 'update') out = out.filter((r) => r.updateType === 'update');
    if (article) out = out.filter((r) => r.articleTitle === article);
    return out;
  }, [rows, kind, article]);

  const columns: Column<SectionRow>[] = useMemo(
    () => [
      {
        key: 'articleTitle',
        label: 'Article Title',
        description: 'Existing AMBOSS article this section belongs to',
        render: (r) => r.articleTitle ?? '—',
        align: 'center',
        accessor: (r) => r.articleTitle ?? null,
        type: 'string',
        filterable: true,
        filterMode: 'contains',
      },
      {
        key: 'articleId',
        label: 'Article ID',
        description: 'AMBOSS article ID',
        render: (r) => r.articleId ?? '—',
        width: 140,
        align: 'center',
        accessor: (r) => r.articleId ?? null,
        type: 'string',
        filterable: true,
        filterMode: 'contains',
      },
      {
        key: 'sectionName',
        label: 'Section Title',
        description: 'Suggested section title',
        render: (r) => r.sectionName ?? '—',
        align: 'center',
        accessor: (r) => r.sectionName ?? null,
        type: 'string',
        filterable: true,
        filterMode: 'contains',
      },
      {
        key: 'updateType',
        label: 'Update Type',
        description: 'Whether this is a new section or an update to an existing one',
        render: updateTypeBadge,
        width: 130,
        align: 'center',
        accessor: (r) => r.updateType ?? 'none',
        type: 'string',
        filterable: true,
        filterValue: (r) => r.updateType ?? 'none',
        filterOptions: UPDATE_TYPE_FILTER_OPTIONS,
      },
      {
        key: 'category',
        label: 'Category',
        description: 'Source code category that anchors this section',
        render: (r) => r.category ?? '—',
        width: 160,
        align: 'center',
        accessor: (r) => r.category ?? null,
        type: 'string',
        filterable: true,
      },
      {
        key: 'codes',
        label: 'Codes',
        description:
          'Codes included in this section. Click a chip for the code description, source category, existing AMBOSS coverage, and coverage score.',
        render: (r) => <CodeChipList codes={r.codes} codeMap={codeMap} />,
        verticalAlign: 'top',
        align: 'left',
        accessor: (r) => r.codes.join(' '),
        type: 'string',
        filterable: true,
        filterMode: 'contains',
      },
      {
        key: 'numCodes',
        label: '# Codes',
        description: 'Count of unique codes in this section',
        render: (r) => r.numCodes,
        width: 90,
        align: 'center',
        accessor: (r) => r.numCodes,
        type: 'number',
        filterable: true,
      },
      {
        key: 'importance',
        label: 'Importance',
        description: 'Editorial importance score (higher = higher priority)',
        render: (r) => r.overallImportance ?? '—',
        width: 110,
        align: 'center',
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
        width: 110,
        align: 'center',
        accessor: (r) => r.overallCoverage ?? null,
        type: 'number',
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
        verticalAlign: 'top',
        accessor: (r) => r.justification ?? null,
        type: 'string',
        filterable: true,
        filterMode: 'contains',
      },
    ],
    [codeMap],
  );

  return (
    <Stack space="m">
      <Inline space="s" vAlignItems="bottom">
        <div className="filter-cell">
          <Select
            name="kind"
            label="Update Type"
            value={kind}
            options={[
              { value: '', label: 'All' },
              { value: 'new', label: 'New sections' },
              { value: 'update', label: 'Section updates' },
            ]}
            onChange={(e) => setKind(e.target.value)}
          />
        </div>
        <div className="filter-cell">
          <Select
            name="article"
            label="Article"
            value={article}
            options={[{ value: '', label: 'All articles' }, ...articleOptions]}
            onChange={(e) => setArticle(e.target.value)}
          />
        </div>
      </Inline>
      <Text color="secondary">
        {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} section
        suggestions (Section_Suggestions tab).
      </Text>
      <DataTable rows={filtered} columns={columns} getRowKey={(_r, i) => `${i}`} />
    </Stack>
  );
}
