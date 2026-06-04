'use client';

/**
 * "Draft article" trigger — opens a dialog that mirrors the n8n article-
 * creation form, then POSTs it as multipart/form-data to
 * /api/workflows/draft-article. Replaces the in-process StartWritingButton.
 *
 * Three visual states (same shape as StartWritingButton):
 *   1. Idle / terminal — a primary "Draft article" button (disabled when the
 *      row has 0 sources). A completed run also surfaces an "Open draft"
 *      link to the Google Drive doc.
 *   2. Running — a "Drafting" badge. n8n owns the job (no cancel endpoint),
 *      so there's nothing to abort; a stale row is reaped after the timeout.
 *
 * Live state comes from a 5-second poll against articleDraftRuns (via
 * router.refresh), paused for terminal states.
 */

import {
  Badge,
  Button,
  Callout,
  Inline,
  Input,
  Link,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArticleDraftRunRecord,
  ArticleDraftRunStatus,
  ArticleSourceRecord,
} from '@/lib/pb/types';

const STATUS_BADGE: Record<
  ArticleDraftRunStatus,
  { color: 'gray' | 'blue' | 'green'; label: string }
> = {
  running: { color: 'blue', label: 'Drafting' },
  completed: { color: 'green', label: 'Drafted' },
  failed: { color: 'gray', label: 'Failed' },
};

const LENGTH_OPTIONS = [
  'very short',
  'short',
  'medium',
  'long',
  'very long',
  'LLM Decides',
] as const;

const HANDLE_STORAGE_KEY = 'draft-article-handle';

/**
 * Build the priority-ordered, numbered ribosomId list the n8n form expects
 * (e.g. "1. 37656 2. 19121 3. 37655") from the article's approved sources.
 */
function buildFileMetadata(sources: ArticleSourceRecord[]): string {
  return sources
    .filter((s) => s.reviewStatus === 'approved' && s.ribosomId)
    .slice()
    .sort(
      (a, b) =>
        (a.priority ?? Number.POSITIVE_INFINITY) -
        (b.priority ?? Number.POSITIVE_INFINITY),
    )
    .map((s, i) => `${i + 1}. ${s.ribosomId}`)
    .join(' ');
}

type Props = {
  slug: string;
  articleRecordId: string;
  articleKey: string;
  articleTitle: string;
  sources: ArticleSourceRecord[];
  /** Disable the trigger if no sources are attached. */
  hasSources: boolean;
  viewerEmail?: string;
  initialRun?: ArticleDraftRunRecord | null;
  /** Trigger button size — 's' in the dense backlog table, 'm' in the modal. */
  size?: 's' | 'm';
};

