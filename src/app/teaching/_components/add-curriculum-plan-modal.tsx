'use client';

import { Callout, Input, Modal, Select, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function autoSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

/** Register a new curriculum plan. Mirrors AddSpecialtyModal (same
 *  `/api/specialties` POST + auto-slug) but pins the workflow to
 *  `curriculum-mapping` (source `amboss`), so the modal only asks for
 *  identity. */
export function AddCurriculumPlanModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [region, setRegion] = useState('');
  const [language, setLanguage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const displayedSlug = slugTouched ? slug : autoSlug(name);
  const canSubmit = !submitting && name.trim().length > 0 && displayedSlug.length > 0;

  const reset = () => {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setRegion('');
    setLanguage('');
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
          // Curriculum plans always run the curriculum-mapping workflow;
          // the server pins the mapping source to AMBOSS.
          pipelineMode: 'curriculum-mapping',
          mappingSource: 'amboss',
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
      setError(err instanceof Error ? err.message : 'Failed to add curriculum plan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Add curriculum plan"
      subHeader="Only identity is needed here. Provide the curriculum PDF URLs when you start an extraction run."
      size="m"
      isDismissible
      onAction={close}
      actionButton={{
        text: submitting ? 'Adding…' : 'Add curriculum plan',
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
            name="curriculum-name"
            label="Name"
            placeholder="Internal Medicine Residency"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            name="curriculum-slug"
            label="Slug"
            placeholder="internal_medicine_residency"
            value={displayedSlug}
            onChange={(e) => {
              setSlug(autoSlug(e.target.value));
              setSlugTouched(true);
            }}
          />
          <Select
            name="curriculum-region"
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
            name="curriculum-language"
            label="Language"
            placeholder="en"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
