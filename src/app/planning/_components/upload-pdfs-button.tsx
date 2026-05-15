'use client';

/**
 * Per-row "Upload PDFs" button for the backlog table.
 *
 * Walks the article's source rows, downloads each PDF from `source.url`,
 * uploads to Gemini Files API, persists the returned URI back to PB so
 * the writing pipeline can attach them as `fileData` parts. Idempotent:
 * already-uploaded sources are skipped, so the editor can click again
 * to retry partial failures.
 *
 * Visible only on type='new' rows that have at least one source. Hidden
 * when every source is already uploaded.
 */

import { Badge, Button, Inline, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

type Props = {
  slug: string;
  articleRecordId: string;
  sourcesCount: number;
  uploadedSourcesCount: number;
};

type ApiResponse = {
  counts?: { uploaded: number; skipped: number; failed: number };
  outcomes?: Array<{ status: string; title: string; error?: string }>;
  error?: string;
};

export function UploadPdfsButton({
  slug,
  articleRecordId,
  sourcesCount,
  uploadedSourcesCount,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/upload-article-pdfs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug: slug, articleRecordId }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.counts && body.counts.failed > 0) {
        const firstFail = body.outcomes?.find((o) => o.status === 'failed');
        setError(
          `${body.counts.failed}/${sourcesCount} failed${firstFail?.error ? ` — ${firstFail.error}` : ''}`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, slug, articleRecordId, sourcesCount, router]);

  if (sourcesCount === 0) return null;

  const remaining = sourcesCount - uploadedSourcesCount;
  const allUploaded = remaining === 0;

  return (
    <Inline space="xxs" vAlignItems="center">
      {allUploaded ? (
        <Badge text={`PDFs ${uploadedSourcesCount}/${sourcesCount}`} color="green" />
      ) : (
        <Button variant="secondary" size="s" onClick={onClick} disabled={busy}>
          {busy ? 'Uploading…' : `Upload PDFs (${remaining})`}
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
