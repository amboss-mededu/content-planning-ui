'use client';

/**
 * Per-row "Search literature" trigger for the RAG-corpus mapping sheet. Calls
 * the code-level literature-search endpoint scoped to a single code, regardless
 * of its coverage score (an explicit row action overrides the < 3 default).
 *
 * Search runs on n8n; this button dispatches and refreshes. The corpus + status
 * land via the callback. Re-running a code that already has a corpus replaces it.
 */

import { Button, Inline, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { errorMessage } from '@/lib/error-message';

export function RunCodeLitSearchRowButton({
  slug,
  codeId,
  label = 'Search',
  error: externalError,
}: {
  slug: string;
  codeId: string;
  label?: string;
  /** Last-run error from the live snapshot, shown alongside the retry button. */
  error?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (busy || !codeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/code-lit-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug: slug, codeIds: [codeId] }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.skipped) {
        setError(
          body.reason === 'already_running'
            ? 'Search already in progress'
            : 'Not eligible',
        );
        return;
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy, slug, codeId, router]);

  const shownError = error ?? externalError ?? null;

  return (
    <Inline space="xxs" vAlignItems="center">
      <Button
        variant="secondary"
        size="s"
        onClick={(e) => {
          (e as React.MouseEvent).stopPropagation();
          void onClick();
        }}
        disabled={busy}
      >
        {busy ? 'Searching…' : label}
      </Button>
      {shownError ? (
        <Text size="xs" color="error">
          {shownError}
        </Text>
      ) : null}
    </Inline>
  );
}
