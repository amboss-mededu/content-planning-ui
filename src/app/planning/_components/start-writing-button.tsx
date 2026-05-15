'use client';

/**
 * Per-row "Start LLM draft" trigger for the backlog table.
 *
 * Three visual states:
 *   1. Idle / no run yet — button "Start LLM draft" (disabled when the
 *      row has 0 sources).
 *   2. Running — badge showing the current pass + a Cancel button.
 *   3. Completed / failed — badge with the terminal state and a "Re-run"
 *      button.
 *
 * Live state comes from a 5-second poll against the writingRuns
 * collection (cheap; one round trip per backlog page load). The
 * polling is paused for terminal states, so idle rows don't tick.
 */

import { Badge, Button, Inline, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArticleWritingRunRecord,
  ArticleWritingRunStatus,
  WritingPassName,
} from '@/lib/pb/types';
import { readSpecForStage } from '../[specialty]/pipeline/_components/model-selection-storage';

const PASS_LABEL: Record<WritingPassName, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  proofreader: 'Proofread',
  style: 'Style',
  html: 'HTML',
  copy: 'Copy',
};

const STATUS_BADGE: Record<
  ArticleWritingRunStatus,
  { color: 'gray' | 'yellow' | 'blue' | 'purple' | 'brand' | 'green'; label: string }
> = {
  queued: { color: 'yellow', label: 'Queued' },
  running: { color: 'blue', label: 'Drafting' },
  completed: { color: 'green', label: 'Drafted' },
  failed: { color: 'gray', label: 'Failed' },
  cancelled: { color: 'gray', label: 'Cancelled' },
};

type Props = {
  slug: string;
  articleRecordId: string;
  /** Disable the trigger if no sources are attached. */
  hasSources: boolean;
  initialRun?: ArticleWritingRunRecord | null;
};

export function StartWritingButton({
  slug,
  articleRecordId,
  hasSources,
  initialRun = null,
}: Props) {
  const router = useRouter();
  const [run, setRun] = useState<ArticleWritingRunRecord | null>(initialRun);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll while the run is non-terminal. We don't have a /api/runs/:id
  // GET endpoint yet so the poll just bumps router.refresh() to re-run
  // the page's server loader. Cheap on a long-lived Node server.
  const inFlight = run?.status === 'queued' || run?.status === 'running';

  useEffect(() => {
    if (!inFlight) return;
    const tick = () => {
      router.refresh();
      pollRef.current = setTimeout(tick, 5000);
    };
    pollRef.current = setTimeout(tick, 5000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [inFlight, router]);

  useEffect(() => {
    setRun(initialRun);
  }, [initialRun]);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const model = readSpecForStage(slug, 'write_article');
      const res = await fetch('/api/workflows/write-article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug: slug,
          articleRecordId,
          model,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Optimistic: stamp a local "queued" state so the badge appears
      // before the first poll round trip.
      setRun({
        id: 'pending',
        runId: 'pending',
        specialtySlug: slug,
        articleRecordId,
        status: 'queued',
      } as unknown as ArticleWritingRunRecord);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start');
    } finally {
      setBusy(false);
    }
  }, [slug, articleRecordId, router]);

  const cancel = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/cancel-write-article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: run.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }, [run, router]);

  if (
    !run ||
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  ) {
    return (
      <Inline space="xs" vAlignItems="center">
        {run ? (
          <Badge
            text={STATUS_BADGE[run.status].label}
            color={STATUS_BADGE[run.status].color}
          />
        ) : null}
        <Button
          variant="tertiary"
          size="s"
          disabled={!hasSources || busy}
          onClick={(e) => {
            (e as React.MouseEvent).stopPropagation();
            void start();
          }}
        >
          {run ? 'Re-run' : 'Start LLM draft'}
        </Button>
        {!hasSources && !run ? (
          <Text size="xs" color="secondary">
            No sources
          </Text>
        ) : null}
        {error ? (
          <Text size="xs" color="error">
            {error}
          </Text>
        ) : null}
      </Inline>
    );
  }

  const currentLabel = run.currentPass ? PASS_LABEL[run.currentPass] : '…';
  return (
    <Inline space="xs" vAlignItems="center">
      <Badge text={`${STATUS_BADGE[run.status].label} · ${currentLabel}`} color="blue" />
      <Button
        variant="tertiary"
        size="s"
        disabled={busy}
        onClick={(e) => {
          (e as React.MouseEvent).stopPropagation();
          void cancel();
        }}
      >
        Cancel
      </Button>
      {error ? (
        <Text size="xs" color="error">
          {error}
        </Text>
      ) : null}
    </Inline>
  );
}
