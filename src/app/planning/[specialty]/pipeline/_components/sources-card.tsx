'use client';

import {
  Button,
  Callout,
  Card,
  CardBox,
  Inline,
  Input,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import type { SourceKind } from './add-source-modal';

const KIND_COPY: Record<
  SourceKind,
  {
    title: string;
    description: React.ReactNode;
    slugPlaceholder: string;
    namePlaceholder: string;
    emptyLabel: string;
  }
> = {
  code: {
    title: 'Code sources',
    description: (
      <>
        The slug becomes the code prefix (e.g. <code>ab_&lt;specialty&gt;_0001</code>).
        Add any source whose content you want to extract codes from.
      </>
    ),
    slugPlaceholder: 'usmle',
    namePlaceholder: 'USMLE',
    emptyLabel: 'No code sources yet — add one below to enable the source dropdown.',
  },
  milestone: {
    title: 'Milestone sources',
    description: (
      <>
        Publishers whose milestone documents you want to extract from. ACGME is seeded by
        default — add more as needed (e.g. specialty board publications).
      </>
    ),
    slugPlaceholder: 'aamc',
    namePlaceholder: 'AAMC',
    emptyLabel: 'No milestone sources yet — add one below to enable the source dropdown.',
  },
};

/**
 * Manage the set of source prefixes available in a start-run form's Source
 * dropdown. `kind` selects which registry (code vs milestone) this card
 * operates on.
 */
export function SourcesCard({
  kind,
  sources,
}: {
  kind: SourceKind;
  sources: CodeSource[];
}) {
  const router = useRouter();
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
  async function remove(args: { slug: string }): Promise<void> {
    const res = await fetch(`${endpoint}?slug=${encodeURIComponent(args.slug)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `delete failed (${res.status})`);
    }
  }
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setSlug('');
      setName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source.');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (targetSlug: string) => {
    if (!confirm(`Delete source "${targetSlug}"?`)) return;
    try {
      await remove({ slug: targetSlug });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete source.');
    }
  };

  return (
    <Card title={copy.title} titleAs="h3" outlined>
      <CardBox>
        <Stack space="s">
          <Text color="secondary">{copy.description}</Text>

          {sources.length > 0 ? (
            <Stack space="xxs">
              {sources.map((s) => (
                <Inline key={s.slug} space="s" vAlignItems="center">
                  <Text>
                    <code>{s.slug}</code>
                  </Text>
                  <Text>{s.name}</Text>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => onDelete(s.slug)}
                  >
                    Delete
                  </Button>
                </Inline>
              ))}
            </Stack>
          ) : (
            <Text color="secondary">{copy.emptyLabel}</Text>
          )}

          <form onSubmit={onAdd}>
            <Inline space="s" vAlignItems="bottom">
              <Input
                label="Slug"
                name={`new-${kind}-source-slug`}
                placeholder={copy.slugPlaceholder}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <Input
                label="Display name"
                name={`new-${kind}-source-name`}
                placeholder={copy.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add source'}
              </Button>
            </Inline>
          </form>
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </CardBox>
    </Card>
  );
}
