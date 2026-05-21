'use client';

/**
 * localStorage-backed model selection per (specialty, stage).
 *
 * Selection lives on the per-card UI but needs to be read at submit time by
 * a separate start-form component, so we go through the browser's storage
 * rather than React context — keeps the two render trees independent and
 * the selection survives page reloads.
 *
 * Defaults: every stage has a hard-coded default in `DEFAULT_MODELS` so the
 * editor never has to pick one before running. `useModelSelection` still
 * returns `null` for "no override stored" so the UI can show the user
 * whether they're on a default or an override; `readSpecForStage` is the
 * submit-time resolver that falls back to the default.
 */

import { useEffect, useState } from 'react';
import {
  isCatalogEntry,
  type ModelSpec,
  type ProviderId,
  type ReasoningLevel,
} from '@/lib/workflows/lib/llm';

const REASONING_VALUES: ReadonlySet<ReasoningLevel> = new Set([
  'auto',
  'low',
  'medium',
  'high',
]);

function isProvider(v: unknown): v is ProviderId {
  return v === 'google' || v === 'anthropic' || v === 'openai';
}

function parseSpec(raw: unknown): ModelSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    !isProvider(obj.provider) ||
    typeof obj.model !== 'string' ||
    typeof obj.reasoning !== 'string' ||
    !REASONING_VALUES.has(obj.reasoning as ReasoningLevel) ||
    !isCatalogEntry(obj.provider, obj.model)
  ) {
    return null;
  }
  return {
    provider: obj.provider,
    model: obj.model,
    reasoning: obj.reasoning as ReasoningLevel,
  };
}

export function modelKey(specialtySlug: string, stage: string): string {
  return `pipeline:${specialtySlug}:model:${stage}`;
}

export function backupModelKey(specialtySlug: string): string {
  return `pipeline:${specialtySlug}:model-backup:map_codes`;
}

export const DEFAULT_BACKUP_MODEL: ModelSpec = {
  provider: 'anthropic',
  model: 'claude-opus-4-7',
  reasoning: 'auto',
};

export const DEFAULT_MODELS: Record<string, ModelSpec> = {
  extract_codes: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    reasoning: 'auto',
  },
  extract_milestones: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    reasoning: 'auto',
  },
  map_codes: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    reasoning: 'auto',
  },
  consolidate_primary: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    reasoning: 'high',
  },
  consolidate_articles: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    reasoning: 'high',
  },
  consolidate_sections: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    reasoning: 'high',
  },
  write_article: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    reasoning: 'high',
  },
};

/**
 * Submit-time model resolver: returns the stored override if present, else
 * the hard-coded default for this stage. The start forms call this instead
 * of `readSpec` so editors don't have to pick a model before every run.
 * `useModelSelection` still returns `null` when nothing's stored so the UI
 * can render a "(default — …)" hint without conflating the two states.
 */
export function readSpecForStage(slug: string, stage: string): ModelSpec | null {
  return readSpec(modelKey(slug, stage)) ?? DEFAULT_MODELS[stage] ?? null;
}

export function readSpec(key: string): ModelSpec | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return parseSpec(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeSpec(key: string, spec: ModelSpec): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(spec));
    // Notify in-tab subscribers — the native `storage` event only fires for
    // OTHER tabs, so we dispatch a synthetic one for ourselves so the
    // start form's hook re-reads after the user changes the StageCard
    // selector.
    window.dispatchEvent(new CustomEvent('pipeline:model-storage', { detail: { key } }));
  } catch {
    // Quota exceeded / private mode — surface upstream as null on read.
  }
}

export function clearSpec(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent('pipeline:model-storage', { detail: { key } }));
  } catch {
    // Private mode / blocked storage — readers will continue to fall back.
  }
}

/**
 * Subscribe to a single (specialty, stage) selection. SSR-safe: returns
 * `null` on the first render, then snaps to the stored value once mounted.
 * Live updates: re-fires whenever any code in the same tab calls
 * `writeSpec(key, ...)` for the same key, or any other tab updates that
 * key's localStorage entry.
 */
export function useModelSelection(key: string): ModelSpec | null {
  const [spec, setSpec] = useState<ModelSpec | null>(null);
  useEffect(() => {
    setSpec(readSpec(key));
    function onStorage(e: StorageEvent | CustomEvent<{ key: string }>) {
      const changedKey =
        e instanceof StorageEvent ? e.key : (e as CustomEvent).detail?.key;
      if (changedKey === key || changedKey === null) setSpec(readSpec(key));
    }
    window.addEventListener('storage', onStorage as EventListener);
    window.addEventListener('pipeline:model-storage', onStorage as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage as EventListener);
      window.removeEventListener('pipeline:model-storage', onStorage as EventListener);
    };
  }, [key]);
  return spec;
}

/** Backup variant — same as `useModelSelection` but seeded with
 *  `DEFAULT_BACKUP_MODEL` when storage is empty so the user starts with a
 *  sensible escalation (Opus 4.7 at adaptive thinking). */
export function useBackupModelSelection(specialtySlug: string): ModelSpec {
  const [spec, setSpec] = useState<ModelSpec>(DEFAULT_BACKUP_MODEL);
  useEffect(() => {
    const key = backupModelKey(specialtySlug);
    const stored = readSpec(key);
    setSpec(stored ?? DEFAULT_BACKUP_MODEL);
    function onStorage(e: StorageEvent | CustomEvent<{ key: string }>) {
      const changedKey =
        e instanceof StorageEvent ? e.key : (e as CustomEvent).detail?.key;
      if (changedKey === key || changedKey === null) {
        setSpec(readSpec(key) ?? DEFAULT_BACKUP_MODEL);
      }
    }
    window.addEventListener('storage', onStorage as EventListener);
    window.addEventListener('pipeline:model-storage', onStorage as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage as EventListener);
      window.removeEventListener('pipeline:model-storage', onStorage as EventListener);
    };
  }, [specialtySlug]);
  return spec;
}
