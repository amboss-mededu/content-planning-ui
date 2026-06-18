'use client';

import {
  Button,
  Callout,
  Checkbox,
  Inline,
  Input,
  Select,
  Stack,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function autoSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

export function AddSpecialtyForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [region, setRegion] = useState('');
  const [language, setLanguage] = useState('');
  const [mappingOnly, setMappingOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayedSlug = slugTouched ? slug : autoSlug(name);
  const canSubmit = !submitting && name.trim().length > 0 && displayedSlug.length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Add failed (${res.status})`);
      }
      setName('');
      setSlug('');
      setSlugTouched(false);
      setRegion('');
      setLanguage('');
      setMappingOnly(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add specialty.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack space="s">
        <Inline space="s" vAlignItems="bottom">
          <Input
            name="name"
            label="Name"
            placeholder="Dermatology"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            name="slug"
            label="Slug"
            placeholder="dermatology"
            value={displayedSlug}
            onChange={(e) => {
              setSlug(autoSlug(e.target.value));
              setSlugTouched(true);
            }}
          />
          <Select
            name="region"
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
            name="language"
            label="Language"
            placeholder="en"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Adding…' : 'Add specialty'}
          </Button>
        </Inline>
        <Checkbox
          name="mappingOnly"
          label="Mapping only"
          labelHint="Skip consolidation & suggestions — run coverage mapping only."
          checked={mappingOnly}
          onChange={(e) => setMappingOnly(e.target.checked)}
        />
        {error ? <Callout type="error" text={error} /> : null}
      </Stack>
    </form>
  );
}
