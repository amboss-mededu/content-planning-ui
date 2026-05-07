'use client';

import { Link, Stack, Text } from '@amboss/design-system';
import type { CodeCategory } from '@/lib/types';
import { type Column, DataTable } from './data-table';

export function CategoriesView({ rows, slug }: { rows: CodeCategory[]; slug: string }) {
  const columns: Column<CodeCategory>[] = [
    {
      key: 'codeCategory',
      label: 'Category',
      description:
        'Code category from the source ontology (ICD-10, HCUP, ABIM, or Orpha) — click to drill into its codes',
      render: (r) =>
        r.codeCategory ? (
          <Link
            href={`/planning/${encodeURIComponent(slug)}/codes?category=${encodeURIComponent(r.codeCategory)}`}
          >
            {r.codeCategory}
          </Link>
        ) : (
          '—'
        ),
      accessor: (r) => r.codeCategory ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'source',
      label: 'Source',
      description: 'Ontology this category came from (ICD10, HCUP, ABIM, Orpha)',
      render: (r) => r.source ?? '—',
      width: 80,
      align: 'center',
      accessor: (r) => r.source ?? null,
      type: 'string',
      filterable: true,
    },
    {
      key: 'numCodes',
      label: 'Codes',
      description:
        'Total codes in this category from the source ontology, before any inclusion filtering',
      render: (r) => r.numCodes ?? '—',
      width: 80,
      align: 'center',
      accessor: (r) => r.numCodes ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'included',
      label: 'Included',
      description: "Codes kept after applying this specialty's exclusion list",
      render: (r) => r.numIncludedCodes ?? '—',
      width: 90,
      align: 'center',
      accessor: (r) => r.numIncludedCodes ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'articles',
      label: 'Article codes',
      description:
        'Included codes covered by article-level suggestions / total article-bound codes in this category',
      render: (r) => `${r.numIncludedArticleCodes ?? 0} / ${r.totalArticleCodes ?? 0}`,
      width: 130,
      align: 'center',
      // Sort/filter on the included count — that's the editorial signal,
      // not the raw total.
      accessor: (r) => r.numIncludedArticleCodes ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'sections',
      label: 'Section codes',
      description:
        'Included codes covered by section-level suggestions / total section-bound codes in this category',
      render: (r) => `${r.numIncludedSectionCodes ?? 0} / ${r.totalSectionCodes ?? 0}`,
      width: 130,
      align: 'center',
      accessor: (r) => r.numIncludedSectionCodes ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'consolidated',
      label: 'Consolidated',
      description:
        'Whether the category has been deduped through the consolidation pipeline',
      render: (r) => (r.isConsolidated ? 'yes' : 'no'),
      width: 120,
      align: 'center',
      accessor: (r) =>
        r.isConsolidated === true ? 1 : r.isConsolidated === false ? 0 : null,
      type: 'boolean',
      filterable: true,
      filterValue: (r) =>
        r.isConsolidated === true ? 'yes' : r.isConsolidated === false ? 'no' : undefined,
      filterOptions: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
  ];

  return (
    <Stack space="m">
      <Text color="secondary">
        {rows.length} categories from Code_Categories. Click a category name to drill into
        its codes.
      </Text>
      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(r, i) => `${r.codeCategory ?? 'row'}-${i}`}
        emptyText="No categories found."
      />
    </Stack>
  );
}
