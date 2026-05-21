/**
 * Provider abstraction for LLM calls in the pipeline workflows.
 *
 * Three concerns the rest of the codebase used to spread across files (and
 * sometimes guess at):
 *
 *   1. Which AI SDK client to instantiate for a given (provider, model).
 *   2. How to translate our universal `reasoning` levels (low / medium /
 *      high / auto) into the right per-provider knob — Google's
 *      `thinkingLevel`, Anthropic's adaptive `thinking` + `effort`,
 *      OpenAI's `reasoningEffort`.
 *   3. What models the UI should expose. `MODEL_CATALOG` is the single
 *      source of truth — both the per-stage selector dropdown and any
 *      backend validation should read from here.
 *
 * Per-user keys are passed in by the API route handler; this module never
 * touches `process.env` directly so the same code path covers both the
 * env-fallback and per-user paths transparently.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { LanguageModel } from 'ai';

export type ProviderId = 'google' | 'anthropic' | 'openai';
export type ReasoningLevel = 'auto' | 'low' | 'medium' | 'high';

export type ModelSpec = {
  provider: ProviderId;
  model: string;
  reasoning: ReasoningLevel;
};

export type ProviderApiKeys = Partial<Record<ProviderId, string>>;

export type CatalogEntry = {
  provider: ProviderId;
  model: string;
  label: string;
};

// Model identifiers must match exactly what the provider's generateContent /
// messages endpoint accepts. For Google's Gemini, both Gemini 3 and the 3.1
// line are still in preview (the `-preview` suffix is required); the GA
// `gemini-3-pro` was deprecated 2026-03-09 and Google recommends
// `gemini-3.1-pro-preview` as its replacement. See
// https://ai.google.dev/gemini-api/docs/models for the canonical list.
export const MODEL_CATALOG: readonly CatalogEntry[] = [
  {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
  },
  {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
  },
  { provider: 'anthropic', model: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { provider: 'anthropic', model: 'claude-sonnet-4-7', label: 'Claude Sonnet 4.7' },
  { provider: 'openai', model: 'gpt-5.5', label: 'GPT-5.5' },
] as const;

export const REASONING_LEVELS: readonly ReasoningLevel[] = [
  'auto',
  'low',
  'medium',
  'high',
] as const;

export function isCatalogEntry(provider: string, model: string): boolean {
  return MODEL_CATALOG.some((m) => m.provider === provider && m.model === model);
}

/**
 * Resolved call shape: the SDK model instance plus the `providerOptions`
 * object the caller should spread into `generateText({ ... })`. Returning a
 * plain object (instead of injecting the call) keeps the resolver
 * generateText-shape agnostic — callers that also need `tools`, `output`,
 * `temperature`, etc. just merge.
 */
export type ResolvedModel = {
  sdkModel: LanguageModel;
  providerOptions: ProviderOptions;
  /** Echoes `spec.model` for logging / cost lookup. */
  modelId: string;
  provider: ProviderId;
};

export class MissingApiKeyError extends Error {
  readonly provider: ProviderId;
  constructor(provider: ProviderId) {
    super(`No API key configured for ${provider}`);
    this.name = 'MissingApiKeyError';
    this.provider = provider;
  }
}

export function resolveModel(spec: ModelSpec, apiKeys: ProviderApiKeys): ResolvedModel {
  const key = apiKeys[spec.provider];
  if (!key) throw new MissingApiKeyError(spec.provider);

  switch (spec.provider) {
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: key });
      const thinkingConfig =
        spec.reasoning === 'high'
          ? { thinkingBudget: 32768 }
          : spec.reasoning === 'auto'
            ? undefined
            : { thinkingLevel: spec.reasoning };
      // `structuredOutputs: false` keeps the provider in JSON-output mode
      // (`responseMimeType: 'application/json'`) but skips Google's
      // `responseSchema` grammar compilation. Large consolidation responses
      // are parsed as JSON by the AI SDK and validated locally by the
      // workflow's Zod schema.
      return {
        sdkModel: google(spec.model),
        providerOptions: {
          google: {
            structuredOutputs: false,
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        },
        modelId: spec.model,
        provider: 'google',
      };
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: key });
      const anthOpts: ProviderOptions[string] = { thinking: { type: 'adaptive' } };
      if (spec.reasoning !== 'auto') anthOpts.effort = spec.reasoning;
      return {
        sdkModel: anthropic(spec.model),
        providerOptions: { anthropic: anthOpts },
        modelId: spec.model,
        provider: 'anthropic',
      };
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: key });
      return {
        sdkModel: openai(spec.model),
        providerOptions:
          spec.reasoning === 'auto'
            ? {}
            : { openai: { reasoningEffort: spec.reasoning } },
        modelId: spec.model,
        provider: 'openai',
      };
    }
  }
}
