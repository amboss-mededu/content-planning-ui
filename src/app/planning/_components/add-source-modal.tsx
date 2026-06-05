'use client';

import { Callout, Input, Modal, Select, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addArticleSource } from '@/app/planning/[specialty]/actions';

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
 * Manually add a source to an article from the prioritisation step. Creates
 * a pre-approved source appended to the priority order (so it lands in the
 * draft's ribosomId list). The editor still uploads the matching
 * `<ribosomId>.pdf` when they trigger the draft.
 */
export function AddSourceModal({
  open,
  slug,
  articleKey,
  articleRecordId,
  onClose,
}: {
  open: boolean;
  slug: string;
  articleKey: string;
  articleRecordId: string;
  onClose: () => void;
}) {
  const router = useRouter();
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
    if (!sourceId.trim()) return setError('Source ID is required.');
    if (!title.trim()) return setError('Title is required.');
    setSubmitting(true);
    try {
      const res = await addArticleSource(slug, articleKey, articleRecordId, {
        sourceId,
        title,
        sourceType,
        journal,
        url,
        doi,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      reset();
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add source.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Add source"
      subHeader="Adds an approved source to this article, appended to the priority order. Upload its <ribosomId>.pdf when you draft."
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
            label="Source ID"
            name="add-source-source-id"
            placeholder="e.g. 37656"
            hint="Used as the draft ribosomId (the PDF name) and the Cortex Source ID."
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          />
          <Input
            label="Title"
            name="add-source-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Select
            label="Type (optional)"
            name="add-source-type"
            value={sourceType}
            options={SOURCE_TYPE_OPTIONS}
            onChange={(e) => setSourceType(e.target.value)}
          />
          <Input
            label="Journal (optional)"
            name="add-source-journal"
            value={journal}
            onChange={(e) => setJournal(e.target.value)}
          />
          <Input
            label="URL (optional)"
            name="add-source-url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input
            label="DOI (optional)"
            name="add-source-doi"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
          />
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
