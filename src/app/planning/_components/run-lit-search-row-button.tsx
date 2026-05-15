'use client';

/**
 * Per-row "Search sources" trigger for the backlog table.
 *
 * Stage 1 of the article-generation pipeline. Calls the literature-search
 * endpoint scoped to a single article. Visible only on rows whose
 * status is in the lit-search-eligible bucket (waiting-for-sources,
 * unassigned, or no backlog row yet) — the parent column decides
 * whether to render it.
 *
 * Search runs fire-and-forget on the server; this button just kicks
 * off and refreshes. The backlog status flip
 * (`waiting-for-sources` → `sources-searched`) happens inside
 * runLiteratureSearch and shows up on the next refresh.
 */

import { Button, Inline, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

type Props = {
  slug: string;
  articleRecordId: string;
};

export function RunLitSearchRowButton({ slug, articleRecordId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
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
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, slug, articleRecordId, router]);

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
        {busy ? 'Searching…' : 'Search sources'}
      </Button>
      {error ? (
        <Text size="xs" color="error">
          {error}
        </Text>
      ) : null}
    </Inline>
  );
}
