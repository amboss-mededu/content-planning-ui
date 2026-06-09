'use client';

import { Callout, Modal, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import { errorMessage } from '@/lib/error-message';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { missingApiKeyProvider } from '../[specialty]/pipeline/_components/missing-api-key';
import { MissingKeyModal } from '../[specialty]/pipeline/_components/missing-key-modal';
import {
  backupModelKey,
  DEFAULT_BACKUP_MODEL,
  readSpec,
  readSpecForStage,
} from '../[specialty]/pipeline/_components/model-selection-storage';
import {
  estimateScopeCount,
  MappingScopePicker,
  type MappingScopeValue,
} from './mapping-scope-picker';

function fmtNum(n: number): string {
  return new Intl.NumberFormat().format(n);
}

/**
 * "Map / Remap by category" modal, triggered from the codes-view toolbar.
 * The picker source is `listUnmappedCodesForPicker` — already-mapped rows
 * do not appear, so this is strictly an additive "map what's unmapped, in
 * whatever slice you pick" action. To force-remap mapped rows, reset the
 * map_codes stage from the pipeline page or use the per-row Remap button
 * in the code-detail modal.
 */
export function RemapModal({
  open,
  onClose,
  specialtySlug,
  categories,
  unmappedCodes,
  unmappedCount,
}: {
  open: boolean;
  onClose: () => void;
  specialtySlug: string;
  categories: CodeCategorySummary[];
  unmappedCodes: UnmappedCodePickerRow[];
  unmappedCount: number;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<MappingScopeValue>({
    mode: categories.length > 0 ? 'categories' : 'codes',
    selectedCats: categories.map((c) => c.category),
    specificCodes: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  if (!open) return null;

  const estimatedCount = estimateScopeCount(scope, categories, unmappedCount);
  const allSelected =
    scope.selectedCats.length === categories.length && categories.length > 0;
  const submitDisabled = submitting || estimatedCount === 0;

  const submit = async () => {
    setError(null);
    const primaryModel = readSpecForStage(specialtySlug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured for Map codes. Open the gear icon on the Map codes card to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(specialtySlug)) ?? DEFAULT_BACKUP_MODEL;
    setSubmitting(true);
    try {
      const categoriesPayload =
        scope.mode === 'categories' && !allSelected && scope.selectedCats.length > 0
          ? scope.selectedCats
          : undefined;
      const codesPayload =
        scope.mode === 'codes' && scope.specificCodes.length > 0
          ? scope.specificCodes
          : undefined;
      const res = await fetch('/api/workflows/map-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          checkAgainstLibrary: true,
          categories: categoriesPayload,
          codes: codesPayload,
          primaryModel,
          backupModel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = missingApiKeyProvider(res.status, body);
        if (missing) {
          setMissingKey(missing);
          return;
        }
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        header="Map codes"
        subHeader="Picks from currently unmapped codes. Use the pipeline page to reset and re-run mapping for already-mapped rows."
        size="m"
        isDismissible
        actionButton={{
          text: submitting ? 'Starting…' : `Start mapping (${fmtNum(estimatedCount)})`,
          onClick: submit,
          disabled: submitDisabled,
        }}
        secondaryButton={{
          text: 'Cancel',
          onClick: onClose,
        }}
      >
        <Modal.Stack>
          <Stack space="s">
            <Text>
              Concurrency = 10 · primary + backup models picked from the Map codes
              pipeline card.
            </Text>
            <MappingScopePicker
              categories={categories}
              unmappedCodes={unmappedCodes}
              unmappedCount={unmappedCount}
              value={scope}
              onChange={setScope}
            />
            {error ? <Callout type="error" text={error} /> : null}
          </Stack>
        </Modal.Stack>
      </Modal>
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </>
  );
}
