'use client';

import { Callout, Input, Modal, Select, Stack } from '@amboss/design-system';
import { useState } from 'react';
import { addCodeLitSource } from '@/app/planning/[specialty]/actions';
import type { CodeLitSourceRecord } from '@/lib/pb/types';

const SOURCE_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'guideline', label: 'Guideline' },
  { value: 'systematic_review', label: 'Systematic review' },
  { value: 'clinical_review', label: 'Clinical review' },
  { value: 'meta_analysis', label: 'Meta-analysis' },
  { value: 'case_report', label: 'Case report' },
  { value: 'vet_content', label: 'Vet content' },
  { value: 'non_english', label: 'Non-English' },
  { value: 'other', label: 'Other' },
];

/**
 * Manually add a literature source to a code's RAG corpus. Creates a
 * pre-approved source appended to the rank order; on success the created
 * record is handed back via {@link onAdded} so the Literature panel can splice
 * it into its locally-fetched list (it appears in both Searched and Approved).
 * Code-lit sibling of {@link AddSourceModal}; Source ID is optional here.
 */
export function AddCodeLitSourceModal({
  open,
  slug,
  codeId,
  code,
  onClose,
  onAdded,
}: {
  open: boolean;
  slug: string;
  codeId: string;
  code: string;
  onClose: () => void;
  onAdded: (source: CodeLitSourceRecord) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [journal, setJournal] = useState('');
  const [url, setUrl] = useState('');
  const [doi, setDoi] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setSourceId('');
    setTitle('');
    setSourceType('');
    setJournal('');
    setUrl('');
    setDoi('');
    setError(null);
    setSubmitting(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError('Title is required.');
    setSubmitting(true);
    try {
      const res = await addCodeLitSource(slug, codeId, code, {
        title,
        sourceId,
        sourceType,
        journal,
        url,
        doi,
      });
      if (res.error || !res.source) {
        setError(res.error ?? 'Failed to add source.');
        return;
      }
      onAdded(res.source);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add source.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Add source"
      subHeader="Adds an approved literature source to this topic's corpus, appended to the rank order."
      size="m"
      isDismissible
      onAction={close}
      actionButton={{
        text: submitting ? 'Adding…' : 'Add source',
        onClick: submit,
        disabled: submitting,
      }}
      secondaryButton={{ text: 'Cancel', onClick: close }}
    >
      <Modal.Stack>
        <Stack space="s">
          <Input
            label="Title"
            name="add-code-lit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            label="Source ID (optional)"
            name="add-code-lit-source-id"
            placeholder="e.g. 37656"
            hint="If set, used as the ribosomId and Cortex Source ID."
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          />
          <Select
            label="Type (optional)"
            name="add-code-lit-type"
            value={sourceType}
            options={SOURCE_TYPE_OPTIONS}
            onChange={(e) => setSourceType(e.target.value)}
          />
          <Input
            label="Journal (optional)"
            name="add-code-lit-journal"
            value={journal}
            onChange={(e) => setJournal(e.target.value)}
          />
          <Input
            label="URL (optional)"
            name="add-code-lit-url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            label="DOI (optional)"
            name="add-code-lit-doi"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
          />
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
