'use client';

import {
  Button,
  Callout,
  Checkbox,
  Inline,
  Select,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AmbossLibraryStats } from '@/lib/data/amboss-library';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { DEFAULT_MAPPING_SYSTEM_PROMPT } from '@/lib/workflows/lib/prompts';
import {
  estimateScopeCount,
  MappingScopePicker,
  type MappingScopeValue,
} from '../../../_components/mapping-scope-picker';
import { DefaultPromptModal } from './default-prompt-modal';
import { missingApiKeyProvider } from './missing-api-key';
import { MissingKeyModal } from './missing-key-modal';
import {
  backupModelKey,
  DEFAULT_BACKUP_MODEL,
  readSpec,
  readSpecForStage,
} from './model-selection-storage';
import { PromptSection } from './prompt-section';

function fmtNum(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function fmtDate(d: Date | null): string {
  if (!d) return 'never';
  return new Date(d).toLocaleString();
}

export function StartMapCodesForm({
  specialtySlug,
  unmappedCount,
  defaultContentBase,
  libraryStats,
  categories,
  unmappedCodes,
}: {
  specialtySlug: string;
  unmappedCount: number;
  defaultContentBase: string;
  libraryStats: AmbossLibraryStats;
  categories: CodeCategorySummary[];
  unmappedCodes: UnmappedCodePickerRow[];
}) {
  const router = useRouter();
  const [contentBase, setContentBase] = useState(defaultContentBase);
  const [checkAgainstLibrary, setCheckAgainstLibrary] = useState(
    libraryStats.articles > 0,
  );
  const [instructions, setInstructions] = useState('');
  const [showDefault, setShowDefault] = useState(false);

  const [scope, setScope] = useState<MappingScopeValue>({
    mode: categories.length > 0 ? 'categories' : 'codes',
    selectedCats: categories.map((c) => c.category),
    specificCodes: [],
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ runId: string; token: string } | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);

  const librarySeeded = libraryStats.articles > 0;
  const statsLine = librarySeeded
    ? `${fmtNum(libraryStats.sections)} sections · ${fmtNum(libraryStats.articles)} articles · last synced ${fmtDate(libraryStats.lastSyncedAt)}`
    : 'No AMBOSS article library loaded yet.';

  const estimatedCount = estimateScopeCount(scope, categories, unmappedCount);
  const allSelected =
    scope.selectedCats.length === categories.length && categories.length > 0;
  const submitDisabled = submitting || estimatedCount === 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const primaryModel = readSpecForStage(specialtySlug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured for Map codes. Open the gear icon to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(specialtySlug)) ?? DEFAULT_BACKUP_MODEL;

    setSubmitting(true);
    try {
      // Only one of the two filters is sent per run — the mode toggle above
      // enforces an exclusive choice. For "categories": omit when the user
      // kept every category checked (equivalent to no filter).
      const categoriesPayload =
        scope.mode === 'categories' && !allSelected && scope.selectedCats.length > 0
          ? scope.selectedCats
          : undefined;
      const codesPayload =
        scope.mode === 'codes' && scope.specificCodes.length > 0
          ? scope.specificCodes
          : undefined;
      const res = await fetch('/api/workflows/map-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug,
          contentBase: contentBase.trim() || undefined,
          additionalInstructions: instructions.trim() || undefined,
          checkAgainstLibrary,
          categories: categoriesPayload,
          codes: codesPayload,
          primaryModel,
          backupModel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = missingApiKeyProvider(res.status, body);
        if (missing) {
          setMissingKey(missing);
          return;
        }
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess({ runId: body.runId, token: body.approvalToken });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack space="m">
        <Text>
          Will map{' '}
          <strong>
            {fmtNum(estimatedCount)} code{estimatedCount === 1 ? '' : 's'}
          </strong>{' '}
          against the AMBOSS MCP server. Concurrency = 10. Each code tries Gemini 3 Flash
          up to 3 times, then escalates to Claude Opus 4.7 if cited article or section IDs
          still don't resolve.
        </Text>

        <Stack space="xxs">
          <Text weight="bold">AMBOSS content base</Text>
          <div style={{ width: 260 }}>
            <Select
              name="contentBase"
              value={contentBase}
              onChange={(e) => setContentBase(e.target.value)}
              options={[
                { value: 'US', label: 'US (English)' },
                { value: 'German', label: 'German (DE)' },
              ]}
            />
          </div>
          <Text color="secondary">
            The model uses this verbatim to pick the correct MCP content base.
          </Text>
        </Stack>

        <MappingScopePicker
          categories={categories}
          unmappedCodes={unmappedCodes}
          unmappedCount={unmappedCount}
          value={scope}
          onChange={setScope}
        />

        <Stack space="xxs">
          <Checkbox
            name="checkAgainstLibrary"
            label="Check mappings against article library"
            checked={checkAgainstLibrary}
            onChange={(e) => setCheckAgainstLibrary(e.target.checked)}
            disabled={!librarySeeded}
          />
          <Text color="secondary">{statsLine}</Text>
          {!librarySeeded ? (
            <Callout
              type="warning"
              text="No AMBOSS article library loaded. Run `npm run db:refresh-amboss-library -- path/to/export.json` to enable ID validation, or proceed with validation off (raw LLM output, no retry on hallucinated IDs)."
            />
          ) : !checkAgainstLibrary ? (
            <Callout
              type="info"
              text="Validation is off — each code will run one Flash attempt and accept whatever it returns, even if cited IDs aren't real."
            />
          ) : null}
        </Stack>

        <PromptSection
          title="Mapping — system prompt"
          hint="Agent prompt that drives the AMBOSS MCP analysis. Additional instructions are appended to the default."
          value={instructions}
          onChange={setInstructions}
          onViewDefault={() => setShowDefault(true)}
        />

        <Inline space="s">
          <div style={{ width: 220 }}>
            <Button type="submit" fullWidth disabled={submitDisabled}>
              {submitting ? 'Starting…' : `Start mapping (${fmtNum(estimatedCount)})`}
            </Button>
          </div>
        </Inline>
        {error ? <Callout type="error" text={error} /> : null}
        {success ? (
          <Callout
            type="success"
            text={`Run started: ${success.runId} — approval token: ${success.token}`}
          />
        ) : null}
      </Stack>

      <DefaultPromptModal
        open={showDefault}
        onClose={() => setShowDefault(false)}
        title="Mapping default system prompt"
        subHeader="Appended to any additional instructions you provide."
        text={DEFAULT_MAPPING_SYSTEM_PROMPT}
      />
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </form>
  );
}
