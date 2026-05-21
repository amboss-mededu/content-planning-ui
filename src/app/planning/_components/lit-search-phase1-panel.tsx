'use client';

import { Button, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArticleLitSearchRunRecord } from '@/lib/pb/types';
import { LitSearchProgressBadge } from './lit-search-progress-badge';
import { useLitSearchState } from './use-running-lit-search-articles';

// Local optimistic flag falls off after this many ms even if no `end`
// event lands — protects against worker death so the button doesn't
// stay disabled forever. Sized at 90s: the slowest happy-path lit-search
// run we've observed (~60s with reasoning headroom).
const OPTIMISTIC_TIMEOUT_MS = 90_000;

type Props = {
  slug: string;
  articleKey: string;
  articleRecordId: string;
  copy: string;
  initialRuns?: ArticleLitSearchRunRecord[];
  /** Fired right after the POST goes out. Parent uses this as a polling
   *  pulse so the surrounding views refresh while PB realtime is dead
   *  for anonymous browser clients. */
  onTriggered?: () => void;
};

export function LitSearchPhase1Panel({
  slug,
  articleKey,
  articleRecordId,
  copy,
  initialRuns = [],
  onTriggered,
}: Props) {
  const router = useRouter();
  const litState = useLitSearchState(initialRuns, {
    filter: `specialtySlug = "${slug}" && articleKey = "${articleKey}"`,
  });
  const liveInFlight = litState.inFlight.has(articleKey);
  const liveError = litState.errors.get(articleKey) ?? null;
  const [optimisticBusy, setOptimisticBusy] = useState(false);
  const [clickError, setClickError] = useState<string | null>(null);
  const previousRunning = useRef(false);

  const isRunning = optimisticBusy || liveInFlight;
  // Click-level errors (POST refused) take precedence — they're the most
  // recent. Otherwise show the latest backend failure for this article.
  // Suppress while running so we don't show a stale red banner under the
  // animated badge.
  const error = isRunning ? null : (clickError ?? liveError);

  // When the worker emits the `end` event, the live signal flips off.
  // Refresh the SSR-rendered chrome (status badge in the header, etc.)
  // and clear any stale error from a prior click.
  useEffect(() => {
    if (optimisticBusy && liveInFlight) {
      // Live signal caught up — drop the optimistic flag so future
      // state transitions are driven by realtime alone.
      setOptimisticBusy(false);
    }
  }, [optimisticBusy, liveInFlight]);

  useEffect(() => {
    if (previousRunning.current && !isRunning) {
      router.refresh();
    }
    previousRunning.current = isRunning;
  }, [isRunning, router]);

  useEffect(() => {
    if (!optimisticBusy) return;
    const id = window.setTimeout(() => {
      setOptimisticBusy(false);
    }, OPTIMISTIC_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [optimisticBusy]);

  const onClick = useCallback(async () => {
    if (isRunning) return;
    setOptimisticBusy(true);
    setClickError(null);
    onTriggered?.();
    try {
      const res = await fetch('/api/workflows/literature-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug: slug,
          articleRecordIds: [articleRecordId],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
      };
      if (!res.ok) {
        setClickError(body.error ?? `HTTP ${res.status}`);
        setOptimisticBusy(false);
        return;
      }
      if (body.skipped) {
        setClickError(
          body.reason === 'already_running'
            ? 'Search already in progress'
            : 'Already searched or not eligible',
        );
        setOptimisticBusy(false);
        return;
      }
    } catch (e) {
      setClickError(e instanceof Error ? e.message : String(e));
      setOptimisticBusy(false);
    }
  }, [isRunning, slug, articleRecordId, onTriggered]);

  return (
    <Stack space="m">
      <Text color="secondary">{copy}</Text>
      {isRunning ? (
        <Inline space="s" vAlignItems="center">
          <LitSearchProgressBadge />
        </Inline>
      ) : (
        <Stack space="xs">
          <Inline space="xxs" vAlignItems="center">
            <Button variant="secondary" size="s" onClick={() => void onClick()}>
              {error ? 'Try again' : 'Search sources'}
            </Button>
          </Inline>
          {error ? (
            <Text size="s" color="error">
              Last run failed: {error}
            </Text>
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}
