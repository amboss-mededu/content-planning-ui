'use client';

/**
 * Per-row "Register in Cortex" trigger.
 *
 * Stage 2 of the article-generation pipeline. POSTs each source's
 * metadata to Cortex CMS and persists the returned `cortexSourceId`
 * on the row. PDFs are NOT uploaded — only metadata. Idempotent:
 * already-registered sources are skipped.
 *
 * Visible only on type='new' rows. Hidden when there are no sources.
 * When every source is registered, the button collapses into a green
 * "Cortex N/N" badge.
 */

import { Badge, Button, Inline, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { errorMessage } from '@/lib/error-message';

type Props = {
  slug: string;
  articleRecordId: string;
  sourcesCount: number;
  registeredSourcesCount: number;
};

type ApiResponse = {
  totals?: { registered: number; reused: number; failed: number };
  results?: Array<{
    ok: boolean;
    error?: string;
    counts?: { registered: number; reused: number; failed: number };
    outcomes?: Array<{ status: string; title: string; error?: string }>;
  }>;
  error?: string;
};

export function RegisterCortexButton({
  slug,
  articleRecordId,
  sourcesCount,
  registeredSourcesCount,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/cortex-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug: slug, articleRecordId }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const failures = body.totals?.failed ?? 0;
      if (failures > 0) {
        const firstFail = body.results?.[0]?.outcomes?.find((o) => o.status === 'failed');
        setError(`${failures} failed${firstFail?.error ? ` — ${firstFail.error}` : ''}`);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy, slug, articleRecordId, router]);

  if (sourcesCount === 0) return null;

  const remaining = sourcesCount - registeredSourcesCount;
  const allRegistered = remaining === 0;

  return (
    <Inline space="xxs" vAlignItems="center">
      {allRegistered ? (
        <Badge text={`Cortex ${registeredSourcesCount}/${sourcesCount}`} color="green" />
      ) : (
        <Button variant="secondary" size="s" onClick={onClick} disabled={busy}>
          {busy ? 'Registering…' : `Register in Cortex (${remaining})`}
        </Button>
      )}
      {error ? (
        <Text size="xs" color="error">
          {error}
        </Text>
      ) : null}
    </Inline>
  );
}
