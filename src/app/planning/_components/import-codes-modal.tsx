'use client';

import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Inline,
  Modal,
  Stack,
  Text,
  Tooltip,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';

/**
 * "Import codes" — upload an XLSX or CSV mapping file and merge/upsert it into
 * the `codes` table. Two-phase: a server-side preview (diff against existing
 * codes, per-source create/update counts, overwrite warning) then a commit of
 * the user-selected sources. Never deletes; matches only overwrite the
 * metadata columns the file carries, leaving mapping results untouched.
 *
 * Self-contained: fetches the consolidation-lock state to disable the trigger
 * (the route also re-checks and 409s), and refreshes the route on close so the
 * new/updated rows appear (the codes table's 5s poll converges too).
 */

type SourcePreview = {
  value: string;
  rowCount: number;
  createCount: number;
  updateCount: number;
  existsInRegistry: boolean;
};

type PreviewResponse = {
  totalRows: number;
  validRows: number;
  errors: Array<{ line: number; message: string }>;
  duplicateCodesInFile: string[];
  overwriteCount: number;
  sources: SourcePreview[];
};

type CommitResponse = {
  created: number;
  updated: number;
  skippedSources: string[];
  newSourcesRegistered: number;
};

type Step = 'pick' | 'preview' | 'result';

const ERROR_CAP = 20;

