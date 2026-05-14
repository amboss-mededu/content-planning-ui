'use client';

import { Link, Stack, Text, Tooltip } from '@amboss/design-system';
import type { ReactNode } from 'react';
import type { CategoryOrchestration } from '@/lib/data/categories';
import { type Column, DataTable } from './data-table';

type ChipTone = 'amber' | 'red' | 'none';

function QcChip({ value, tone }: { value: ReactNode; tone: ChipTone }) {
  // `tone === 'none'` renders an unstyled span so the cell still takes part
  // in numeric sorting/filtering without a visual wash that fights the
  // group stripe.
  const bg =
    tone === 'red'
      ? 'rgba(220, 38, 38, 0.18)'
      : tone === 'amber'
        ? 'rgba(245, 158, 11, 0.18)'
        : 'transparent';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0 6px',
        borderRadius: 4,
        background: bg,
      }}
    >
      {value}
    </span>
  );
}

export function CategoriesView({
  rows,
  slug,
}: {
  rows: CategoryOrchestration[];
  slug: string;
}) {
  const columns: Column<CategoryOrchestration>[] = [
    {
      key: 'consolidationCategory',
      label: 'Consolidation category',
      description:
        'Bucket the consolidation pipeline assigned codes to. Rows are derived from extracted codes — one row per unique consolidationCategory present in the codes table. The "(unbucketed)" row groups codes the pipeline never assigned a bucket to.',
      render: (r) => {
        const label = r.isUnbucketed ? r.consolidationCategory : r.consolidationCategory;
        const link = r.isUnbucketed ? (
          <span style={{ color: 'inherit' }}>{label}</span>
        ) : (
          <Link
            href={`/planning/${encodeURIComponent(slug)}/codes?consolidationCategory=${encodeURIComponent(r.consolidationCategory)}`}
          >
            {label}
          </Link>
        );
        if (r.isUnbucketed) {
          return (
            <Tooltip content="Codes with no consolidationCategory — pipeline never bucketed them.">
              <QcChip value={link} tone="amber" />
            </Tooltip>
          );
        }
        if (!r.hasAnyStatusInfo) {
          return (
            <Tooltip content="No source-category status info for any code in this bucket — every code reports as orphan.">
              <QcChip value={link} tone="amber" />
            </Tooltip>
          );
        }
        return link;
      },
      accessor: (r) => r.consolidationCategory,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
      group: 'metadata',
    },
    {
      key: 'source',
      label: 'Source',
      description:
        'Ontology the codes in this bucket came from. When codes have mixed sources, the most common one is shown.',
      render: (r) => r.source ?? '—',
      width: 80,
      align: 'center',
      accessor: (r) => r.source ?? null,
      type: 'string',
      filterable: true,
      group: 'metadata',
    },
    {
      key: 'numCodes',
      label: '# Codes',
      description:
        'Unique codes assigned to this consolidation bucket in the extracted codes table. Ideally equal to # Included.',
      render: (r) => r.numCodes,
      width: 100,
      align: 'center',
      accessor: (r) => r.numCodes,
      type: 'number',
      filterable: true,
      group: 'metadata',
    },
    {
      key: 'numIncludedCodes',
      label: '# Included',
      description:
        'Codes in this bucket the consolidation kept and routed into articles/sections. Amber when below # Codes.',
      render: (r) => {
        const tone: ChipTone = r.numIncludedCodes < r.numCodes ? 'amber' : 'none';
        return <QcChip value={r.numIncludedCodes} tone={tone} />;
      },
      width: 110,
      align: 'center',
      accessor: (r) => r.numIncludedCodes,
      type: 'number',
      filterable: true,
      group: 'consolidation',
    },
    {
      key: 'numExcludedCodes',
      label: '# Excluded',
      description:
        'Codes in this bucket the LLM/rules explicitly chose to drop. Intentional — not a bug.',
      render: (r) => r.numExcludedCodes,
      width: 110,
      align: 'center',
      accessor: (r) => r.numExcludedCodes,
      type: 'number',
      filterable: true,
      group: 'consolidation',
    },
    {
      key: 'numTotallyIgnoredCodes',
      label: '# Ignored',
      description:
        'Codes in this bucket the LLM silently omitted (leakage). Should be 0 — non-zero is a quality red flag, more common on larger consolidation runs.',
      render: (r) => {
        const tone: ChipTone = r.numTotallyIgnoredCodes > 0 ? 'amber' : 'none';
        return <QcChip value={r.numTotallyIgnoredCodes} tone={tone} />;
      },
      width: 110,
      align: 'center',
      accessor: (r) => r.numTotallyIgnoredCodes,
      type: 'number',
      filterable: true,
      group: 'consolidation',
    },
    {
      key: 'numOrphanCodes',
      label: '# Orphan',
      description:
        'Codes in this bucket whose code-string is in none of the included / excluded / ignored arrays of any source-category record. Worst signal — pipeline never accounted for them.',
      render: (r) => {
        const tone: ChipTone = r.numOrphanCodes > 0 ? 'red' : 'none';
        return <QcChip value={r.numOrphanCodes} tone={tone} />;
      },
      width: 110,
      align: 'center',
      accessor: (r) => r.numOrphanCodes,
      type: 'number',
      filterable: true,
      group: 'consolidation',
    },
  ];

  return (
    <Stack space="m">
      <Text color="secondary">
        {rows.length} consolidation buckets derived from extracted codes. Click a bucket
        name to drill into its codes.
      </Text>
      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(r, i) => `${r.consolidationCategory}-${i}`}
        emptyText="No consolidation buckets found."
        storageKey={`categories-table:${slug}`}
      />
    </Stack>
  );
}
