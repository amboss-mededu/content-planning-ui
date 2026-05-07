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
    },
    {
      key: 'source',
      label: 'Source',
      description: 'Ontology this category came from (ICD10, HCUP, ABIM, Orpha)',
      render: (r) => r.source ?? '—',
      width: 80,
    },
    {
      key: 'numCodes',
      label: 'Codes',
      description:
        'Total codes in this category from the source ontology, before any inclusion filtering',
      render: (r) => r.numCodes ?? '—',
      width: 80,
      align: 'right',
    },
    {
      key: 'included',
      label: 'Included',
      description: "Codes kept after applying this specialty's exclusion list",
      render: (r) => r.numIncludedCodes ?? '—',
      width: 90,
      align: 'right',
    },
    {
      key: 'articles',
      label: 'Article codes',
      description:
        'Included codes covered by article-level suggestions / total article-bound codes in this category',
      render: (r) => `${r.numIncludedArticleCodes ?? 0} / ${r.totalArticleCodes ?? 0}`,
      width: 130,
      align: 'right',
    },
    {
      key: 'sections',
      label: 'Section codes',
      description:
        'Included codes covered by section-level suggestions / total section-bound codes in this category',
      render: (r) => `${r.numIncludedSectionCodes ?? 0} / ${r.totalSectionCodes ?? 0}`,
      width: 130,
      align: 'right',
    },
    {
      key: 'consolidated',
      label: 'Consolidated',
      description:
        'Whether the category has been deduped through the consolidation pipeline',
      render: (r) => (r.isConsolidated ? 'yes' : 'no'),
      width: 120,
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
