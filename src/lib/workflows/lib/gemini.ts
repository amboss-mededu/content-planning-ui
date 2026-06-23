/**
 * LLM-backed extraction steps (preprocessing stage).
 *
 * Originally ports of two n8n workflows:
 *   - `content_outline_extractor_subworkflow.json` → identifyModulesForUrl
 *   - `content_outline_category_extractor_subworkflow.json` → extractCodesForCategory
 *
 * The model + reasoning level + API keys are now passed in by the caller via
 * `lib/llm.ts`'s `ModelSpec` / `ProviderApiKeys`. The route handler that
 * starts the workflow is responsible for resolving per-user keys (with env
 * fallback) and gating on missing keys before kickoff. There's no `hasCreds`
 * stub fallback here anymore — if the workflow runs, it's because the
 * upstream gate found a key, and a thrown `MissingApiKeyError` from
 * `resolveModel` would be a programmer error worth surfacing loudly.
 */

import { google } from '@ai-sdk/google';
import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type { StageName } from './db-writes';
import { logEvent } from './events';
import { type ModelSpec, type ProviderApiKeys, resolveModel } from './llm';
import { estimateCostUsd } from './pricing';
import {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_IDENTIFY_SYSTEM_PROMPT,
  DEFAULT_MILESTONES_SYSTEM_PROMPT,
} from './prompts';
import type { ContentInput } from './sources';

export {
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_IDENTIFY_SYSTEM_PROMPT,
  DEFAULT_MILESTONES_SYSTEM_PROMPT,
};

// --- shared schemas ---------------------------------------------------------

export const ExtractedCodeSchema = z.object({
  code: z.string(),
  category: z.string().optional(),
  consolidationCategory: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  metadata: z.unknown().optional(),
});

export type RawExtractedCode = z.infer<typeof ExtractedCodeSchema>;

// Per-element schemas used with the AI SDK's `Output.array`. The SDK enforces
// these against Gemini's native structured-output constraint — no manual
// JSON parsing or Zod validation needed downstream.
const IdentifyModulesElementSchema = z.object({ category: z.string() });
const ExtractCodesElementSchema = z.object({
  category: z.string(),
  description: z.string(),
});

/**
 * Strip a surrounding markdown code fence, if present. Handles both a fence
 * that wraps the entire payload and the trailing-prose case by only requiring
 * the fence at the start.
 */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Extract the first balanced JSON array (`[ ... ]`) from arbitrary text using a
 * string-aware depth scanner, so commentary, citations, or `url_context`
 * artifacts before/after the payload don't break parsing. Mirrors the object
 * extractor in `consolidation/primary-output.ts`.
 */
