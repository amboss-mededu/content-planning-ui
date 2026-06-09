'use client';

/**
 * Sticky toolbar that floats above the backlog table when ≥1 row is
 * selected. Each pipeline-stage button reports the count of selected
 * rows currently eligible for that stage; the button is disabled when
 * that count is zero (so editors get explicit feedback rather than
 * silently no-oping on rows in the wrong status).
 *
 * Eligibility:
 *   - Lit search: backlog status ∈ {undefined, unassigned, waiting-for-sources}
 *   - Cortex   : backlog status = sources-approved
 *   - Draft    : backlog status = ready-for-llm-draft
 *
 * Buttons fire the same endpoints the per-row + pipeline-page surfaces
 * use; results bubble back through `router.refresh()` and the page-loader
 * recomputes statuses.
 */

import { Badge, Button, Callout, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import type { ArticleBacklogStatus } from '@/lib/pb/types';
import { readSpecForStage } from '../[specialty]/pipeline/_components/model-selection-storage';

type Eligibility = {
  litSearchIds: string[];
  cortexIds: string[];
  draftIds: string[];
};

export function computeEligibility(
  selected: string[],
  statusById: Record<string, ArticleBacklogStatus | undefined>,
): Eligibility {
  const litSearchIds: string[] = [];
  const cortexIds: string[] = [];
  const draftIds: string[] = [];
  for (const id of selected) {
    const s = statusById[id];
    if (s === undefined || s === 'unassigned' || s === 'waiting-for-sources') {
      litSearchIds.push(id);
    } else if (s === 'sources-approved') {
      cortexIds.push(id);
    } else if (s === 'ready-for-llm-draft') {
      draftIds.push(id);
    }
  }
  return { litSearchIds, cortexIds, draftIds };
}

export function BacklogBulkToolbar({
  slug,
  selectedIds,
  statusById,
  onClear,
}: {
  slug: string;
  selectedIds: string[];
  statusById: Record<string, ArticleBacklogStatus | undefined>;
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'lit' | 'cortex' | 'draft'>(null);
  const [error, setError] = useState<string | null>(null);

  const elig = computeEligibility(selectedIds, statusById);

  async function post(
    action: 'lit' | 'cortex' | 'draft',
    url: string,
    body: Record<string, unknown>,
  ) {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const onLitSearch = () =>
    post('lit', '/api/workflows/literature-search', {
      specialtySlug: slug,
      articleRecordIds: elig.litSearchIds,
    });

  const onCortex = () =>
    post('cortex', '/api/workflows/cortex-register', {
      specialtySlug: slug,
      articleRecordIds: elig.cortexIds,
    });

  const onDraft = () => {
    const model = readSpecForStage(slug, 'write_article');
    if (!model) {
      setError('No model configured for write_article stage.');
      return;
    }
    return post('draft', '/api/workflows/write-article', {
      specialtySlug: slug,
      articleRecordIds: elig.draftIds,
      model,
    });
  };

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 4,
        background: 'white',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
      }}
    >
      <Stack space="xs">
        <Inline space="s" vAlignItems="center">
          <Badge text={`${selectedIds.length} selected`} color="brand" />
          <Button
            variant="secondary"
            size="s"
            onClick={onLitSearch}
            disabled={busy !== null || elig.litSearchIds.length === 0}
          >
            {busy === 'lit'
              ? 'Searching…'
              : `Run lit search (${elig.litSearchIds.length})`}
          </Button>
          <Button
            variant="secondary"
            size="s"
            onClick={onCortex}
            disabled={busy !== null || elig.cortexIds.length === 0}
          >
            {busy === 'cortex'
              ? 'Registering…'
              : `Register in Cortex (${elig.cortexIds.length})`}
          </Button>
          <Button
            variant="secondary"
            size="s"
            onClick={onDraft}
            disabled={busy !== null || elig.draftIds.length === 0}
          >
            {busy === 'draft' ? 'Enqueueing…' : `Draft ${elig.draftIds.length} articles`}
          </Button>
          <Button variant="tertiary" size="s" onClick={onClear} disabled={busy !== null}>
            Clear
          </Button>
          <Text size="xs" color="secondary">
            Action counts reflect selected rows whose status matches the stage's gate.
          </Text>
        </Inline>
        {error ? <Callout type="error" text={error} /> : null}
      </Stack>
    </div>
  );
}