export function DraftArticleButton({
  slug,
  articleRecordId,
  articleKey,
  articleTitle,
  sources,
  hasSources,
  viewerEmail,
  initialRun = null,
  size = 'm',
}: Props) {
  const router = useRouter();
  const [run, setRun] = useState<ArticleDraftRunRecord | null>(initialRun);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inFlight = run?.status === 'running';

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

  const onStarted = useCallback(() => {
    // Optimistic: stamp a local "running" row so the badge appears before the
    // first poll round trip.
    setRun({
      id: 'pending',
      status: 'running',
      specialtySlug: slug,
      articleKey,
      articleRecordId,
    } as unknown as ArticleDraftRunRecord);
    setDialogOpen(false);
    router.refresh();
  }, [slug, articleKey, articleRecordId, router]);

  if (inFlight) {
    return (
      <Inline space="xs" vAlignItems="center">
        <Badge text={STATUS_BADGE.running.label} color="blue" />
      </Inline>
    );
  }

  const completedUrl =
    run?.status === 'completed' && run.outputUrl ? run.outputUrl : null;

  return (
    <>
      <Inline space="xs" vAlignItems="center">
        {run ? (
          <Badge
            text={STATUS_BADGE[run.status].label}
            color={STATUS_BADGE[run.status].color}
          />
        ) : null}
        <Button
          variant="primary"
          size={size}
          disabled={!hasSources}
          onClick={(e) => {
            (e as React.MouseEvent).stopPropagation();
            setDialogOpen(true);
          }}
        >
          {run ? 'Re-draft' : 'Draft article'}
        </Button>
        {completedUrl ? (
          <Link
            href={completedUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
            color="accent"
            onClick={(e) => (e as React.MouseEvent).stopPropagation()}
          >
            Open draft
          </Link>
        ) : null}
        {!hasSources && !run ? (
          <Text size="xs" color="secondary">
            No sources
          </Text>
        ) : null}
      </Inline>
      {dialogOpen ? (
        <DraftArticleDialog
          slug={slug}
          articleRecordId={articleRecordId}
          articleKey={articleKey}
          articleTitle={articleTitle}
          defaultFileMetadata={buildFileMetadata(sources)}
          viewerEmail={viewerEmail}
          onClose={() => setDialogOpen(false)}
          onStarted={onStarted}
        />
      ) : null}
    </>
  );
}

function DraftArticleDialog({
  slug,
  articleRecordId,
  articleKey,
  articleTitle,
  defaultFileMetadata,
  viewerEmail,
  onClose,
  onStarted,
}: {
  slug: string;
  articleRecordId: string;
  articleKey: string;
  articleTitle: string;
  defaultFileMetadata: string;
  viewerEmail?: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [title, setTitle] = useState(articleTitle);
  const [language, setLanguage] = useState('en');
  const [articleLength, setArticleLength] = useState('LLM Decides');
  const [fileMetadata, setFileMetadata] = useState(defaultFileMetadata);
  const [handle, setHandle] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(HANDLE_STORAGE_KEY) ?? '';
  });
  const [gDriveFolderUrl, setGDriveFolderUrl] = useState('');
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submit = async () => {
    setError(null);
    const files = fileRef.current?.files;
    if (!title.trim()) return setError('Article title is required.');
    if (!language.trim()) return setError('Language is required.');
    if (!fileMetadata.trim()) return setError('RibosomID list is required.');
    if (!handle.trim()) return setError('User handle is required.');
    if (!files || files.length === 0) {
      return setError('Attach at least one source PDF (named <ribosomId>.pdf).');
    }

    setSubmitting(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(HANDLE_STORAGE_KEY, handle.trim());
      }
      const form = new FormData();
      form.set('specialtySlug', slug);
      form.set('articleRecordId', articleRecordId);
      form.set('articleKey', articleKey);
      form.set('articleTitle', title.trim());
      form.set('language', language.trim());
      form.set('articleLength', articleLength);
      form.set('fileMetadata', fileMetadata.trim());
      form.set('handle', handle.trim());
      form.set('gDriveFolderUrl', gDriveFolderUrl.trim());
      for (const file of Array.from(files)) form.append('files', file, file.name);

      const res = await fetch('/api/workflows/draft-article', {
        method: 'POST',
        body: form,
      });
      if (!res.ok && res.status !== 409) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start draft.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Draft article"
      subHeader="Sends the sources + parameters to the n8n article-creation workflow. The draft lands in Google Drive."
      size="m"
      isDismissible
      onAction={onClose}
      actionButton={{
        text: submitting ? 'Starting…' : 'Draft article',
        onClick: submit,
        disabled: submitting,
      }}
      secondaryButton={{ text: 'Cancel', onClick: onClose }}
    >
      <Modal.Stack>
        <Stack space="s">
          <Input
            label="Article title"
            name="draft-article-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            label="Language"
            name="draft-article-language"
            placeholder="e.g. en"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <Select
            name="draft-article-length"
            label="Article length"
            value={articleLength}
            options={LENGTH_OPTIONS.map((o) => ({ value: o, label: o }))}
            onChange={(e) => setArticleLength(e.target.value)}
          />
          <Textarea
            label="RibosomIDs ordered by priority"
            name="draft-article-file-metadata"
            hint="Prefilled from approved sources. Edit if the upload order differs."
            value={fileMetadata}
            resize="vertical"
            rows={3}
            onChange={(e) => setFileMetadata(e.target.value)}
          />
          <Stack space="xxs">
            <Text size="s">Source files</Text>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="application/pdf"
              onChange={(e) =>
                setFileNames(Array.from(e.target.files ?? []).map((f) => f.name))
              }
            />
            <Text size="xs" color="secondary">
              Name each PDF <code>&lt;ribosomId&gt;.pdf</code> to match the list above.
              {fileNames.length > 0 ? ` (${fileNames.length} selected)` : ''}
            </Text>
          </Stack>
          <Input
            label="User handle"
            name="draft-article-handle"
            placeholder="e.g. FKN"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <Input
            label="Output folder (optional)"
            name="draft-article-gdrive"
            placeholder="Google Drive folder URL — use to resume a failed run"
            value={gDriveFolderUrl}
            onChange={(e) => setGDriveFolderUrl(e.target.value)}
          />
          {viewerEmail ? (
            <Text size="xs" color="secondary">
              Triggered by {viewerEmail}
            </Text>
          ) : null}
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