function extractFirstJsonArray(text: string): string | null {
  const input = stripJsonFence(text);
  const start = input.indexOf('[');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') depth++;
    if (char === ']') {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a model completion as a JSON array of `element`-shaped items.
 *
 * The phase steps run with `structuredOutputs: false` (Gemini can't combine a
 * `responseSchema` grammar with the `url_context` tool), so we deliberately do
 * NOT use the SDK's `Output.array`: that helper validates against a
 * provider-enforced `{ elements: [...] }` wrapper which never materializes
 * without the grammar — the model returns a bare array per the prompt, and
 * `Output.array` then throws `response must be an object with an elements
 * array`. Instead we parse and validate the text ourselves (same approach as
 * `extractMilestonesForInputs`).
 *
 * Despite the "JSON array, no other text" instruction, models reached through
 * `url_context` routinely wrap the payload in a markdown fence, prepend a
 * sentence of commentary, or emit citation artifacts — all of which make a
 * naive `JSON.parse` throw. We therefore: (1) parse the fence-stripped body
 * directly, then (2) fall back to extracting the first balanced `[ ... ]` and
 * (3) unwrapping a `{ elements | items | data | results: [...] }` object before
 * giving up.
 */
function parseJsonArray<T>(text: string, element: z.ZodType<T>): T[] {
  const body = stripJsonFence(text);

  const tryParse = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  // 1. Direct parse of the (fence-stripped) body.
  let parsed = tryParse(body);

  // 2. Fall back to the first balanced array embedded in surrounding text.
  if (!Array.isArray(parsed)) {
    const arrayText = extractFirstJsonArray(text);
    if (arrayText) parsed = tryParse(arrayText);
  }

  // 3. Unwrap a common single-key object wrapper, e.g. `{ "elements": [...] }`.
  if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
    for (const key of ['elements', 'items', 'data', 'results']) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        parsed = value;
        break;
      }
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Model did not return a JSON array (first 200 chars): ${body.slice(0, 200)}`,
    );
  }

  return z.array(element).parse(parsed);
}

// Both phase steps use url_context, which produces extra steps (one per URL
// fetch). The structured-output emission counts as its own step too, so
// budget generously.
const MAX_STEPS = 5;

/**
 * Compose the effective system prompt: default, optionally followed by an
 * `## Additional instructions` block when the caller supplied extra guidance.
 * This lets the UI expose lightweight per-phase overrides without forcing
 * users to replace the whole n8n-sourced prompt.
 */
function composePrompt(defaultPrompt: string, additional?: string): string {
  const extra = additional?.trim();
  if (!extra) return defaultPrompt;
  return `${defaultPrompt}\n\n## Additional instructions\n\n${extra}`;
}

// --- Phase 1: identify modules per PDF --------------------------------------

export async function identifyModulesForUrl(input: {
  url: string;
  source?: string;
  additionalInstructions?: string;
  specialtySlug: string;
  runId: string;
  stage: StageName;
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<{ category: string }[]> {
  log('pipeline').info('identifyModulesForUrl', {
    specialtySlug: input.specialtySlug,
    url: input.url,
    source: input.source,
    model: input.model.model,
  });

  const system = composePrompt(
    DEFAULT_IDENTIFY_SYSTEM_PROMPT,
    input.additionalInstructions,
  );
  const userMessage = `
Please load and analyze the content at the following URL(s):
${input.url}

Identify the base hierarchies in the document and return exclusively an output in JSON array format, with no other text.
`.trim();

  const resolved = resolveModel(input.model, input.apiKeys);

  await logEvent({
    runId: input.runId,
    stage: input.stage,
    level: 'info',
    message: `Phase 1: identifying modules for ${input.url}`,
    metrics: {
      url: input.url,
      source: input.source,
      model: resolved.modelId,
      provider: resolved.provider,
      reasoning: input.model.reasoning,
    },
  });

  const started = Date.now();
  try {
    const result = await generateText({
      model: resolved.sdkModel,
      system,
      prompt: userMessage,
      tools: googleUrlContextTool(input.model.provider),
      stopWhen: stepCountIs(MAX_STEPS),
      providerOptions: resolved.providerOptions,
      temperature: 1,
    });

    const modules = parseJsonArray(result.text, IdentifyModulesElementSchema);
    const durationMs = Date.now() - started;
    const usage = {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      reasoningTokens: result.usage?.reasoningTokens,
      cachedInputTokens: result.usage?.cachedInputTokens,
    };
    const costUsd = estimateCostUsd(resolved.modelId, usage);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Phase 1 done: ${modules.length} modules from ${input.url}`,
      metrics: {
        durationMs,
        ...usage,
        costUsd,
        model: resolved.modelId,
        url: input.url,
        source: input.source,
        phase: 'identify',
        completion: modules,
      },
    });
    return modules;
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = errorMessage(e);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'error',
      message: `Phase 1 failed for ${input.url}: ${msg}`,
      metrics: {
        durationMs,
        url: input.url,
        source: input.source,
        model: resolved.modelId,
      },
    });
    throw e;
  }
}

// --- Phase 2: extract codes per (url, module) -------------------------------

export async function extractCodesForCategory(input: {
  url: string;
  source?: string;
  category: string;
  specialtySlug: string;
  additionalInstructions?: string;
  runId: string;
  stage: StageName;
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<{ category: string; description: string }[]> {
  log('pipeline').info('extractCodesForCategory', {
    specialtySlug: input.specialtySlug,
    url: input.url,
    source: input.source,
    category: input.category,
    model: input.model.model,
  });

  const system = composePrompt(
    DEFAULT_EXTRACT_SYSTEM_PROMPT,
    input.additionalInstructions,
  );
  const userMessage = `
You are extracting medical items for the medical specialty: ${input.specialtySlug}.

Please load and analyze the content at the following URL(s):
${input.url}

Extract only codes in the chunk and do not invent any codes or descriptions that are not explicitly mentioned:
${input.category}

Extract all medical items from the document and return exclusively an output in JSON format, with no other text.
`.trim();

  const resolved = resolveModel(input.model, input.apiKeys);

  await logEvent({
    runId: input.runId,
    stage: input.stage,
    level: 'info',
    message: `Phase 2: extracting codes for (${input.category})`,
    metrics: {
      url: input.url,
      source: input.source,
      category: input.category,
      model: resolved.modelId,
      provider: resolved.provider,
      reasoning: input.model.reasoning,
    },
  });

  const started = Date.now();
  try {
    const result = await generateText({
      model: resolved.sdkModel,
      system,
      prompt: userMessage,
      tools: googleUrlContextTool(input.model.provider),
      stopWhen: stepCountIs(MAX_STEPS),
      providerOptions: resolved.providerOptions,
      temperature: 1,
    });

    const codes = parseJsonArray(result.text, ExtractCodesElementSchema);
    const durationMs = Date.now() - started;
    const usage = {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      reasoningTokens: result.usage?.reasoningTokens,
      cachedInputTokens: result.usage?.cachedInputTokens,
    };
    const costUsd = estimateCostUsd(resolved.modelId, usage);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Phase 2 done: ${codes.length} codes for (${input.category})`,
      metrics: {
        durationMs,
        ...usage,
        costUsd,
        model: resolved.modelId,
        url: input.url,
        source: input.source,
        category: input.category,
        phase: 'extract',
        completion: codes,
      },
    });
    return codes;
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = errorMessage(e);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'error',
      message: `Phase 2 failed for (${input.category}): ${msg}`,
      metrics: {
        durationMs,
        url: input.url,
        source: input.source,
        category: input.category,
        model: resolved.modelId,
      },
    });
    throw e;
  }
}