export function ImportCodesModal({ slug }: { slug: string }) {
  const router = useRouter();
  // Import rewrites many buckets at once, so it pauses while ANY consolidation
  // is actively running (mirrors the import route's gate).
  const [importBlocked, setImportBlocked] = useState(false);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/codes/${encodeURIComponent(slug)}/summary`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          activity: { runningAll: boolean; runningBuckets: string[] };
        };
        if (!cancelled) {
          setImportBlocked(
            data.activity.runningAll || data.activity.runningBuckets.length > 0,
          );
        }
      } catch {
        /* leave unlocked; the route still enforces the gate */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function reset() {
    setStep('pick');
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setResult(null);
    setError(null);
    setBusy(false);
  }

  function close() {
    setOpen(false);
    // Pick up created/updated rows. Defer reset so the modal doesn't flash
    // back to step 1 during the close animation.
    if (result) router.refresh();
    reset();
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = '';
    setFile(picked);
    setError(null);
  }

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('mode', 'preview');
      const res = await fetch(`/api/codes/${encodeURIComponent(slug)}/import`, {
        method: 'POST',
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = body as PreviewResponse;
      setPreview(data);
      // Default: every source that has rows is selected.
      setSelected(new Set(data.sources.map((s) => s.value)));
      setStep('preview');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('mode', 'commit');
      fd.append('sources', JSON.stringify([...selected]));
      const res = await fetch(`/api/codes/${encodeURIComponent(slug)}/import`, {
        method: 'POST',
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body as CommitResponse);
      setStep('result');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(value: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  }

  const selectedRowCount =
    preview?.sources
      .filter((s) => selected.has(s.value))
      .reduce((n, s) => n + s.rowCount, 0) ?? 0;

  const trigger = (
    <Button
      variant="secondary"
      size="m"
      disabled={importBlocked}
      onClick={() => {
        reset();
        setOpen(true);
      }}
    >
      Import codes…
    </Button>
  );

  return (
    <>
      {importBlocked ? (
        <Tooltip content="A consolidation is running — importing resumes once it finishes.">
          <span style={{ display: 'inline-flex' }}>{trigger}</span>
        </Tooltip>
      ) : (
        trigger
      )}

      {open ? (
        <Modal
          header="Import codes"
          subHeader="Upload an XLSX or CSV with the mapping metadata columns (source, code, description, category, consolidation category)."
          size="l"
          isDismissible
          onAction={(action) => {
            if (action === 'cancel') close();
          }}
          actionButton={primaryButton({
            step,
            busy,
            file,
            preview,
            selected,
            selectedRowCount,
            onPreview: runPreview,
            onCommit: runCommit,
            onClose: close,
          })}
          secondaryButton={
            step === 'result'
              ? undefined
              : { text: 'Cancel', onClick: close, disabled: busy }
          }
        >
          <Modal.Stack>
            {step === 'pick' ? (
              <Stack space="m">
                <Inline space="s" vAlignItems="center">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose file…
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={onFilePick}
                    style={{ display: 'none' }}
                  />
                  <Text color="secondary">{file ? file.name : 'No file selected.'}</Text>
                </Inline>
                {error ? <Callout type="error" text={error} /> : null}
              </Stack>
            ) : null}

            {step === 'preview' && preview ? (
              <PreviewStep
                preview={preview}
                selected={selected}
                onToggle={toggleSource}
                error={error}
              />
            ) : null}

            {step === 'result' && result ? (
              <Stack space="s">
                <Callout
                  type="success"
                  text={`Imported successfully — ${result.created} created, ${result.updated} updated.`}
                />
                {result.newSourcesRegistered > 0 ? (
                  <Text color="secondary">
                    Registered {result.newSourcesRegistered} new source
                    {result.newSourcesRegistered === 1 ? '' : 's'}.
                  </Text>
                ) : null}
                {result.skippedSources.length > 0 ? (
                  <Text color="secondary">
                    Skipped {result.skippedSources.length} unselected source
                    {result.skippedSources.length === 1 ? '' : 's'}.
                  </Text>
                ) : null}
              </Stack>
            ) : null}
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}

function PreviewStep({
  preview,
  selected,
  onToggle,
  error,
}: {
  preview: PreviewResponse;
  selected: Set<string>;
  onToggle: (value: string, checked: boolean) => void;
  error: string | null;
}) {
  const shownErrors = preview.errors.slice(0, ERROR_CAP);
  const extraErrors = preview.errors.length - shownErrors.length;

  return (
    <Stack space="m">
      <Text>
        {preview.validRows.toLocaleString()} valid row
        {preview.validRows === 1 ? '' : 's'} of {preview.totalRows.toLocaleString()}.
      </Text>

      {preview.errors.length > 0 ? (
        <Callout
          type="error"
          text={
            <span style={{ whiteSpace: 'pre-line' }}>
              {`${preview.errors.length} row(s) had problems and will be skipped:\n${shownErrors
                .map((e) => `• Line ${e.line}: ${e.message}`)
                .join('\n')}${extraErrors > 0 ? `\n• …and ${extraErrors} more` : ''}`}
            </span>
          }
        />
      ) : null}

      {preview.overwriteCount > 0 ? (
        <Callout
          type="warning"
          text={`${preview.overwriteCount.toLocaleString()} existing code${
            preview.overwriteCount === 1 ? '' : 's'
          } will have their source / description / category / consolidation category overwritten by this file. Mapping results (coverage, suggestions) are kept.`}
        />
      ) : null}

      {preview.duplicateCodesInFile.length > 0 ? (
        <Text size="s" color="secondary">
          {preview.duplicateCodesInFile.length} duplicate code
          {preview.duplicateCodesInFile.length === 1 ? '' : 's'} in the file — the last
          occurrence of each wins.
        </Text>
      ) : null}

      {preview.sources.length > 0 ? (
        <Stack space="s">
          <Text weight="bold">Sources to import</Text>
          {preview.sources.map((s) => (
            <Inline key={s.value} space="s" vAlignItems="center">
              <Checkbox
                label={s.value === '' ? '(no source)' : s.value}
                checked={selected.has(s.value)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onToggle(s.value, e.target.checked)
                }
              />
              {!s.existsInRegistry && s.value !== '' ? (
                <Badge text="new source" color="blue" />
              ) : null}
              <Text size="s" color="secondary">
                {s.createCount} new · {s.updateCount} update
                {s.updateCount === 1 ? '' : 's'}
              </Text>
            </Inline>
          ))}
        </Stack>
      ) : null}

      {error ? <Callout type="error" text={error} /> : null}
    </Stack>
  );
}

function primaryButton({
  step,
  busy,
  file,
  preview,
  selected,
  selectedRowCount,
  onPreview,
  onCommit,
  onClose,
}: {
  step: Step;
  busy: boolean;
  file: File | null;
  preview: PreviewResponse | null;
  selected: Set<string>;
  selectedRowCount: number;
  onPreview: () => void;
  onCommit: () => void;
  onClose: () => void;
}) {
  if (step === 'pick') {
    return {
      text: busy ? 'Reading…' : 'Preview',
      onClick: onPreview,
      disabled: busy || !file,
      loading: busy,
    };
  }
  if (step === 'preview') {
    return {
      text: busy ? 'Importing…' : `Import (${selectedRowCount.toLocaleString()})`,
      onClick: onCommit,
      disabled:
        busy ||
        selected.size === 0 ||
        selectedRowCount === 0 ||
        (preview?.validRows ?? 0) === 0,
      loading: busy,
    };
  }
  return { text: 'Done', onClick: onClose };
}
