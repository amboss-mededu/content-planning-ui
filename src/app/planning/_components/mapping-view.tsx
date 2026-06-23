'use client';

import { Badge, Inline, SegmentedControl, Stack } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type {
  CategoryOrchestration,
  SourceCategoryProgress,
} from '@/lib/data/categories';
import type { CodeTableRow } from '@/lib/data/codes';
import type { CodeLitSearchRunRecord } from '@/lib/pb/types';
import type { MappingSource, PipelineMode } from '@/lib/types';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { StartCodesModal } from '../[specialty]/pipeline/_components/start-codes-modal';
import { CodesActionsToolbar } from './codes-actions-toolbar';
import { CodesViewClient } from './codes-view-client';
import {
  ConsolidationBucketsView,
  SourceCategoriesTable,
} from './consolidation-buckets-view';
import { useInFlightCodes } from './use-in-flight-codes';
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

const EMPTY_IN_FLIGHT: string[] = [];

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
  pipelineMode = 'full',
  initialLitSearchRuns,
  initialInFlightCodes,
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
  /** The specialty's workflow mode — `'rag-corpus'` adds the Literature column. */
  pipelineMode?: PipelineMode;
  /** Initial per-code literature-search runs (rag-corpus), for live progress. */
  initialLitSearchRuns?: CodeLitSearchRunRecord[];
  /** Server snapshot of in-flight codes — seeds the in-flight poll so an
   *  already-running map/remap shows its badge on first paint. */
  initialInFlightCodes?: string[];
}) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<MappingMode>(() => {
    const seeded = initialMode(searchParams?.get('view') ?? null);
    // Never land on the consolidation view for a mapping-only specialty.
    return mappingOnly && seeded === 'consolidation' ? 'codes' : seeded;
  });
  // Live in-flight codes for the whole tab. Polled (not a PB realtime
  // subscription — the browser client is anonymous and gets no events), seeded
  // from the server snapshot. Shared with the codes table below so there's a
  // single source of truth — and a page-level "Mapping…" badge.
  const inFlightCodes = useInFlightCodes(slug, initialInFlightCodes ?? EMPTY_IN_FLIGHT);
  const mappingActive = inFlightCodes.length > 0;
  // One refresh loop for the whole tab — keeps every view live while an
  // extraction OR a map/remap is in flight, without each sub-view polling
  // independently. Mapping runs write results code-by-code, so refreshing on
  // the 2s cadence surfaces them far faster than the table's 5s reconcile poll.
  useRefreshWhileRunning((extractionState?.running ?? false) || mappingActive);

  return (
    <Stack space="m">
      <Inline alignItems="spaceBetween" vAlignItems="center" fullWidth>
        <Inline vAlignItems="center" space="s">
          <SegmentedControl
            label="Mapping view"
            isLabelHidden
            value={mode}
            onChange={(v) =>
              setMode(v === 'consolidation' || v === 'source' ? v : 'codes')
            }
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
          {/* Active map/remap indicator — count ticks down live as codes
              finish, then the badge clears when the run completes. */}
          {mappingActive ? (
            <Badge
              color="blue"
              icon="loader"
              text={
                inFlightCodes.length === 1
                  ? 'Mapping 1 code'
                  : `Mapping ${inFlightCodes.length} codes`
              }
              data-e2e-test-id="mapping-active-badge"
            />
          ) : null}
        </Inline>
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
          pipelineMode={pipelineMode}
          initialLitSearchRuns={initialLitSearchRuns}
          inFlightCodes={inFlightCodes}
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
