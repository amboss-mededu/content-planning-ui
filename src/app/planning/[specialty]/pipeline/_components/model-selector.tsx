'use client';

import { Button, Inline, Select, Stack, Text } from '@amboss/design-system';
import { useEffect, useState } from 'react';
import {
  MODEL_CATALOG,
  type ModelSpec,
  type ProviderId,
  REASONING_LEVELS,
} from '@/lib/workflows/lib/llm';
import {
  backupModelKey,
  clearSpec,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_MODELS,
  modelKey,
  readSpec,
  readSpecForStage,
  writeSpec,
} from './model-selection-storage';

const REASONING_OPTIONS = REASONING_LEVELS.map((r) => ({
  value: r,
  label:
    r === 'auto'
      ? 'Auto (provider default)'
      : `${r[0].toUpperCase()}${r.slice(1)} reasoning`,
}));

const MODEL_OPTIONS = [
  { value: '', label: 'Pick a model…', disabled: true },
  ...MODEL_CATALOG.map((m) => ({
    value: `${m.provider}::${m.model}`,
    label: m.label,
  })),
];

function specToValue(spec: ModelSpec | null): string {
  return spec ? `${spec.provider}::${spec.model}` : '';
}

function valueToProviderModel(
  value: string,
): { provider: ProviderId; model: string } | null {
  const [provider, model] = value.split('::', 2);
  if (!provider || !model) return null;
  if (provider !== 'google' && provider !== 'anthropic' && provider !== 'openai') {
    return null;
  }
  return { provider, model };
}

function ModelDropdowns({
  label,
  storageKey,
  initial,
  onChange,
  emptyHint,
  defaultSpec,
  portalContainer,
}: {
  label: string;
  storageKey: string;
  initial: ModelSpec | null;
  onChange?: (spec: ModelSpec | null) => void;
  emptyHint?: string;
  defaultSpec?: ModelSpec | null;
  portalContainer?: HTMLElement | null;
}) {
  const [spec, setSpec] = useState<ModelSpec | null>(initial);
  const [hasOverride, setHasOverride] = useState(false);

  useEffect(() => {
    setSpec(initial);
    setHasOverride(Boolean(readSpec(storageKey)));
  }, [initial, storageKey]);

  // SSR-safe hydration: rely on the parent to pass `initial` from localStorage
  // after mount. If a key write happens elsewhere in the same tab (e.g. the
  // user opens the same card twice), keep this instance in sync.
  useEffect(() => {
    function onStorage(e: StorageEvent | CustomEvent<{ key: string }>) {
      const changedKey =
        e instanceof StorageEvent ? e.key : (e as CustomEvent).detail?.key;
      if (changedKey === storageKey || changedKey === null) {
        const stored = readSpec(storageKey);
        setSpec(stored ?? defaultSpec ?? null);
        setHasOverride(Boolean(stored));
      }
    }
    window.addEventListener('storage', onStorage as EventListener);
    window.addEventListener('pipeline:model-storage', onStorage as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage as EventListener);
      window.removeEventListener('pipeline:model-storage', onStorage as EventListener);
    };
  }, [storageKey, defaultSpec]);

  function commit(next: ModelSpec) {
    setSpec(next);
    setHasOverride(true);
    writeSpec(storageKey, next);
    onChange?.(next);
  }

  function resetToDefault() {
    clearSpec(storageKey);
    setSpec(defaultSpec ?? null);
    setHasOverride(false);
    onChange?.(defaultSpec ?? null);
  }

  function onModelChange(value: string) {
    const parsed = valueToProviderModel(value);
    if (!parsed) return;
    commit({
      provider: parsed.provider,
      model: parsed.model,
      reasoning: spec?.reasoning ?? 'auto',
    });
  }

  function onReasoningChange(value: string) {
    if (!spec) return; // model must be picked first
    const next = REASONING_LEVELS.find((r) => r === value);
    if (!next) return;
    commit({ ...spec, reasoning: next });
  }

  return (
    <Stack space="xxs">
      <Text weight="bold">{label}</Text>
      <Inline space="s" vAlignItems="center">
        <div style={{ minWidth: 220 }}>
          <Select
            label="Model"
            hideLabel
            name={`${storageKey}-model`}
            size="s"
            value={specToValue(spec)}
            options={MODEL_OPTIONS}
            portalContainer={portalContainer}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onModelChange(e.target.value)
            }
          />
        </div>
        <div style={{ minWidth: 200 }}>
          <Select
            label="Reasoning"
            hideLabel
            name={`${storageKey}-reasoning`}
            size="s"
            value={spec?.reasoning ?? 'auto'}
            options={REASONING_OPTIONS}
            disabled={!spec}
            portalContainer={portalContainer}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onReasoningChange(e.target.value)
            }
          />
        </div>
        {defaultSpec ? (
          <Button
            variant="tertiary"
            size="s"
            type="button"
            disabled={!hasOverride}
            onClick={resetToDefault}
          >
            Reset to default
          </Button>
        ) : null}
      </Inline>
      {!spec && emptyHint ? <Text color="secondary">{emptyHint}</Text> : null}
    </Stack>
  );
}

