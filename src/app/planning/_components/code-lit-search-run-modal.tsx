'use client';

/**
 * Approval modal for the RAG-corpus bulk "Run literature search" action.
 *
 * The user confirms scope before any n8n dispatch: by default only topics whose
 * coverage score is below adequate (< 3) are searched; a toggle widens it to all
 * mapped topics. Posts to /api/workflows/code-lit-search; the per-code corpus
 * lands asynchronously via the callback.
 */

import { Modal, SegmentedControl, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';

type Scope = 'below' | 'all';

export function CodeLitSearchRunModal({
  slug,
  belowThresholdCount,
  mappedCount,
  onClose,
}: {
  slug: string;
  /** Mapped topics with coverage score < 3 (the default scope). */
  belowThresholdCount: number;
  /** All mapped topics (the "all" scope). */
  mappedCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('below');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const targetCount = scope === 'below' ? belowThresholdCount : mappedCount;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/workflows/code-lit-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug: slug, includeAll: scope === 'all' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
        codes?: number;
        alreadyRunning?: number;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.skipped) {
        setResult(
          body.reason === 'already_running'
            ? 'All matching topics already have a search in progress.'
            : 'No eligible topics to search.',
        );
        router.refresh();
        return;
      }
      setResult(
        `Started literature search for ${body.codes ?? 0} topic(s)${
          body.alreadyRunning ? ` (${body.alreadyRunning} already running)` : ''
        }.`,
      );
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      header="Run literature search"
      subHeader="Build a reference corpus for the mapped topics via PubMed/guideline search."
      size="m"
      isDismissible
      actionButton={{
        text: result
          ? 'Done'
          : `Run for ${targetCount} topic${targetCount === 1 ? '' : 's'}`,
        disabled: busy || (!result && targetCount === 0),
        loading: busy,
      }}
      secondaryButton={{ text: result ? 'Close' : 'Cancel' }}
      onAction={(action) => {
        if (action === 'cancel') {
          onClose();
        } else if (result) {
          onClose();
        } else {
          void run();
        }
      }}
    >
      <Modal.Stack>
        <Stack space="l">
          <Stack space="xs">
            <Text weight="bold">Scope</Text>
            <SegmentedControl
              label="Literature search scope"
              isLabelHidden
              value={scope}
              onChange={(v) => setScope(v === 'all' ? 'all' : 'below')}
              options={[
                {
                  name: 'lit-scope',
                  value: 'below',
                  label: `Below adequate coverage (< 3) · ${belowThresholdCount}`,
                  disabled: busy,
                },
                {
                  name: 'lit-scope',
                  value: 'all',
                  label: `All mapped topics · ${mappedCount}`,
                  disabled: busy,
                },
              ]}
            />
            <Text size="s" color="secondary">
              {scope === 'below'
                ? 'Searches only topics where guideline coverage is weak — the gaps a corpus should fill.'
                : 'Searches every mapped topic, regardless of coverage score.'}
            </Text>
          </Stack>
          {error ? (
            <Text size="s" color="error">
              {error}
            </Text>
          ) : null}
          {result ? (
            <Text size="s" color="secondary">
              {result}
            </Text>
          ) : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
