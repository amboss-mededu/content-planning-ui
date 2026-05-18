'use client';

import { Badge, Inline, Link, Stack, Text, Tooltip } from '@amboss/design-system';
import { type CSSProperties, type ReactNode, useState } from 'react';
import type {
  CategoryOrchestration,
  SourceCategoryProgress,
} from '@/lib/data/categories';
import { type Column, DataTable } from './data-table';

type ChipTone = 'amber' | 'red' | 'none';

type CategoryStatus = 'not-ready' | 'ready' | 'consolidated';

/**
 * Status progression per bucket:
 *
 *   not-ready    → some "included" codes still unmapped
 *   ready        → every included code mapped, no consolidated output yet
 *   consolidated → every included code mapped AND at least one
 *                  newArticleSuggestions row cites a code from this bucket
 *
 * The (unbucketed) row is always "not-ready" — by definition its codes
 * weren't picked up by the bucketing step and consolidation can't run
 * on it. Buckets with zero included codes (only excluded/ignored) are
 * treated as "done" once consolidation has produced any output, so the
 * status doesn't get stuck on "ready" for buckets the editor has
 * already curated out.
 */
function deriveStatus(r: {
  isUnbucketed: boolean;
  numMappedCodes: number;
  numCodes: number;
  hasConsolidatedOutput: boolean;
}): CategoryStatus {
  if (r.isUnbucketed) return 'not-ready';
  // Compare mapped against the bucket's total code count, not the
  // consolidation-step's "included" subset. The included subset can be
  // smaller than the mapped count (a code can be mapped at the codes
  // step but later excluded by consolidation), which produced misleading
  // ratios like 162/157.
  const mapped = r.numMappedCodes >= r.numCodes;
  if (!mapped) return 'not-ready';
  return r.hasConsolidatedOutput ? 'consolidated' : 'ready';
}

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

type ViewMode = 'consolidation' | 'source';

