'use client';

import { Button, Inline, Tooltip } from '@amboss/design-system';
import { useCallback, useEffect, useState } from 'react';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import { ImportCodesModal } from './import-codes-modal';
import { RemapModal } from './remap-modal';

/**
 * Right-hand action cluster for the Mapping tab's "Codes" view — sits inline
 * with the view selector. Holds the two bulk actions: "Import codes" (file
 * upload) and "Map by category" (kicks off mapping for unmapped codes).
 *
 * Owns its own lightweight summary fetch (unmapped count + consolidation lock)
 * so the buttons can enable/disable without threading state up from the codes
 * table. The button stays mounted at all times — it's disabled, never hidden,
 * so it doesn't pop in and out while the table's pages stream in.
 */
export function CodesActionsToolbar({ slug }: { slug: string }) {
  const [supportReady, setSupportReady] = useState(false);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockStatus, setLockStatus] = useState<string | null>(null);

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
        lock: { locked: boolean; status: string | null };
      };
      setUnmappedCount(data.unmappedCount);
      setLocked(data.lock.locked);
      setLockStatus(data.lock.status);
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

  const canRemap = supportReady && !locked && unmappedCount > 0;
  const lockedFromRemap = supportReady && locked && unmappedCount > 0;

  const remapButton = (
    <Button
      variant="secondary"
      size="m"
      disabled={!canRemap || remapLoading}
      onClick={async () => {
        await loadRemapData();
        setRemapOpen(true);
      }}
    >
      {remapLoading ? 'Loading…' : 'Map by category…'}
    </Button>
  );

  return (
    <Inline space="s" vAlignItems="center" noWrap>
      <ImportCodesModal slug={slug} />
      {lockedFromRemap ? (
        <Tooltip
          content={`Consolidation has already been run${lockStatus ? ` (${lockStatus})` : ''} — reset the consolidation stage to re-enable bulk mapping.`}
        >
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
      />
    </Inline>
  );
}
