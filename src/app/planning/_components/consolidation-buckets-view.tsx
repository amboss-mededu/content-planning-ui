'use client';

import { Badge, Notification, Stack, Text, Tooltip } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useState } from 'react';
import type {
  CategoryOrchestration,
  SourceCategoryProgress,
} from '@/lib/data/categories';
import { CategoryDetailsModal } from './category-details-modal';
import { ConsolidationProgressBadge } from './consolidation-progress-badge';
import { type Column, DataTable } from './data-table';
import { useConsolidationRerun } from './use-consolidation-rerun';
import {
  type PipelineRunSettlement,
  useRerunningCategories,
} from './use-rerunning-categories';

type ChipTone = 'amber' | 'red' | 'none';

type CategoryStatus = 'not-ready' | 'ready' | 'consolidated';

/**
 * Status progression per bucket:
 *
 *   not-ready    → some "included" codes still unmapped
 *   ready        → every included code mapped, no consolidated output yet
 *   consolidated → every included code mapped AND current consolidated
 *                  article/section output exists for this bucket
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

function nullableCount(value: number | null): ReactNode {
  return value === null ? '—' : value;
}

function staleTooltip(r: CategoryOrchestration): string {
  const changed = r.staleInputAt ? new Date(r.staleInputAt).toLocaleString() : 'recently';
  const ranAt = r.consolidatedAt
    ? new Date(r.consolidatedAt).toLocaleString()
    : 'an earlier run';
  return `A mapping input changed (${changed}) after this bucket was last consolidated (${ranAt}). Re-run the bucket to refresh its suggestions — existing approvals and sources for unchanged articles are kept.`;
}

function settlementErrorMessage(settlement: PipelineRunSettlement): string | null {
  if (settlement.status !== 'failed' && settlement.status !== 'cancelled') return null;
  const categories = settlement.categories.join(', ');
  const action = settlement.status === 'cancelled' ? 'cancelled' : 'failed';
  return `Consolidation ${action} for "${categories}": ${
    settlement.error ?? `run ${settlement.runId}`
  }`;
}

export function ConsolidationBucketsView({
  rows,
  slug,
}: {
  rows: CategoryOrchestration[];
  slug: string;
}) {
  const router = useRouter();
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const {
    rerun,
    isRunning: isLocalCategoryRunning,
    error: rerunError,
    dismissError: dismissRerunError,
    lastResult,
    dismissLastResult,
  } = useConsolidationRerun(slug);
  const [settledRunError, setSettledRunError] = useState<string | null>(null);
  const refreshOnSettled = useCallback(
    (settlement: PipelineRunSettlement) => {
      const message = settlementErrorMessage(settlement);
      if (message) setSettledRunError(message);
      router.refresh();
    },
    [router],
  );
  const rebuildingCategories = useRerunningCategories(slug, {
    onSettled: refreshOnSettled,
  });
  const consolidationError = rerunError ?? settledRunError;
  const dismissConsolidationError = useCallback(() => {
    dismissRerunError();
    setSettledRunError(null);
  }, [dismissRerunError]);
  const isCategoryRunning = useCallback(
    (category: string) =>
      isLocalCategoryRunning(category) || rebuildingCategories.has(category),
    [isLocalCategoryRunning, rebuildingCategories],
  );
  const openBucket =
    openCategory === null
      ? null
      : (rows.find((row) => row.consolidationCategory === openCategory) ?? null);

  const columns: Column<CategoryOrchestration>[] = [
    {
      key: 'consolidationCategory',
      label: 'Consolidation category',
      description:
        'Bucket the consolidation pipeline assigned codes to. Rows are derived from extracted codes — one row per unique consolidationCategory present in the codes table. The "(unbucketed)" row groups codes the pipeline never assigned a bucket to.',
      render: (r) => {
        const label = <span style={{ color: 'inherit' }}>{r.consolidationCategory}</span>;
        if (r.isUnbucketed) {
          return (
            <Tooltip content="Codes with no consolidationCategory — pipeline never bucketed them.">
              <QcChip value={label} tone="amber" />
            </Tooltip>
          );
        }
        if (r.hasConsolidatedOutput && !r.hasAnyStatusInfo) {
          return (
            <Tooltip content="Current output exists, but no code in this bucket is included, excluded, or ignored. Every code reports as orphan.">
              <QcChip value={label} tone="amber" />
            </Tooltip>
          );
        }
        return label;
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
        if (isCategoryRunning(r.consolidationCategory)) {
          return <ConsolidationProgressBadge />;
        }
        if (r.isStale) {
          return (
            <Tooltip content={staleTooltip(r)}>
              <span style={{ display: 'inline-flex' }}>
                <Badge text="Stale" color="yellow" icon="rotate-cw" />
              </span>
            </Tooltip>
          );
        }
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
        if (r.isStale) return 3;
        const status = deriveStatus(r);
        return status === 'consolidated' ? 2 : status === 'ready' ? 1 : 0;
      },
      type: 'number',
      filterable: true,
      filterOptions: [
        { value: '0', label: 'Not ready' },
        { value: '1', label: 'Ready for consolidation' },
        { value: '2', label: 'Consolidated' },
        { value: '3', label: 'Stale — re-run' },
      ],
      group: 'metadata',
    },
    {
      key: 'numIncludedCodes',
      label: '# Included',
      description:
        'Codes in this bucket the current consolidated article/section output cites. Shows — until current output exists.',
      render: (r) => {
        const tone: ChipTone =
          r.numIncludedCodes !== null && r.numIncludedCodes < r.numCodes
            ? 'amber'
            : 'none';
        return <QcChip value={nullableCount(r.numIncludedCodes)} tone={tone} />;
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
        'Codes in this bucket explicitly excluded by source decision arrays after current output exists. Shows — until current output exists.',
      render: (r) => nullableCount(r.numExcludedCodes),
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
        'Codes in this bucket ignored by source decision arrays after current output exists. Shows — until current output exists.',
      render: (r) => {
        const tone: ChipTone =
          r.numTotallyIgnoredCodes !== null && r.numTotallyIgnoredCodes > 0
            ? 'amber'
            : 'none';
        return <QcChip value={nullableCount(r.numTotallyIgnoredCodes)} tone={tone} />;
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
        'Codes in this bucket not accounted for by current output or explicit excluded/ignored decisions. Shows — until current output exists.',
      render: (r) => {
        const tone: ChipTone =
          r.numOrphanCodes !== null && r.numOrphanCodes > 0 ? 'red' : 'none';
        return <QcChip value={nullableCount(r.numOrphanCodes)} tone={tone} />;
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
      {consolidationError ? (
        <Notification
          type="error"
          text={consolidationError}
          isDismissable
          closeButtonAriaLabel="Dismiss consolidation error"
          onClickDismiss={dismissConsolidationError}
        />
      ) : null}
      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(r, i) => `${r.consolidationCategory}-${i}`}
        emptyText="No consolidation buckets found."
        storageKey={`categories-table:${slug}`}
        onRowClick={(r) => {
          if (r.isUnbucketed) return;
          setOpenCategory(r.consolidationCategory);
        }}
      />
      {openBucket && (
        <CategoryDetailsModal
          bucket={openBucket}
          slug={slug}
          rerun={rerun}
          isRerunning={isCategoryRunning(openBucket.consolidationCategory)}
          rerunError={consolidationError}
          onDismissRerunError={dismissConsolidationError}
          lastResult={lastResult}
          onDismissLastResult={dismissLastResult}
          onClose={() => setOpenCategory(null)}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Source-category table (backup view)
// ---------------------------------------------------------------------------

export function SourceCategoriesTable({
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
  ];
  return (
    <Stack space="m">
      <Text color="secondary">
        {rows.length} source-ontology categories from the codes table. Backup view — the
        Consolidation buckets view is the primary surface.
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
