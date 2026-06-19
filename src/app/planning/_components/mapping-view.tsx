'use client';

import { Inline, SegmentedControl, Stack } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type {
  CategoryOrchestration,
  SourceCategoryProgress,
} from '@/lib/data/categories';
import type { CodeTableRow } from '@/lib/data/codes';
import type { MappingSource } from '@/lib/types';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { StartCodesModal } from '../[specialty]/pipeline/_components/start-codes-modal';
import { CodesActionsToolbar } from './codes-actions-toolbar';
import { CodesViewClient } from './codes-view-client';
import {
  ConsolidationBucketsView,
  SourceCategoriesTable,
} from './consolidation-buckets-view';
import { useRefreshWhileRunning } from './use-refresh-while-running';

/**
 * The "Mapping" tab — a single home for every codes/mapping surface. One
 * SegmentedControl flips between three views over the same extracted codes:
 *
 *   codes         → the per-code mapping table (the default landing view)
 *   consolidation → the consolidation-bucket orchestration table
 *   source        → the raw source-ontology category breakdown
 *
 * Replaces the old separate "Categories" + "Mapping" tabs. The initial view
 * can be seeded via `?view=consolidation|source` (used by the Overview cards);
 * anything else falls back to "codes".
 */
type MappingMode = 'codes' | 'consolidation' | 'source';

function initialMode(view: string | null): MappingMode {
  return view === 'consolidation' || view === 'source' ? view : 'codes';
}

export function MappingView({
  slug,
  initialCodes,
  initialHasMore,
  rows,
  sourceRows,
  codeSources,
  codeCount,
  extractionState,
  mappingOnly = false,
  mappingSource = 'amboss',
}: {
  slug: string;
  initialCodes: CodeTableRow[];
  initialHasMore: boolean;
  rows: CategoryOrchestration[];
  sourceRows: SourceCategoryProgress[];
  codeSources?: CodeSource[];
  codeCount?: number;
  extractionState?: {
    running: boolean;
    completed: boolean;
    runId: string | null;
    hasDownstream: boolean;
  };
  /** Mapping-only specialties have no consolidation, so the consolidation
   *  bucket view and the suggestion columns are dropped. */
  mappingOnly?: boolean;
  /** Which content source(s) this specialty maps against — drives the codes
   *  table coverage columns. */
  mappingSource?: MappingSource;
}) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<MappingMode>(() => {
    const seeded = initialMode(searchParams?.get('view') ?? null);
    // Never land on the consolidation view for a mapping-only specialty.
    return mappingOnly && seeded === 'consolidation' ? 'codes' : seeded;
  });
  // One refresh loop for the whole tab — keeps every view live while an
  // extraction is in flight without each sub-view polling independently.
  useRefreshWhileRunning(extractionState?.running ?? false);

  return (
    <Stack space="m">
      <Inline alignItems="spaceBetween" vAlignItems="center" fullWidth>
        <SegmentedControl
          label="Mapping view"
          isLabelHidden
          value={mode}
          onChange={(v) => setMode(v === 'consolidation' || v === 'source' ? v : 'codes')}
          options={[
            { name: 'mapping-view', value: 'codes', label: 'Codes' },
            ...(mappingOnly
              ? []
              : [
                  {
                    name: 'mapping-view',
                    value: 'consolidation',
                    label: 'Consolidation buckets',
                  },
                ]),
            { name: 'mapping-view', value: 'source', label: 'Source categories' },
          ]}
        />
        {/* Bulk code actions live inline with the view selector, clustered on
            the right. Only relevant to the Codes view. */}
        {mode === 'codes' ? <CodesActionsToolbar slug={slug} /> : null}
      </Inline>
      {/* Codes stays mounted across switches so its progressive pagination
          and live-collection polling survive a detour to the other views. The
          category tables are cheap and stateless, so they mount on demand. */}
      <div hidden={mode !== 'codes'}>
        <CodesViewClient
          slug={slug}
          initialCodes={initialCodes}
          initialHasMore={initialHasMore}
          mappingOnly={mappingOnly}
          mappingSource={mappingSource}
        />
      </div>
      {mode === 'consolidation' && !mappingOnly ? (
        <ConsolidationBucketsView rows={rows} slug={slug} />
      ) : null}
      {mode === 'source' ? <SourceCategoriesTable rows={sourceRows} slug={slug} /> : null}
      {codeCount === 0 && codeSources ? (
        <StartCodesModal
          specialtySlug={slug}
          sources={codeSources}
          running={extractionState?.running ?? false}
          completed={extractionState?.completed ?? false}
          hasDownstream={extractionState?.hasDownstream ?? false}
          runId={extractionState?.runId ?? null}
        />
      ) : null}
    </Stack>
  );
}
