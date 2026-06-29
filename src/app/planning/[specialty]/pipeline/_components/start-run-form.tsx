'use client';

import { Button, Callout, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PipelineMode } from '@/lib/types';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_IDENTIFY_SYSTEM_PROMPT,
} from '@/lib/workflows/lib/prompts';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { AddSourceModal } from './add-source-modal';
import { DefaultPromptModal } from './default-prompt-modal';
import { InputRow, type InputRowState, newInputRow } from './input-row';
import { missingApiKeyProvider } from './missing-api-key';
import { MissingKeyModal } from './missing-key-modal';
import { readSpecForStage } from './model-selection-storage';
import { PromptSection } from './prompt-section';

type Row = InputRowState;
const newRow = newInputRow;

export function StartRunForm({
  specialtySlug,
  sources,
  pipelineMode = 'full',
}: {
  specialtySlug: string;
  sources: CodeSource[];
  pipelineMode?: PipelineMode;
}) {
  const router = useRouter();
  const defaultSource = sources[0]?.slug ?? 'ab';
  // Curriculum runs drop the source prefix from the code id (see extract-codes).
  const isCurriculum = pipelineMode === 'curriculum-mapping';
  const [rows, setRows] = useState<Row[]>([newRow(defaultSource)]);
  const [identifyInstructions, setIdentifyInstructions] = useState('');
  const [extractInstructions, setExtractInstructions] = useState('');
  const [showIdentifyDefault, setShowIdentifyDefault] = useState(false);
  const [showExtractDefault, setShowExtractDefault] = useState(false);
  const [addSourceForRowId, setAddSourceForRowId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ runId: string; token: string } | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const addRow = () => setRows((prev) => [...prev, newRow(defaultSource)]);

  const anyUploading = rows.some((r) => r.uploading);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (sources.length === 0) {
      setError('Add at least one code source before starting a run.');
      return;
    }

    const inputs: Array<{ source: string; url: string }> = [];
    for (const [i, row] of rows.entries()) {
      if (row.kind === 'url') {
        const u = row.url.trim();
        if (!u.startsWith('http')) {
          setError(`Row ${i + 1}: enter a valid http(s) URL`);
          return;
        }
        inputs.push({ source: row.source, url: u });
      } else {
        if (!row.upload) {
          setError(`Row ${i + 1}: upload a PDF first`);
          return;
        }
        inputs.push({ source: row.source, url: row.upload.url });
      }
    }

    const model = readSpecForStage(specialtySlug, 'extract_codes');
    if (!model) {
      // Defaults are hard-coded for every stage in DEFAULT_MODELS, so this
      // only fires if the user's override resolved to an invalid catalog
      // entry and the default lookup also missed.
      setError('No model configured for Extract codes. Open the gear icon to pick one.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/workflows/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          inputs,
          identifyModulesInstructions: identifyInstructions.trim() || undefined,
          extractCodesInstructions: extractInstructions.trim() || undefined,
          model,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = missingApiKeyProvider(res.status, body);
        if (missing) {
          setMissingKey(missing);
          return;
        }
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess({ runId: body.runId, token: body.approvalToken });
      setRows([newRow(defaultSource)]);
      setIdentifyInstructions('');
      setExtractInstructions('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack space="m">
        <Stack space="xs">
          <Text weight="bold">Inputs</Text>
          <Text color="secondary">
            {isCurriculum ? (
              <>
                Each row is a curriculum outline to extract blocks from. Codes are
                numbered per specialty (e.g. <code>{specialtySlug}_0001</code>).
              </>
            ) : (
              <>
                Each row is a content outline to extract codes from. The source slug
                becomes the code prefix (e.g.{' '}
                <code>
                  {defaultSource}_{specialtySlug}_0001
                </code>
                ).
              </>
            )}
          </Text>
          {rows.map((row, idx) => (
            <InputRow
              key={row.id}
              row={row}
              index={idx}
              canRemove={rows.length > 1}
              sources={sources}
              onChange={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
              onRequestAddSource={() => setAddSourceForRowId(row.id)}
            />
          ))}
          <Inline space="s">
            <div style={{ width: 180 }}>
              <Button type="button" variant="secondary" fullWidth onClick={addRow}>
                + Add another input
              </Button>
            </div>
          </Inline>
        </Stack>

        <PromptSection
          title="Phase 1 — Identify modules"
          hint="Runs once per input. Splits the PDF/URL into chapters."
          value={identifyInstructions}
          onChange={setIdentifyInstructions}
          onViewDefault={() => setShowIdentifyDefault(true)}
        />
        <PromptSection
          title="Phase 2 — Extract codes"
          hint="Runs once per (input, module). Pulls discrete medical items."
          value={extractInstructions}
          onChange={setExtractInstructions}
          onViewDefault={() => setShowExtractDefault(true)}
        />

        <Inline space="s">
          <div style={{ width: 180 }}>
            <Button type="submit" fullWidth disabled={submitting || anyUploading}>
              {submitting ? 'Starting…' : 'Start extraction'}
            </Button>
          </div>
        </Inline>
        {error ? <Callout type="error" text={error} /> : null}
        {success ? (
          <Callout
            type="success"
            text={`Run started: ${success.runId} — approval token: ${success.token}`}
          />
        ) : null}
      </Stack>

      <DefaultPromptModal
        open={showIdentifyDefault}
        onClose={() => setShowIdentifyDefault(false)}
        title="Phase 1 default prompt — Identify modules"
        subHeader="Appended to any additional instructions you provide."
        text={DEFAULT_IDENTIFY_SYSTEM_PROMPT}
      />
      <DefaultPromptModal
        open={showExtractDefault}
        onClose={() => setShowExtractDefault(false)}
        title="Phase 2 default prompt — Extract codes"
        subHeader="Appended to any additional instructions you provide."
        text={DEFAULT_EXTRACT_SYSTEM_PROMPT}
      />
      <AddSourceModal
        open={addSourceForRowId !== null}
        onClose={() => setAddSourceForRowId(null)}
        onCreated={(source) => {
          if (addSourceForRowId) {
            updateRow(addSourceForRowId, { source: source.slug });
          }
          setAddSourceForRowId(null);
          // Refresh so the new source shows up in every row's dropdown (and
          // in the Code sources card below the dashboard).
          router.refresh();
        }}
      />
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </form>
  );
}
