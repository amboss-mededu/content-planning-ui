'use client';

import { Callout, Input, Modal, Stack } from '@amboss/design-system';
import { useState } from 'react';
import type { CodeSource } from '@/lib/workflows/lib/sources';

export type SourceKind = 'code' | 'milestone';

const KIND_COPY: Record<
  SourceKind,
  {
    header: string;
    subHeader: string;
    slugPlaceholder: string;
    namePlaceholder: string;
  }
> = {
  code: {
    header: 'Add a new code source',
    subHeader: 'The slug becomes the code prefix (e.g. usmle_<specialty>_0001).',
    slugPlaceholder: 'usmle',
    namePlaceholder: 'USMLE',
  },
  milestone: {
    header: 'Add a new milestone source',
    subHeader: 'Publisher or authority that produced the milestone document.',
    slugPlaceholder: 'aamc',
    namePlaceholder: 'AAMC',
  },
};

/**
 * Inline "add a new source" modal, triggered from the Source dropdown's
 * special "+ Add new source…" option. On success, hands the created source
 * back to the caller so the current row can auto-select it. The `kind` prop
 * decides which registry (code vs milestone) the row goes into.
 */
export function AddSourceModal({
  open,
  kind = 'code',
  onClose,
  onCreated,
}: {
  open: boolean;
  kind?: SourceKind;
  onClose: () => void;
  onCreated: (source: CodeSource) => void;
}) {
  const copy = KIND_COPY[kind];
  const endpoint = kind === 'code' ? '/api/sources/code' : '/api/sources/milestone';
  async function create(args: { slug: string; name: string }): Promise<void> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `add failed (${res.status})`);
    }
  }
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setSlug('');
    setName('');
    setError(null);
    setSubmitting(false);
  };

  const submit = async () => {
    setError(null);
    const s = slug.trim().toLowerCase();
    const n = name.trim();
    if (!s) {
      setError('Slug required');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(s)) {
      setError('Slug must match [a-z0-9][a-z0-9_-]*');
      return;
    }
    if (!n) {
      setError('Name required');
      return;
    }
    setSubmitting(true);
    try {
      await create({ slug: s, name: n });
      reset();
      onCreated({ slug: s, name: n });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header={copy.header}
      subHeader={copy.subHeader}
      size="m"
      isDismissible
      actionButton={{
        text: submitting ? 'Adding…' : 'Add source',
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
            label="Slug"
            name="modal-source-slug"
            placeholder={copy.slugPlaceholder}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <Input
            label="Display name"
            name="modal-source-name"
            placeholder={copy.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
