'use client';

import { Button, Callout, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { DEFAULT_MILESTONES_SYSTEM_PROMPT } from '@/lib/workflows/lib/prompts';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { AddSourceModal } from './add-source-modal';
import { DefaultPromptModal } from './default-prompt-modal';
import { InputRow, type InputRowState, newInputRow } from './input-row';
import { MissingKeyModal } from './missing-key-modal';
import { readSpecForStage } from './model-selection-storage';
import { PromptSection } from './prompt-section';

export function StartMilestonesForm({
  specialtySlug,
  sources,
}: {
  specialtySlug: string;
  sources: CodeSource[];
}) {
  const router = useRouter();
  const defaultSource = sources[0]?.slug ?? 'acgme';
  const [rows, setRows] = useState<InputRowState[]>([newInputRow(defaultSource)]);
  const [instructions, setInstructions] = useState('');
  const [showDefault, setShowDefault] = useState(false);
  const [addSourceForRowId, setAddSourceForRowId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ runId: string; token: string } | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  const updateRow = (id: string, patch: Partial<InputRowState>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: string) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));
  };
  const addRow = () => setRows((prev) => [...prev, newInputRow(defaultSource)]);
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

    const model = readSpecForStage(specialtySlug, 'extract_milestones');
    if (!model) {
      setError(
        'No model configured for Extract milestones. Open the gear icon to pick one.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/workflows/extract-milestones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          inputs,
          milestonesInstructions: instructions.trim() || undefined,
          model,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (
          res.status === 409 &&
          body?.code === 'MISSING_API_KEY' &&
          (body.provider === 'google' ||
            body.provider === 'anthropic' ||
            body.provider === 'openai')
        ) {
          setMissingKey(body.provider);
          return;
        }
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess({ runId: body.runId, token: body.approvalToken });
      setRows([newInputRow(defaultSource)]);
      setInstructions('');
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
            Each row is a content outline to extract milestones from. One Gemini call
            synthesizes a single consolidated milestones document across all sources.
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
          title="Milestones — system prompt"
          hint="Single Gemini call across every input. Returns plain text."
          value={instructions}
          onChange={setInstructions}
          onViewDefault={() => setShowDefault(true)}
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
        open={showDefault}
        onClose={() => setShowDefault(false)}
        title="Milestones default prompt"
        subHeader="Appended to any additional instructions you provide."
        text={DEFAULT_MILESTONES_SYSTEM_PROMPT}
      />
      <AddSourceModal
        open={addSourceForRowId !== null}
        kind="milestone"
        onClose={() => setAddSourceForRowId(null)}
        onCreated={(source) => {
          if (addSourceForRowId) {
            updateRow(addSourceForRowId, { source: source.slug });
          }
          setAddSourceForRowId(null);
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
