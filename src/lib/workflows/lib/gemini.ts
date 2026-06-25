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
import { generateText, type ModelMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type { CurriculumMeta } from '@/lib/types';
import { normalizeCurriculumMeta } from './curriculum-meta';
import type { StageName } from './db-writes';
import { logEvent } from './events';
import { uploadUrlToGemini } from './gemini-files';
import { type ModelSpec, type ProviderApiKeys, resolveModel } from './llm';
import { estimateCostUsd } from './pricing';
import {
  DEFAULT_CURRICULUM_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_CURRICULUM_IDENTIFY_SYSTEM_PROMPT,
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_IDENTIFY_SYSTEM_PROMPT,
  DEFAULT_MILESTONES_SYSTEM_PROMPT,
  DEFAULT_STUDENT_MILESTONES_SYSTEM_PROMPT,
} from './prompts';
import type { ContentInput } from './sources';

export {
  DEFAULT_CURRICULUM_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_CURRICULUM_IDENTIFY_SYSTEM_PROMPT,
  DEFAULT_EXTRACT_SYSTEM_PROMPT,
  DEFAULT_IDENTIFY_SYSTEM_PROMPT,
  DEFAULT_MILESTONES_SYSTEM_PROMPT,
  DEFAULT_STUDENT_MILESTONES_SYSTEM_PROMPT,
};

/**
 * Which prompt family the extraction steps use. `'curriculum'` swaps in the
 * curriculum-mapping prompts (year→phase→block hierarchy, time dimension,
 * student milestones); `'default'` keeps the clinical content-outline prompts.
 */
export type ExtractionVariant = 'default' | 'curriculum';

// --- shared schemas ---------------------------------------------------------

export const ExtractedCodeSchema = z.object({
  code: z.string(),
  category: z.string().optional(),
  consolidationCategory: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  metadata: z.unknown().optional(),
  // Curriculum-mapping time dimension; normalized upstream by
  // `normalizeCurriculumMeta` before it reaches here. Absent for other modes.
  curriculumMeta: z.custom<CurriculumMeta>().optional(),
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

// Curriculum-mapping extract element: codes carry a loosely-typed `curriculum`
// timing object. Every timing field is permissive (the model may emit numbers
// as strings) and `normalizeCurriculumMeta` does the real coercion. The whole
// `curriculum` object is `.catch(undefined)` so a malformed timing blob falls
// back to "no timing" rather than dropping the entire batch's array parse.
const CurriculumExtractElementSchema = z.object({
  category: z.string(),
  description: z.string(),
  curriculum: z
    .object({
      year: z.union([z.number(), z.string()]).nullish(),
      phase: z.string().nullish(),
      startMonth: z.union([z.string(), z.number()]).nullish(),
      endMonth: z.union([z.string(), z.number()]).nullish(),
      durationWeeks: z.union([z.number(), z.string()]).nullish(),
      durationLabel: z.string().nullish(),
      cadence: z.string().nullish(),
      learningObjective: z.string().nullish(),
      subtopics: z.array(z.string()).nullish(),
    })
    .passthrough()
    .nullish()
    .catch(undefined),
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

// --- Local-file uploads (so url_context-unreachable PDFs still work) ---------
//
// Gemini's `url_context` tool fetches URLs from Google's own servers, so a PDF
// served from a private/localhost address (e.g. an uploaded file at
// `http://localhost:8090/api/files/...`) is invisible to the model — it returns
// fabricated output. For those inputs we fetch the bytes server-side (we *can*
// reach localhost) and attach them as a Gemini Files API `fileData` part
// instead. Public URLs are left to `url_context`.

/** A PDF already uploaded to the Gemini Files API, ready to attach as a part. */
export type AttachedFile = { uri: string; mimeType: string };
/** url → attached Gemini file, for inputs we had to upload. */
export type InputFileMap = Map<string, AttachedFile>;

/**
 * True when Google's url_context could fetch this URL itself. Private hosts
 * (localhost, link-local, RFC-1918 ranges) and non-http(s) URLs are not
 * reachable and must be uploaded instead.
 */
function isPubliclyFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') {
    return false;
  }
  if (h.endsWith('.local')) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

/**
 * Pre-upload every input whose URL Google can't fetch to the Gemini Files API,
 * once per unique URL, returning a url → file map the identify/extract steps
 * attach as file parts. Google-only and best-effort: a failed upload simply
 * isn't in the map, so that input falls back to url_context (which then surfaces
 * the real failure rather than silently fabricating).
 */
export async function uploadLocalInputsToGemini(input: {
  inputs: ContentInput[];
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
  runId: string;
  stage: StageName;
}): Promise<InputFileMap> {
  const map: InputFileMap = new Map();
  if (input.model.provider !== 'google') return map;
  const apiKey = input.apiKeys.google;
  if (!apiKey) return map;

  const localUrls = [...new Set(input.inputs.map((i) => i.url))].filter(
    (u) => !isPubliclyFetchableUrl(u),
  );
  for (const url of localUrls) {
    try {
      const uploaded = await uploadUrlToGemini({
        apiKey,
        url,
        displayName: decodeURIComponent(url.split('/').pop() || 'document.pdf'),
      });
      map.set(url, { uri: uploaded.uri, mimeType: uploaded.mimeType });
      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'info',
        message: `Attached uploaded PDF directly to the model (url_context can't reach it): ${url}`,
      });
    } catch (e) {
      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'warn',
        message: `Could not attach local PDF (${url}); falling back to url_context: ${errorMessage(e)}`,
      });
    }
  }
  return map;
}

