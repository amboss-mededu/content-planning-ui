'use client';

import { Callout, Input, Modal, Select, Stack } from '@amboss/design-system';
import { useState } from 'react';
import { addManualArticle } from '@/app/planning/[specialty]/actions';

export function AddArticleModal({
  open,
  slug,
  specialties,
  onClose,
  onCreated,
}: {
  open: boolean;
  slug?: string;
  specialties?: Array<{ slug: string; name: string }>;
  onClose: () => void;
  onCreated: (articleKey: string, selectedSlug: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [articleType, setArticleType] = useState('');
  const [selectedSlug, setSelectedSlug] = useState(slug ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setTitle('');
    setArticleType('');
    setSelectedSlug(slug ?? '');
    setError(null);
    setSubmitting(false);
  };

  const submit = async () => {
    setError(null);
    const t = title.trim();
    const s = slug ?? selectedSlug;
    if (!t) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await addManualArticle(s, t, articleType.trim() || undefined, !slug);
      if (result.error) {
        setError(result.error);
        return;
      }
      reset();
      onCreated(result.articleKey, s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add article.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Add article to backlog"
      subHeader="Creates a new article directly in the backlog with status 'waiting for sources'."
      size="m"
      isDismissible
      onAction={() => {
        reset();
        onClose();
      }}
      actionButton={{
        text: submitting ? 'Adding…' : 'Add article',
        onClick: submit,
        disabled: submitting,
      }}
      secondaryButton={{
        text: 'Cancel',
        onClick: () => {
          reset();
          onClose();
        },
      }}
    >
      <Modal.Stack>
        <Stack space="s">
          <Input
            label="Article title"
            name="modal-article-title"
            placeholder="e.g. Neuroanesthesia"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            label="Article type (optional)"
            name="modal-article-type"
            placeholder="e.g. disease, procedure, drug"
            value={articleType}
            onChange={(e) => setArticleType(e.target.value)}
          />
          {!slug && specialties && (
            <Select
              name="modal-specialty"
              label="Specialty (optional)"
              value={selectedSlug}
              options={[
                { value: '', label: 'None' },
                ...specialties.map((s) => ({ value: s.slug, label: s.name })),
              ]}
              onChange={(e) => setSelectedSlug(e.target.value)}
            />
          )}
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