// --- Milestones ------------------------------------------------------------
//
// Single-call extraction: the chosen model reads every provided URL and
// synthesizes a single plain-text milestones blob. Google models still get
// the `url_context` tool; non-Google models receive the URL list inline in
// the user message and must fetch via their own browsing capability (or
// fail loudly — this is opt-in per provider).

export async function extractMilestonesForInputs(input: {
  inputs: ContentInput[];
  specialtySlug: string;
  additionalInstructions?: string;
  runId: string;
  stage: StageName;
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<string> {
  log('pipeline').info('extractMilestonesForInputs', {
    specialtySlug: input.specialtySlug,
    inputs: input.inputs.length,
    model: input.model.model,
  });

  const system = composePrompt(
    DEFAULT_MILESTONES_SYSTEM_PROMPT,
    input.additionalInstructions,
  );
  const urlList = input.inputs.map((i) => `- ${i.url} (source: ${i.source})`).join('\n');
  const userMessage = `
You are extracting milestones for the medical specialty: ${input.specialtySlug}.

Please load and analyze the content at the following URL(s):
${urlList}

Extract all patient care and medical knowledge milestones from the document and return them as a structured ordered list.
`.trim();

  const resolved = resolveModel(input.model, input.apiKeys);

  await logEvent({
    runId: input.runId,
    stage: input.stage,
    level: 'info',
    message: `Milestones: extracting across ${input.inputs.length} input(s)`,
    metrics: {
      model: resolved.modelId,
      provider: resolved.provider,
      reasoning: input.model.reasoning,
      phase: 'milestones',
    },
  });

  const started = Date.now();
  try {
    const result = await generateText({
      model: resolved.sdkModel,
      system,
      prompt: userMessage,
      tools: googleUrlContextTool(input.model.provider),
      providerOptions: resolved.providerOptions,
      temperature: 1,
    });

    const milestones = result.text.trim();
    if (milestones.length === 0) {
      throw new Error('Model returned empty milestones output');
    }
    const durationMs = Date.now() - started;
    const usage = {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      reasoningTokens: result.usage?.reasoningTokens,
      cachedInputTokens: result.usage?.cachedInputTokens,
    };
    const costUsd = estimateCostUsd(resolved.modelId, usage);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Milestones done: ${milestones.length} chars`,
      metrics: {
        durationMs,
        ...usage,
        costUsd,
        model: resolved.modelId,
        phase: 'milestones',
        completion: milestones,
      },
    });
    return milestones;
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = errorMessage(e);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'error',
      message: `Milestones failed: ${msg}`,
      metrics: { durationMs, model: resolved.modelId, phase: 'milestones' },
    });
    throw e;
  }
}

/**
 * The Gemini `url_context` tool only exists on Google's provider. For
 * Anthropic / OpenAI we omit it and trust the model to use whichever
 * native browsing capability it has (or fail loudly when given a URL it
 * can't fetch). Returning `undefined` lets the AI SDK skip the tools field
 * entirely.
 */
function googleUrlContextTool(provider: string) {
  if (provider !== 'google') return undefined;
  return { url_context: google.tools.urlContext({}) };
}