/**
 * Single-model selector for non-mapping stages. Renders inside StageCard.
 * On change, persists to localStorage; the start form for this stage reads
 * the same key at submit time.
 */
export function ModelSelector({
  specialtySlug,
  stage,
  portalContainer,
}: {
  specialtySlug: string;
  stage: string;
  portalContainer?: HTMLElement | null;
}) {
  const storageKey = modelKey(specialtySlug, stage);
  const [initial, setInitial] = useState<ModelSpec | null>(null);
  useEffect(() => {
    setInitial(readSpecForStage(specialtySlug, stage));
  }, [specialtySlug, stage]);
  return (
    <ModelDropdowns
      label="Model"
      storageKey={storageKey}
      initial={initial}
      defaultSpec={DEFAULT_MODELS[stage] ?? null}
      portalContainer={portalContainer}
    />
  );
}

/**
 * Primary + backup pair for the mapping card. Backup is seeded with
 * `DEFAULT_BACKUP_MODEL` (Claude Opus 4.7, adaptive reasoning) on first
 * read because every mapping run needs an escalation path — without one
 * the workflow has no fallback for codes whose primary attempts still
 * cite invalid IDs.
 */
export function MappingModelSelector({
  specialtySlug,
  portalContainer,
}: {
  specialtySlug: string;
  portalContainer?: HTMLElement | null;
}) {
  const primaryStorageKey = modelKey(specialtySlug, 'map_codes');
  const backupStorageKey = backupModelKey(specialtySlug);
  const [primaryInitial, setPrimaryInitial] = useState<ModelSpec | null>(null);
  const [backupInitial, setBackupInitial] = useState<ModelSpec | null>(null);

  useEffect(() => {
    setPrimaryInitial(readSpecForStage(specialtySlug, 'map_codes'));
    const stored = readSpec(backupStorageKey);
    setBackupInitial(stored ?? DEFAULT_BACKUP_MODEL);
    // Seed the storage with the default backup so a kickoff before the user
    // touches the dropdown still has a backup to send.
    if (!stored) writeSpec(backupStorageKey, DEFAULT_BACKUP_MODEL);
  }, [specialtySlug, backupStorageKey]);

  return (
    <Stack space="xs">
      <ModelDropdowns
        label="Primary model"
        storageKey={primaryStorageKey}
        initial={primaryInitial}
        defaultSpec={DEFAULT_MODELS.map_codes}
        portalContainer={portalContainer}
      />
      <ModelDropdowns
        label="Backup model (used when primary still cites invalid IDs)"
        storageKey={backupStorageKey}
        initial={backupInitial}
        defaultSpec={DEFAULT_BACKUP_MODEL}
        portalContainer={portalContainer}
      />
    </Stack>
  );
}
