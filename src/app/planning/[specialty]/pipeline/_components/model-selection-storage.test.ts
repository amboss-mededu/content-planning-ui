import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelSpec } from '@/lib/workflows/lib/llm';
import {
  clearSpec,
  DEFAULT_MODELS,
  modelKey,
  readSpecForStage,
  writeSpec,
} from './model-selection-storage';

const slug = 'cardiology';
const stage = 'consolidate_primary';
const key = modelKey(slug, stage);

const opus: ModelSpec = {
  provider: 'anthropic',
  model: 'claude-opus-4-7',
  reasoning: 'auto',
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('model selection storage', () => {
  it('returns the Gemini default for consolidate_primary without a stored override', () => {
    expect(readSpecForStage(slug, stage)).toEqual(DEFAULT_MODELS.consolidate_primary);
    expect(readSpecForStage(slug, stage)?.model).toBe('gemini-3.1-pro-preview');
  });

  it('returns a stored Opus override for consolidate_primary', () => {
    writeSpec(key, opus);

    expect(readSpecForStage(slug, stage)).toEqual(opus);
  });

  it('clearing the override restores the Gemini default', () => {
    writeSpec(key, opus);
    clearSpec(key);

    expect(readSpecForStage(slug, stage)).toEqual(DEFAULT_MODELS.consolidate_primary);
  });
});
