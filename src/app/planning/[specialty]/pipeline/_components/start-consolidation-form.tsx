'use client';

import { Button, Callout, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { readSpecForStage } from './model-selection-storage';

/**
 * Minimal Start form for the three consolidation stages on the pipeline
 * page. No model picker — the runners are stubs today (see
 * `consolidation/prompts.ts`); when the real LLM prompts land, this form
 * will gain a `ModelSettingsPopover` like the other stage cards.
 *
 * Variants:
 *  - `consolidate_primary` (whole specialty, no category filter)
 *  - `consolidate_articles`
 *  - `consolidate_sections`
 *
 * The per-category trigger lives on the consolidation-review page; this
 * form is the whole-specialty re-run path the pipeline dashboard uses.
 */
export function StartConsolidationForm({
  specialtySlug,
  stage,
}: {
  specialtySlug: string;
  stage: 'consolidate_primary' | 'consolidate_articles' | 'consolidate_sections';
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const endpoint =
    stage === 'consolidate_primary'
      ? '/api/workflows/consolidate-primary'
      : stage === 'consolidate_articles'
        ? '/api/workflows/consolidate-articles'
        : '/api/workflows/consolidate-sections';

  const label =
    stage === 'consolidate_primary'
      ? 'Run primary consolidation (all categories)'
      : stage === 'consolidate_articles'
        ? 'Run articles dedupe'
        : 'Run sections dedupe';

  const onClick = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          model: readSpecForStage(specialtySlug, stage),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Run started: ${body.runId}`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack space="s">
      <Text color="secondary">
        Runs consolidation with the model configured on this stage card.
      </Text>
      <Inline space="s">
        <div style={{ width: 320 }}>
          <Button type="button" fullWidth onClick={onClick} disabled={submitting}>
            {submitting ? 'Starting…' : label}
          </Button>
        </div>
      </Inline>
      {error ? <Callout type="error" text={error} /> : null}
      {success ? <Callout type="success" text={success} /> : null}
    </Stack>
  );
}