/**
 * The differing `generateText` args for the two source-delivery modes: an
 * attached Gemini file part (with no url_context tool) vs. a URL handed to
 * url_context. `system`, `providerOptions`, etc. are added by the caller.
 */
function sourceCallArgs(input: {
  userMessage: string;
  provider: string;
  file?: AttachedFile;
}):
  | { prompt: string; tools: ReturnType<typeof googleUrlContextTool> }
  | { messages: ModelMessage[] } {
  if (input.file) {
    return {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: input.userMessage },
            {
              type: 'file' as const,
              data: new URL(input.file.uri),
              mediaType: input.file.mimeType,
            },
          ],
        },
      ],
    };
  }
  return {
    prompt: input.userMessage,
    tools: googleUrlContextTool(input.provider),
  };
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
  variant?: ExtractionVariant;
  /** When set, the PDF is attached directly instead of via url_context. */
  file?: AttachedFile;
}): Promise<{ category: string }[]> {
  log('pipeline').info('identifyModulesForUrl', {
    specialtySlug: input.specialtySlug,
    url: input.url,
    source: input.source,
    model: input.model.model,
    variant: input.variant,
  });

  const isCurriculum = input.variant === 'curriculum';
  const system = composePrompt(
    isCurriculum
      ? DEFAULT_CURRICULUM_IDENTIFY_SYSTEM_PROMPT
      : DEFAULT_IDENTIFY_SYSTEM_PROMPT,
    input.additionalInstructions,
  );
  // Same user message for both variants — the curriculum behavior lives in the
  // system prompt (the curriculum identify prompt is the default verbatim).
  // When the PDF is attached directly, reference it instead of a URL.
  const userMessage = (
    input.file
      ? `
Please load and analyze the attached document.

Identify the base hierarchies in the document and return exclusively an output in JSON array format, with no other text.
`
      : `
Please load and analyze the content at the following URL(s):
${input.url}

Identify the base hierarchies in the document and return exclusively an output in JSON array format, with no other text.
`
  ).trim();

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
      ...sourceCallArgs({
        userMessage,
        provider: input.model.provider,
        file: input.file,
      }),
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
  variant?: ExtractionVariant;
  /** When set, the PDF is attached directly instead of via url_context. */
  file?: AttachedFile;
}): Promise<
  { category: string; description: string; curriculumMeta?: CurriculumMeta }[]
> {
  log('pipeline').info('extractCodesForCategory', {
    specialtySlug: input.specialtySlug,
    url: input.url,
    source: input.source,
    category: input.category,
    model: input.model.model,
    variant: input.variant,
  });

  const isCurriculum = input.variant === 'curriculum';
  const system = composePrompt(
    isCurriculum
      ? DEFAULT_CURRICULUM_EXTRACT_SYSTEM_PROMPT
      : DEFAULT_EXTRACT_SYSTEM_PROMPT,
    input.additionalInstructions,
  );
  // Same user message for both variants — the curriculum metadata requirement
  // lives in the system prompt (default extract prompt + curriculum addendum).
  // When the PDF is attached directly, reference it instead of a URL.
  const userMessage = (
    input.file
      ? `
You are extracting medical items for the medical specialty: ${input.specialtySlug}.

Please load and analyze the attached document.

Extract only codes in the chunk and do not invent any codes or descriptions that are not explicitly mentioned:
${input.category}

Extract all medical items from the document and return exclusively an output in JSON format, with no other text.
`
      : `
You are extracting medical items for the medical specialty: ${input.specialtySlug}.

Please load and analyze the content at the following URL(s):
${input.url}

Extract only codes in the chunk and do not invent any codes or descriptions that are not explicitly mentioned:
${input.category}

Extract all medical items from the document and return exclusively an output in JSON format, with no other text.
`
  ).trim();

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
      ...sourceCallArgs({
        userMessage,
        provider: input.model.provider,
        file: input.file,
      }),
      stopWhen: stepCountIs(MAX_STEPS),
      providerOptions: resolved.providerOptions,
      temperature: 1,
    });

    const codes: {
      category: string;
      description: string;
      curriculumMeta?: CurriculumMeta;
    }[] = isCurriculum
      ? parseJsonArray(result.text, CurriculumExtractElementSchema).map((el) => ({
          category: el.category,
          description: el.description,
          curriculumMeta: normalizeCurriculumMeta(el.curriculum),
        }))
      : parseJsonArray(result.text, ExtractCodesElementSchema);
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
  variant?: ExtractionVariant;
}): Promise<string> {
  log('pipeline').info('extractMilestonesForInputs', {
    specialtySlug: input.specialtySlug,
    inputs: input.inputs.length,
    model: input.model.model,
    variant: input.variant,
  });

  const isCurriculum = input.variant === 'curriculum';
  const system = composePrompt(
    isCurriculum
      ? DEFAULT_STUDENT_MILESTONES_SYSTEM_PROMPT
      : DEFAULT_MILESTONES_SYSTEM_PROMPT,
    input.additionalInstructions,
  );
  const urlList = input.inputs.map((i) => `- ${i.url} (source: ${i.source})`).join('\n');
  const userMessage = isCurriculum
    ? `
You are extracting medical-student milestones for the curriculum: ${input.specialtySlug}.

Please load and analyze the content at the following URL(s):
${urlList}

Extract the medical-student entrustable professional activities / competencies from the document and return them as the structured nested JSON described.
`.trim()
    : `
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
