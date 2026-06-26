'use client';

import { Button, Inline, Tooltip } from '@amboss/design-system';
import { useCallback, useEffect, useState } from 'react';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import type { PipelineMode } from '@/lib/types';
import { CurriculumCategoryManagerButton } from './curriculum-category-manager-modal';
import { ImportCodesModal } from './import-codes-modal';
import { RemapModal } from './remap-modal';

/**
 * Right-hand action cluster for the Mapping tab's "Codes" view — sits inline
 * with the view selector. Holds the two bulk actions: "Import codes" (file
 * upload) and "Map by category" (kicks off mapping for unmapped codes).
 *
 * Owns its own lightweight summary fetch (unmapped count + consolidation
 * activity) so the buttons can enable/disable without threading state up from
 * the codes table. The button stays mounted at all times — it's disabled, never
 * hidden, so it doesn't pop in and out while the table's pages stream in.
 */
export function CodesActionsToolbar({
  slug,
  pipelineMode = 'full',
}: {
  slug: string;
  pipelineMode?: PipelineMode;
}) {
  const [supportReady, setSupportReady] = useState(false);
  const [unmappedCount, setUnmappedCount] = useState(0);
  // Bulk mapping only needs to pause during a full-specialty consolidation.
  const [runningAll, setRunningAll] = useState(false);
  // Whether a map/remap run is currently in flight — surfaces the "Cancel
  // mapping" control inside the Map-codes modal.
  const [mappingActive, setMappingActive] = useState(false);

  const [remapOpen, setRemapOpen] = useState(false);
  const [remapData, setRemapData] = useState<{
    categories: CodeCategorySummary[];
    unmappedCodes: UnmappedCodePickerRow[];
  } | null>(null);
  const [remapLoading, setRemapLoading] = useState(false);

  const refetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/codes/${encodeURIComponent(slug)}/summary`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        unmappedCount: number;
        inFlightCodes?: string[];
        activity: { runningAll: boolean; runningBuckets: string[] };
      };
      setUnmappedCount(data.unmappedCount);
      setRunningAll(data.activity.runningAll);
      setMappingActive((data.inFlightCodes?.length ?? 0) > 0);
      setSupportReady(true);
    } catch {
      /* buttons stay disabled until the next refetch */
    }
  }, [slug]);

  useEffect(() => {
    refetchSummary();
    const onFocus = () => refetchSummary();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchSummary]);

  const loadRemapData = useCallback(async () => {
    setRemapLoading(true);
    try {
      const res = await fetch(
        `/api/pipeline/${encodeURIComponent(slug)}/map-codes-form-data`,
      );
      if (res.ok) {
        const data = await res.json();
        setRemapData({
          categories: data.categories,
          unmappedCodes: data.unmappedCodes,
        });
      }
    } finally {
      setRemapLoading(false);
    }
  }, [slug]);

  const canRemap = supportReady && !runningAll && unmappedCount > 0;
  const lockedFromRemap = supportReady && runningAll && unmappedCount > 0;

  const remapButton = (
    <Button
      variant="secondary"
      size="m"
      disabled={!canRemap || remapLoading}
      onClick={async () => {
        // Refresh the in-flight signal so the modal's Cancel control reflects
        // a run that may have started since the last mount/focus fetch.
        void refetchSummary();
        await loadRemapData();
        setRemapOpen(true);
      }}
    >
      {remapLoading ? 'Loading…' : 'Map by category…'}
    </Button>
  );

  // Curriculum plans get the Category Manager instead of the stock Remap
  // modal: it surfaces approval + map/remap by category and is never greyed
  // out when everything is already mapped (remapping is the point).
  if (pipelineMode === 'curriculum-mapping') {
    return (
      <Inline space="s" vAlignItems="center" noWrap>
        <ImportCodesModal slug={slug} />
        <CurriculumCategoryManagerButton
          slug={slug}
          supportReady={supportReady}
          runningAll={runningAll}
          mappingActive={mappingActive}
          onClosed={refetchSummary}
        />
      </Inline>
    );
  }

  return (
    <Inline space="s" vAlignItems="center" noWrap>
      <ImportCodesModal slug={slug} />
      {lockedFromRemap ? (
        <Tooltip content="A full consolidation is running — bulk mapping resumes as soon as it finishes.">
          <span style={{ display: 'inline-flex' }}>{remapButton}</span>
        </Tooltip>
      ) : (
        remapButton
      )}
      <RemapModal
        key={`remap-${remapData?.categories.length ?? 0}`}
        open={remapOpen}
        onClose={() => {
          setRemapOpen(false);
          refetchSummary();
        }}
        specialtySlug={slug}
        categories={remapData?.categories ?? []}
        unmappedCodes={remapData?.unmappedCodes ?? []}
        unmappedCount={unmappedCount}
        mappingActive={mappingActive}
      />
    </Inline>
  );
}
