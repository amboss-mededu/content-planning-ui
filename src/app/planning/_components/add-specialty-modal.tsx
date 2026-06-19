'use client';

import { Callout, Checkbox, Input, Modal, Select, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MappingSource } from '@/lib/types';

function autoSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

/** Register a new specialty. Mirrors the old inline AddSpecialtyForm (same
 *  `/api/specialties` POST + auto-slug), relocated into a DS Modal opened from
 *  the dashboard's "Add specialty" button. */
export function AddSpecialtyModal({
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
  const [mappingOnly, setMappingOnly] = useState(false);
  const [mappingSource, setMappingSource] = useState<MappingSource>('amboss');
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
    setMappingOnly(false);
    setMappingSource('amboss');
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
          mappingOnly: mappingOnly || undefined,
          mappingSource,
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
          <Input
            name="specialty-slug"
            label="Slug"
            placeholder="dermatology"
            value={displayedSlug}
            onChange={(e) => {
              setSlug(autoSlug(e.target.value));
              setSlugTouched(true);
            }}
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
            label="Mapping source"
            labelHint="Which content to assess coverage against."
            value={mappingSource}
            onChange={(e) => setMappingSource(e.target.value as MappingSource)}
            options={[
              { value: 'amboss', label: 'AMBOSS' },
              { value: 'guidelines', label: 'Guidelines' },
              { value: 'both', label: 'Both' },
            ]}
          />
          <Checkbox
            name="specialty-mappingOnly"
            label="Mapping only"
            labelHint="Skip consolidation & suggestions — run coverage mapping only."
            checked={mappingOnly}
            onChange={(e) => setMappingOnly(e.target.checked)}
          />
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