export function CategoriesView({
  rows,
  sourceRows,
  slug,
}: {
  rows: CategoryOrchestration[];
  sourceRows: SourceCategoryProgress[];
  slug: string;
}) {
  const [mode, setMode] = useState<ViewMode>('consolidation');

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
            href={`/planning/${encodeURIComponent(slug)}/mapping?consolidationCategory=${encodeURIComponent(r.consolidationCategory)}`}
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
      key: 'numMappedCodes',
      label: 'Mapped',
      description:
        'Codes in this bucket the mapping pipeline has stamped (mappedAt > 0), shown as mapped/total against # Codes — the raw count in the category, not the consolidation-curated # Included subset.',
      render: (r) => {
        const tone: ChipTone = r.numMappedCodes < r.numCodes ? 'amber' : 'none';
        return <QcChip value={`${r.numMappedCodes}/${r.numCodes}`} tone={tone} />;
      },
      width: 110,
      align: 'center',
      accessor: (r) => r.numMappedCodes,
      type: 'number',
      filterable: true,
      group: 'metadata',
    },
    {
      key: 'status',
      label: 'Status',
      description:
        'Not ready → some codes still unmapped. Ready for consolidation → all included codes mapped, awaiting consolidation. Consolidated → at least one consolidated output article cites a code from this bucket.',
      render: (r) => {
        const status = deriveStatus(r);
        if (status === 'consolidated') {
          return <Badge text="Consolidated" color="green" icon="check" />;
        }
        if (status === 'ready') {
          return <Badge text="Ready for consolidation" color="brand" />;
        }
        return <Badge text="Not ready" color="gray" />;
      },
      width: 220,
      align: 'left',
      accessor: (r) => {
        const status = deriveStatus(r);
        return status === 'consolidated' ? 2 : status === 'ready' ? 1 : 0;
      },
      type: 'number',
      filterable: true,
      filterOptions: [
        { value: '0', label: 'Not ready' },
        { value: '1', label: 'Ready for consolidation' },
        { value: '2', label: 'Consolidated' },
      ],
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
      <ViewModeToggle mode={mode} onChange={setMode} />
      {mode === 'consolidation' ? (
        <>
          <Text color="secondary">
            {rows.length} consolidation buckets derived from extracted codes. Click a
            bucket name to drill into its codes.
          </Text>
          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(r, i) => `${r.consolidationCategory}-${i}`}
            emptyText="No consolidation buckets found."
            storageKey={`categories-table:${slug}`}
          />
        </>
      ) : (
        <SourceCategoriesTable rows={sourceRows} slug={slug} />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// View-mode toggle + source-category table (backup view)
// ---------------------------------------------------------------------------

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const buttonStyle = (active: boolean): CSSProperties => ({
    padding: '6px 12px',
    fontSize: 13,
    borderRadius: 4,
    border: `1px solid ${active ? 'rgb(217, 119, 6)' : 'rgb(210, 210, 215)'}`,
    background: active ? 'rgb(255, 247, 235)' : 'white',
    color: active ? 'rgb(30, 30, 40)' : 'rgb(80, 80, 90)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    font: 'inherit',
  });
  return (
    <Inline space="xs" vAlignItems="center">
      <Text size="s" color="secondary">
        View:
      </Text>
      <button
        type="button"
        style={buttonStyle(mode === 'consolidation')}
        onClick={() => onChange('consolidation')}
        aria-pressed={mode === 'consolidation'}
      >
        Consolidation buckets
      </button>
      <button
        type="button"
        style={buttonStyle(mode === 'source')}
        onClick={() => onChange('source')}
        aria-pressed={mode === 'source'}
      >
        Source categories
      </button>
    </Inline>
  );
}

function SourceCategoriesTable({
  rows,
  slug,
}: {
  rows: SourceCategoryProgress[];
  slug: string;
}) {
  const columns: Column<SourceCategoryProgress>[] = [
    {
      key: 'category',
      label: 'Category',
      description:
        'Source ontology category attached to each code (the codes table `category` field), not the consolidation-step bucketing.',
      render: (r) => r.category,
      accessor: (r) => r.category,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'numCodes',
      label: '# Codes',
      description: 'Unique codes assigned to this source category.',
      render: (r) => r.numCodes,
      width: 100,
      align: 'center',
      accessor: (r) => r.numCodes,
      type: 'number',
      filterable: true,
    },
    {
      key: 'numMappedCodes',
      label: 'Mapped',
      description:
        'Codes in this category the mapping pipeline has stamped (mappedAt > 0), shown as mapped/total.',
      render: (r) => {
        const tone: ChipTone = r.numMappedCodes < r.numCodes ? 'amber' : 'none';
        return <QcChip value={`${r.numMappedCodes}/${r.numCodes}`} tone={tone} />;
      },
      width: 110,
      align: 'center',
      accessor: (r) => r.numMappedCodes,
      type: 'number',
      filterable: true,
    },
    {
      key: 'status',
      label: 'Status',
      description:
        'Not ready → some codes still unmapped. Ready for consolidation → all codes mapped, awaiting consolidation. Consolidated → at least one consolidated output article cites a code from this category.',
      render: (r) => {
        const status = deriveSourceStatus(r);
        if (status === 'consolidated') {
          return <Badge text="Consolidated" color="green" icon="check" />;
        }
        if (status === 'ready') {
          return <Badge text="Ready for consolidation" color="brand" />;
        }
        return <Badge text="Not ready" color="gray" />;
      },
      width: 220,
      align: 'left',
      accessor: (r) => {
        const status = deriveSourceStatus(r);
        return status === 'consolidated' ? 2 : status === 'ready' ? 1 : 0;
      },
      type: 'number',
      filterable: true,
      filterOptions: [
        { value: '0', label: 'Not ready' },
        { value: '1', label: 'Ready for consolidation' },
        { value: '2', label: 'Consolidated' },
      ],
    },
  ];
  return (
    <Stack space="m">
      <Text color="secondary">
        {rows.length} source-ontology categories from the codes table. Backup view — the
        consolidation buckets above are the primary surface.
      </Text>
      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(r, i) => `${r.category}-${i}`}
        emptyText="No source categories found."
        storageKey={`source-categories-table:${slug}`}
      />
    </Stack>
  );
}

function deriveSourceStatus(r: {
  isUncategorized: boolean;
  numMappedCodes: number;
  numCodes: number;
  hasConsolidatedOutput: boolean;
}): CategoryStatus {
  if (r.isUncategorized) return 'not-ready';
  const mapped = r.numMappedCodes >= r.numCodes;
  if (!mapped) return 'not-ready';
  return r.hasConsolidatedOutput ? 'consolidated' : 'ready';
}
