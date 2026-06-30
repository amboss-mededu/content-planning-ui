'use client';

import { Callout, Input, Modal, Select, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MappingSource, PipelineMode } from '@/lib/types';
import {
  COVERAGE_SOURCE_LABEL,
  coverageSourceHint,
  coverageSourceOptions,
  sourceIncludesRagDb,
} from './coverage-source-copy';

function autoSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

/** Register a new specialty. The pipeline mode is inherited from the dashboard
 *  subtab the modal was opened from (`pipelineMode` prop) — there's no Workflow
 *  picker here. The slug is derived from the name automatically and never shown.
 *  Posts to `/api/specialties`. */
export function AddSpecialtyModal({
  pipelineMode,
  open,
  onClose,
}: {
  pipelineMode: PipelineMode;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const isRagCorpus = pipelineMode === 'rag-corpus';
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [language, setLanguage] = useState('');
  // RAG corpus defaults to assessing against the RAG DB (guidelines track);
  // other modes default to AMBOSS.
  const [mappingSource, setMappingSource] = useState<MappingSource>(
    isRagCorpus ? 'guidelines' : 'amboss',
  );
  const [mcpEnv, setMcpEnv] = useState<'production' | 'staging'>('production');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const displayedSlug = autoSlug(name);
  const canSubmit = !submitting && name.trim().length > 0 && displayedSlug.length > 0;
  // The MCP environment only matters when the RAG DB is part of the source —
  // independent of pipeline mode, since the RAG DB backs the guidelines track
  // in every mode.
  const showMcpServer = sourceIncludesRagDb(mappingSource);

  const reset = () => {
    setName('');
    setRegion('');
    setLanguage('');
    setMappingSource(isRagCorpus ? 'guidelines' : 'amboss');
    setMcpEnv('production');
    setError(null);
    setSubmitting(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/specialties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: displayedSlug,
          name: name.trim(),
          source: 'manual',
          region: region || undefined,
          language: language || undefined,
          pipelineMode,
          mappingSource,
          // Only meaningful when the RAG DB is actually queried — don't persist
          // a stale staging value for an AMBOSS-content-only specialty.
          mcpEnv: showMcpServer ? mcpEnv : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Add failed (${res.status})`);
      }
      reset();
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add specialty.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Add specialty"
      subHeader="Only identity is needed here. Provide the PDF URLs when you start a code or milestone extraction run."
      size="m"
      isDismissible
      onAction={close}
      actionButton={{
        text: submitting ? 'Adding…' : 'Add specialty',
        onClick: submit,
        disabled: !canSubmit,
      }}
      secondaryButton={{
        text: 'Cancel',
        onClick: close,
      }}
    >
      <Modal.Stack>
        <Stack space="s">
          <Input
            name="specialty-name"
            label="Name"
            placeholder="Dermatology"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            name="specialty-region"
            label="Region"
            placeholder="Any"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={[
              { value: '', label: '—' },
              { value: 'us', label: 'US' },
              { value: 'de', label: 'DE' },
            ]}
          />
          <Input
            name="specialty-language"
            label="Language"
            placeholder="en"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <Select
            name="specialty-mappingSource"
            label={COVERAGE_SOURCE_LABEL}
            labelHint={coverageSourceHint({ locked: false })}
            value={mappingSource}
            onChange={(e) => setMappingSource(e.target.value as MappingSource)}
            options={coverageSourceOptions()}
          />
          {showMcpServer ? (
            <Select
              name="specialty-mcpEnv"
              label="MCP server"
              labelHint="Which AMBOSS MCP environment RAG corpus runs query."
              value={mcpEnv}
              onChange={(e) => setMcpEnv(e.target.value as 'production' | 'staging')}
              options={[
                { value: 'production', label: 'Production' },
                { value: 'staging', label: 'Staging' },
              ]}
            />
          ) : null}
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
