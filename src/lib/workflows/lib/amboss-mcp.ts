/**
 * AMBOSS MCP-backed mapping step.
 *
 * Per-code attempt ladder, executed entirely inside one `"use step"` so a
 * crash retries the whole loop for just that code (each code is independent
 * and steps cache on return):
 *
 *   1. primary model       (no correction yet)
 *   2. primary model       + CORRECTION listing invalid IDs from attempt 1
 *   3. primary model       + cumulative CORRECTION
 *   4. backup model        (only when attempts 1-3 still produced invalid IDs)
 *
 * The user picks both `primary` and `backup` per-stage on the StageCard.
 * Validation: every cited `articleId` / `sectionId` in the LLM output is
 * checked against the local `amboss_articles` / `amboss_sections` catalog.
 * When `checkAgainstLibrary` is false, the ladder short-circuits after the
 * first well-formed parse — matching the user's "raw output" toggle behavior.
 */

import { createMCPClient } from '@ai-sdk/mcp';
import { generateText, type ToolSet } from 'ai';
import { z } from 'zod';
import { env } from '@/env';
import { listAmbossArticleIds, listAmbossSectionIds } from '@/lib/data/amboss-library';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type { CoveredSection } from '@/lib/pb/types';
import type { PipelineMode } from '@/lib/types';
import type { StageName } from './db-writes';
import { logEvent } from './events';
import { type ModelSpec, type ProviderApiKeys, resolveModel } from './llm';
import { estimateCostUsd } from './pricing';
import {
  applySuggestionVisibility,
  DEFAULT_CURRICULUM_MAPPING_SYSTEM_PROMPT,
  DEFAULT_MAPPING_SYSTEM_PROMPT,
  DEFAULT_MAPPING_USER_MESSAGE_TEMPLATE,
  DEFAULT_SUGGESTIONS_ONLY_SYSTEM_PROMPT,
  DEFAULT_SUGGESTIONS_ONLY_USER_TEMPLATE,
} from './prompts';

// ---------------------------------------------------------------------------
// Output schema (mirrors the n8n agent output).
// ---------------------------------------------------------------------------

const SectionsBlockSchema = z.union([
  // n8n output form: `{ "title": "id", "title2": "id2" }` (the inner object
  // is a map of section title → section ID).
  z.record(z.string(), z.string()),
  // Some models emit arrays of `{ sectionTitle, sectionId }`.
  z.array(
    z.object({
      sectionTitle: z.string().optional(),
      sectionId: z.string().optional(),
    }),
  ),
]);

const CoveredSectionSchema = z.object({
  articleTitle: z.string().optional(),
  articleId: z.string(),
  sections: SectionsBlockSchema.optional(),
});

const SectionUpdateSchema = z.object({
  articleTitle: z.string().optional(),
  articleId: z.string(),
  sections: z
    .array(
      z.object({
        sectionTitle: z.string().optional(),
        sectionId: z.string().optional(),
        exists: z.boolean().optional(),
        changes: z.string().optional(),
        importance: z.number().optional(),
      }),
    )
    .optional(),
});

const NewArticleSchema = z.object({
  articleTitle: z.string(),
  importance: z.number().optional(),
});

const MappingOutputSchema = z.object({
  code: z.string().optional(),
  description: z.string().optional(),
  coverage: z.object({
    inAMBOSS: z.boolean(),
    coveredSections: z.array(CoveredSectionSchema).default([]),
    generalNotes: z.string().optional().default(''),
    gaps: z.string().optional().default(''),
    coverageLevel: z.string().optional().default('none'),
    coverageScore: z.union([z.number(), z.string()]).optional(),
  }),
  suggestion: z
    .object({
      improvement: z.string().optional().default(''),
      sectionUpdates: z.array(SectionUpdateSchema).optional().default([]),
      newArticlesNeeded: z.array(NewArticleSchema).optional().default([]),
    })
    .optional()
    .default({ improvement: '', sectionUpdates: [], newArticlesNeeded: [] }),
  currentAMBOSSContentMetadata: z.unknown().optional(),
});

export type MappingOutput = z.infer<typeof MappingOutputSchema>;

// The suggestion-only pass returns just the `suggestion` block — coverage is
// supplied as input and merged back in before validation.
const SuggestionOnlyOutputSchema = z.object({
  suggestion: z
    .object({
      improvement: z.string().optional().default(''),
      sectionUpdates: z.array(SectionUpdateSchema).optional().default([]),
      newArticlesNeeded: z.array(NewArticleSchema).optional().default([]),
    })
    .optional()
    .default({ improvement: '', sectionUpdates: [], newArticlesNeeded: [] }),
});

export type MappingResult = {
  mapping: MappingOutput;
  attempts: number;
  model: string;
  invalidIds: string[];
  /** `true` when every attempt in the ladder still produced invalid IDs. The
   *  mapping is still written through (last attempt's output) but the stage
   *  summary surfaces the count. */
  unresolved: boolean;
};

/** The stored coverage fed into the suggestion-only pass (never recomputed). */
export type SuggestionCoverageInput = {
  isInAMBOSS?: boolean;
  coverageLevel?: string | null;
  depthOfCoverage?: number;
  notes?: string | null;
  gaps?: string | null;
  articlesWhereCoverageIs: CoveredSection[];
};

export function hasMappingCreds(): boolean {
  return Boolean(env.AMBOSS_MCP_URL && env.AMBOSS_MCP_TOKEN);
}

// ---------------------------------------------------------------------------
// JSON extraction: the prompt asks for bare JSON but occasionally the model
// fences or prepends prose. Strip fences and trim to the outermost braces.
// ---------------------------------------------------------------------------

export function parseAgentJson(raw: string): unknown {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const text = (fenceMatch ? fenceMatch[1] : raw).trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) {
    throw new Error(`Model response had no JSON object: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(first, last + 1));
}

// ---------------------------------------------------------------------------
// Walk the parsed mapping and collect every article/section ID it cites. Used
// both for validation (caller intersects against known ID sets) and for the
// metrics rolled into the event log.
// ---------------------------------------------------------------------------

function collectCitedIds(mapping: MappingOutput): {
  articleIds: string[];
  sectionIds: string[];
} {
  const articleIds = new Set<string>();
  const sectionIds = new Set<string>();
  for (const cs of mapping.coverage.coveredSections ?? []) {
    if (cs.articleId) articleIds.add(cs.articleId);
    const s = cs.sections;
    if (s && !Array.isArray(s)) {
      for (const id of Object.values(s)) if (id) sectionIds.add(id);
    } else if (Array.isArray(s)) {
      for (const sec of s) if (sec.sectionId) sectionIds.add(sec.sectionId);
    }
  }
  for (const upd of mapping.suggestion.sectionUpdates ?? []) {
    if (upd.articleId) articleIds.add(upd.articleId);
    for (const s of upd.sections ?? []) if (s.sectionId) sectionIds.add(s.sectionId);
  }
  return { articleIds: [...articleIds], sectionIds: [...sectionIds] };
}

export function validateMappingIds(
  mapping: MappingOutput,
  articleSet: Set<string>,
  sectionSet: Set<string>,
): string[] {
  const { articleIds, sectionIds } = collectCitedIds(mapping);
  const invalid: string[] = [];
  for (const id of articleIds) if (!articleSet.has(id)) invalid.push(id);
  for (const id of sectionIds) if (!sectionSet.has(id)) invalid.push(id);
  return [...new Set(invalid)];
}

// ---------------------------------------------------------------------------
// Prompt helpers.
// ---------------------------------------------------------------------------

function composeSystem(
  milestones: string,
  additional?: string,
  includeSuggestions = true,
  pipelineMode?: PipelineMode,
): string {
  // Curriculum-mapping specialties score AMBOSS coverage on the year-based
  // student scale, so they use a dedicated prompt (no suggestion block); every
  // other mode uses the clinician none→specialist prompt.
  const template =
    pipelineMode === 'curriculum-mapping'
      ? DEFAULT_CURRICULUM_MAPPING_SYSTEM_PROMPT
      : DEFAULT_MAPPING_SYSTEM_PROMPT;
  // The system-prompt source contains a literal `${milestones}` placeholder
  // we substitute at runtime — the string on the next line is deliberate. The
  // suggestion-specific spans are then kept or dropped per `includeSuggestions`
  // (mapping-only specialties run coverage only; the curriculum prompt has no
  // such spans, so `applySuggestionVisibility` is a no-op tidy there).
  const base = applySuggestionVisibility(
    template.replace(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
      '${milestones}',
      milestones || 'N/A',
    ),
    includeSuggestions,
  );
  const extra = additional?.trim();
  if (!extra) return base;
  return `${base}\n\n## Additional instructions\n\n${extra}`;
}

function composeSuggestionsSystem(milestones: string, additional?: string): string {
  const base = DEFAULT_SUGGESTIONS_ONLY_SYSTEM_PROMPT.replace(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
    '${milestones}',
    milestones || 'N/A',
  );
  const extra = additional?.trim();
  if (!extra) return base;
  return `${base}\n\n## Additional instructions\n\n${extra}`;
}

function composeUser(input: {
  specialty: string;
  code: string;
  codeCategory: string;
  description: string;
  contentBase: string;
  language: string;
}): string {
  // Same deal: the user-message template contains literal `${...}` tokens that
  // we substitute by name. Each replaceAll target is a deliberate placeholder.
  /* biome-ignore-start lint/suspicious/noTemplateCurlyInString: intentional placeholder */
  return DEFAULT_MAPPING_USER_MESSAGE_TEMPLATE.replaceAll('${specialty}', input.specialty)
    .replaceAll('${code}', input.code)
    .replaceAll('${codeCategory}', input.codeCategory)
    .replaceAll('${description}', input.description)
    .replaceAll('${contentBase}', input.contentBase)
    .replaceAll('${language}', input.language);
  /* biome-ignore-end lint/suspicious/noTemplateCurlyInString: intentional placeholder */
}

/** Render the stored coverage as a compact block for the suggestion prompt. */
function renderKnownCoverage(coverage: SuggestionCoverageInput): string {
  const lines: string[] = [
    `- In AMBOSS: ${coverage.isInAMBOSS ? 'yes' : 'no'}`,
    `- Coverage level: ${coverage.coverageLevel || 'none'}`,
  ];
  if (typeof coverage.depthOfCoverage === 'number') {
    lines.push(`- Coverage score (0-5): ${coverage.depthOfCoverage}`);
  }
  if (coverage.notes) lines.push(`- General notes: ${coverage.notes}`);
  if (coverage.gaps) lines.push(`- Gaps: ${coverage.gaps}`);
  const covered = coverage.articlesWhereCoverageIs ?? [];
  if (covered.length > 0) {
    lines.push('- Already covered in:');
    for (const cs of covered) {
      const sectionLabel = (cs.sections ?? [])
        .map((s) => s.sectionTitle)
        .filter(Boolean)
        .join(', ');
      lines.push(
        `  - ${cs.articleTitle ?? cs.articleId ?? '(article)'}${sectionLabel ? ` (sections: ${sectionLabel})` : ''}`,
      );
    }
  } else {
    lines.push('- Already covered in: (none)');
  }
  return lines.join('\n');
}

function composeSuggestionsUser(input: {
  specialty: string;
  code: string;
  codeCategory: string;
  description: string;
  contentBase: string;
  language: string;
  coverage: SuggestionCoverageInput;
}): string {
  /* biome-ignore-start lint/suspicious/noTemplateCurlyInString: intentional placeholder */
  return DEFAULT_SUGGESTIONS_ONLY_USER_TEMPLATE.replaceAll(
    '${specialty}',
    input.specialty,
  )
    .replaceAll('${code}', input.code)
    .replaceAll('${codeCategory}', input.codeCategory)
    .replaceAll('${description}', input.description)
    .replaceAll('${contentBase}', input.contentBase)
    .replaceAll('${language}', input.language)
    .replaceAll('${knownCoverage}', renderKnownCoverage(input.coverage));
  /* biome-ignore-end lint/suspicious/noTemplateCurlyInString: intentional placeholder */
}

function correctionMessage(invalidIds: string[]): string {
  return [
    '',
    '**CORRECTION**',
    `Your previous response cited these IDs that do not exist in the AMBOSS content library: ${JSON.stringify(invalidIds)}.`,
    'Do not cite any IDs outside of what MCP tool responses return. Re-run your MCP queries and only emit IDs you have verified via `get_sections`.',
    'Remember: IDs starting with Y or Z are subsection IDs — never return those as section IDs.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Single model call. Isolated so the attempt loop just swaps model IDs.
// ---------------------------------------------------------------------------

export async function runAgentAttempt(params: {
  spec: ModelSpec;
  apiKeys: ProviderApiKeys;
  system: string;
  userMessage: string;
  tools: ToolSet;
}): Promise<{
  text: string;
  usage: ReturnType<typeof pickUsage>;
  mcp: { calls: number; toolNames: string[] };
  modelId: string;
}> {
  const { spec, apiKeys, system, userMessage, tools } = params;
  const resolved = resolveModel(spec, apiKeys);
  const result = await generateText({
    model: resolved.sdkModel,
    system,
    prompt: userMessage,
    tools,
    stopWhen: ({ steps }: { steps: Array<unknown> }) => steps.length >= 20,
    temperature: 1,
    providerOptions: resolved.providerOptions,
  });
  return {
    text: result.text,
    usage: pickUsage(result.usage),
    mcp: pickMcp(result),
    modelId: resolved.modelId,
  };
}

/**
 * Count MCP tool invocations across all reasoning steps. The AI SDK exposes
 * each round-trip as a `step` with its own `toolCalls`; the top-level
 * `result.toolCalls` only carries the final step's calls. We unique-name them
 * so the modal can show "search_article_sections ×3, get_sections ×8" rather
 * than just a total. Defensively typed because the AI SDK shape isn't
 * guaranteed to be stable across versions and we'd rather drop the metric
 * than crash the workflow.
 */
export function pickMcp(result: unknown): { calls: number; toolNames: string[] } {
  try {
    const steps = (
      result as { steps?: Array<{ toolCalls?: Array<{ toolName?: string }> }> }
    )?.steps;
    if (!Array.isArray(steps)) return { calls: 0, toolNames: [] };
    const names: string[] = [];
    for (const step of steps) {
      for (const call of step.toolCalls ?? []) {
        if (call?.toolName) names.push(call.toolName);
      }
    }
    return { calls: names.length, toolNames: names };
  } catch {
    return { calls: 0, toolNames: [] };
  }
}

export function pickUsage(
  u:
    | {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        cachedInputTokens?: number;
      }
    | undefined,
) {
  return {
    inputTokens: u?.inputTokens,
    outputTokens: u?.outputTokens,
    reasoningTokens: u?.reasoningTokens,
    cachedInputTokens: u?.cachedInputTokens,
  };
}

// ---------------------------------------------------------------------------
// Public step: attempt ladder + validation + single DB-ready MappingResult.
// ---------------------------------------------------------------------------

export async function mapAndValidateCode(input: {
  code: string;
  description: string;
  category: string;
  specialty: string;
  contentBase: string;
  language: string;
  milestones: string;
  additionalInstructions?: string;
  /** When false (mapping-only specialties) the suggestion portion of the
   *  prompt is dropped, so the model returns coverage only. */
  includeSuggestions?: boolean;
  /** Selects the mapping prompt variant. `'curriculum-mapping'` scores coverage
   *  on the year-based student scale; everything else uses the clinician scale. */
  pipelineMode?: PipelineMode;
  checkAgainstLibrary: boolean;
  runId: string;
  stage: StageName;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<MappingResult> {
  log('pipeline').info('mapAndValidateCode', {
    code: input.code,
    checkAgainstLibrary: input.checkAgainstLibrary,
    primary: input.primaryModel.model,
    backup: input.backupModel.model,
    stubbed: !hasMappingCreds(),
  });

  // Stub path: no MCP creds → return a canned "not covered" result. Lets the
  // workflow be exercised end-to-end without backend access.
  if (!hasMappingCreds()) {
    const stub: MappingOutput = {
      code: input.code,
      description: input.description,
      coverage: {
        inAMBOSS: false,
        coveredSections: [],
        generalNotes: 'stubbed (no AMBOSS MCP creds)',
        gaps: '',
        coverageLevel: 'none',
        coverageScore: 0,
      },
      suggestion: {
        improvement: '',
        sectionUpdates: [],
        newArticlesNeeded: [],
      },
    };
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Map (stub): ${input.code}`,
      metrics: {
        phase: 'map',
        completion: stub,
        model: 'stub',
      },
    });
    return {
      mapping: stub,
      attempts: 0,
      model: 'stub',
      invalidIds: [],
      unresolved: false,
    };
  }

  // Establish an MCP client once per code. Tools discovered from the server
  // are handed straight to `generateText` — the agent decides when to call
  // them during the response.
  const mcpUrl = env.AMBOSS_MCP_URL;
  const mcpToken = env.AMBOSS_MCP_TOKEN;
  if (!mcpUrl || !mcpToken) {
    throw new Error('AMBOSS_MCP_URL and AMBOSS_MCP_TOKEN must be set');
  }
  const mcp = await createMCPClient({
    transport: {
      type: 'http',
      url: mcpUrl,
      headers: { Authorization: `Bearer ${mcpToken}` },
    },
  });
  const allTools = await mcp.tools();
  // Expose only the three tools the n8n agent used. Keeps the model focused
  // and avoids the agent discovering prompts/resources that aren't expected.
  const toolNames = ['search_article_sections', 'get_article', 'get_sections'];
  const tools: ToolSet = {};
  for (const name of toolNames) {
    if (name in allTools) tools[name] = allTools[name];
  }

  const articleSet = input.checkAgainstLibrary
    ? await listAmbossArticleIds()
    : new Set<string>();
  const sectionSet = input.checkAgainstLibrary
    ? await listAmbossSectionIds()
    : new Set<string>();

  const system = composeSystem(
    input.milestones,
    input.additionalInstructions,
    input.includeSuggestions ?? true,
    input.pipelineMode,
  );
  const userBase = composeUser({
    specialty: input.specialty,
    code: input.code,
    codeCategory: input.category,
    description: input.description,
    contentBase: input.contentBase,
    language: input.language,
  });

  // Three primary attempts (with cumulative correction messages on retries 2
  // and 3) followed by a single backup attempt — only reached if the primary
  // still produced invalid IDs after correction.
  const ladder: Array<{ spec: ModelSpec; label: string }> = [
    { spec: input.primaryModel, label: 'primary-1' },
    { spec: input.primaryModel, label: 'primary-2' },
    { spec: input.primaryModel, label: 'primary-3' },
    { spec: input.backupModel, label: 'backup' },
  ];

  let cumulativeInvalid: string[] = [];
  let lastMapping: MappingOutput | null = null;
  let lastModel = input.primaryModel.model;
  let attempts = 0;

  const started = Date.now();
  try {
    for (const step of ladder) {
      attempts += 1;
      const modelId = step.spec.model;
      lastModel = modelId;

      const userMessage =
        cumulativeInvalid.length === 0
          ? userBase
          : `${userBase}\n\n${correctionMessage(cumulativeInvalid)}`;

      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'info',
        message:
          cumulativeInvalid.length === 0
            ? `Map attempt ${attempts} (${step.label}): ${input.code}`
            : `Map attempt ${attempts} (${step.label}, ${cumulativeInvalid.length} invalid IDs): ${input.code}`,
        metrics: {
          phase: 'map',
          model: modelId,
          provider: step.spec.provider,
          reasoning: step.spec.reasoning,
          code: input.code,
          invalidIds: cumulativeInvalid,
        },
      });

      const result = await runAgentAttempt({
        spec: step.spec,
        apiKeys: input.apiKeys,
        system,
        userMessage,
        tools,
      });

      const durationMs = Date.now() - started;
      let parsed: MappingOutput;
      try {
        parsed = MappingOutputSchema.parse(parseAgentJson(result.text));
      } catch (e) {
        const msg = errorMessage(e);
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'warn',
          message: `Map attempt ${attempts} (${step.label}) parse failed for ${input.code}: ${msg}`,
          metrics: { phase: 'map', model: lastModel, code: input.code, durationMs },
        });
        cumulativeInvalid = ['<malformed JSON>'];
        continue;
      }
      lastMapping = parsed;

      if (!input.checkAgainstLibrary) {
        // Toggle off: accept the first well-formed parse and stop.
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'info',
          message: `Map done (no validation): ${input.code}`,
          metrics: {
            phase: 'map',
            model: lastModel,
            code: input.code,
            completion: parsed,
            durationMs,
            ...result.usage,
            costUsd: estimateCostUsd(lastModel, result.usage),
            attempts,
            mcpToolCalls: result.mcp.calls,
            mcpToolNames: result.mcp.toolNames,
          },
        });
        return {
          mapping: parsed,
          attempts,
          model: lastModel,
          invalidIds: [],
          unresolved: false,
        };
      }

      const invalid = validateMappingIds(parsed, articleSet, sectionSet);
      if (invalid.length === 0) {
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'info',
          message: `Map validated: ${input.code}`,
          metrics: {
            phase: 'map',
            model: lastModel,
            code: input.code,
            completion: parsed,
            durationMs,
            ...result.usage,
            costUsd: estimateCostUsd(lastModel, result.usage),
            attempts,
            mcpToolCalls: result.mcp.calls,
            mcpToolNames: result.mcp.toolNames,
          },
        });
        return {
          mapping: parsed,
          attempts,
          model: lastModel,
          invalidIds: [],
          unresolved: false,
        };
      }

      cumulativeInvalid = invalid;
      // Continue the ladder; parse was valid but IDs aren't.
    }

    // Ladder exhausted. Write through the last mapping with unresolved flag.
    const durationMs = Date.now() - started;
    if (!lastMapping) {
      throw new Error('All attempts produced unparseable output');
    }
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'warn',
      message: `Map unresolved after ${attempts} attempts: ${input.code} · ${cumulativeInvalid.length} invalid IDs`,
      metrics: {
        phase: 'map',
        model: lastModel,
        code: input.code,
        completion: lastMapping,
        invalidIds: cumulativeInvalid,
        durationMs,
        attempts,
      },
    });
    return {
      mapping: lastMapping,
      attempts,
      model: lastModel,
      invalidIds: cumulativeInvalid,
      unresolved: true,
    };
  } finally {
    try {
      await mcp.close();
    } catch {
      // non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Suggestion-only pass ("Generate suggestions" backfill). Mirrors
// mapAndValidateCode's attempt ladder, but the system/user prompts focus on
// suggestions and carry the previously-computed coverage as input. Coverage is
// never recomputed; only the suggestion IDs are validated. Returns a
// MappingResult whose `mapping.suggestion` is the part to persist.
// ---------------------------------------------------------------------------

export async function generateSuggestionsForCode(input: {
  code: string;
  description: string;
  category: string;
  specialty: string;
  contentBase: string;
  language: string;
  milestones: string;
  additionalInstructions?: string;
  checkAgainstLibrary: boolean;
  coverage: SuggestionCoverageInput;
  runId: string;
  stage: StageName;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<MappingResult> {
  log('pipeline').info('generateSuggestionsForCode', {
    code: input.code,
    checkAgainstLibrary: input.checkAgainstLibrary,
    primary: input.primaryModel.model,
    backup: input.backupModel.model,
    stubbed: !hasMappingCreds(),
  });

  // Assemble a MappingOutput from the model's suggestion block. Coverage is
  // left empty here on purpose — it's not persisted from this pass, and
  // keeping it empty means validateMappingIds only checks the *suggestion* IDs
  // (the stored coverage IDs were already validated by the mapping step).
  const assemble = (parsed: unknown): MappingOutput => {
    const sug = SuggestionOnlyOutputSchema.parse(parsed);
    return {
      code: input.code,
      coverage: {
        inAMBOSS: input.coverage.isInAMBOSS ?? false,
        coveredSections: [],
        generalNotes: '',
        gaps: '',
        coverageLevel: input.coverage.coverageLevel ?? 'none',
      },
      suggestion: sug.suggestion,
    };
  };

  // Stub path: no MCP creds → return empty suggestions so the workflow can be
  // exercised end-to-end without backend access.
  if (!hasMappingCreds()) {
    const stub = assemble({
      suggestion: { improvement: '', sectionUpdates: [], newArticlesNeeded: [] },
    });
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Suggest (stub): ${input.code}`,
      metrics: { phase: 'map', completion: stub, model: 'stub' },
    });
    return {
      mapping: stub,
      attempts: 0,
      model: 'stub',
      invalidIds: [],
      unresolved: false,
    };
  }

  const mcpUrl = env.AMBOSS_MCP_URL;
  const mcpToken = env.AMBOSS_MCP_TOKEN;
  if (!mcpUrl || !mcpToken) {
    throw new Error('AMBOSS_MCP_URL and AMBOSS_MCP_TOKEN must be set');
  }
  const mcp = await createMCPClient({
    transport: {
      type: 'http',
      url: mcpUrl,
      headers: { Authorization: `Bearer ${mcpToken}` },
    },
  });
  const allTools = await mcp.tools();
  const toolNames = ['search_article_sections', 'get_article', 'get_sections'];
  const tools: ToolSet = {};
  for (const name of toolNames) {
    if (name in allTools) tools[name] = allTools[name];
  }

  const articleSet = input.checkAgainstLibrary
    ? await listAmbossArticleIds()
    : new Set<string>();
  const sectionSet = input.checkAgainstLibrary
    ? await listAmbossSectionIds()
    : new Set<string>();

  const system = composeSuggestionsSystem(input.milestones, input.additionalInstructions);
  const userBase = composeSuggestionsUser({
    specialty: input.specialty,
    code: input.code,
    codeCategory: input.category,
    description: input.description,
    contentBase: input.contentBase,
    language: input.language,
    coverage: input.coverage,
  });

  const ladder: Array<{ spec: ModelSpec; label: string }> = [
    { spec: input.primaryModel, label: 'primary-1' },
    { spec: input.primaryModel, label: 'primary-2' },
    { spec: input.primaryModel, label: 'primary-3' },
    { spec: input.backupModel, label: 'backup' },
  ];

  let cumulativeInvalid: string[] = [];
  let lastMapping: MappingOutput | null = null;
  let lastModel = input.primaryModel.model;
  let attempts = 0;

  const started = Date.now();
  try {
    for (const step of ladder) {
      attempts += 1;
      const modelId = step.spec.model;
      lastModel = modelId;

      const userMessage =
        cumulativeInvalid.length === 0
          ? userBase
          : `${userBase}\n\n${correctionMessage(cumulativeInvalid)}`;

      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'info',
        message:
          cumulativeInvalid.length === 0
            ? `Suggest attempt ${attempts} (${step.label}): ${input.code}`
            : `Suggest attempt ${attempts} (${step.label}, ${cumulativeInvalid.length} invalid IDs): ${input.code}`,
        metrics: {
          phase: 'map',
          model: modelId,
          provider: step.spec.provider,
          reasoning: step.spec.reasoning,
          code: input.code,
          invalidIds: cumulativeInvalid,
        },
      });

      const result = await runAgentAttempt({
        spec: step.spec,
        apiKeys: input.apiKeys,
        system,
        userMessage,
        tools,
      });

      const durationMs = Date.now() - started;
      let parsed: MappingOutput;
      try {
        parsed = assemble(parseAgentJson(result.text));
      } catch (e) {
        const msg = errorMessage(e);
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'warn',
          message: `Suggest attempt ${attempts} (${step.label}) parse failed for ${input.code}: ${msg}`,
          metrics: { phase: 'map', model: lastModel, code: input.code, durationMs },
        });
        cumulativeInvalid = ['<malformed JSON>'];
        continue;
      }
      lastMapping = parsed;

      if (!input.checkAgainstLibrary) {
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'info',
          message: `Suggest done (no validation): ${input.code}`,
          metrics: {
            phase: 'map',
            model: lastModel,
            code: input.code,
            completion: parsed,
            durationMs,
            ...result.usage,
            costUsd: estimateCostUsd(lastModel, result.usage),
            attempts,
            mcpToolCalls: result.mcp.calls,
            mcpToolNames: result.mcp.toolNames,
          },
        });
        return {
          mapping: parsed,
          attempts,
          model: lastModel,
          invalidIds: [],
          unresolved: false,
        };
      }

      const invalid = validateMappingIds(parsed, articleSet, sectionSet);
      if (invalid.length === 0) {
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'info',
          message: `Suggest validated: ${input.code}`,
          metrics: {
            phase: 'map',
            model: lastModel,
            code: input.code,
            completion: parsed,
            durationMs,
            ...result.usage,
            costUsd: estimateCostUsd(lastModel, result.usage),
            attempts,
            mcpToolCalls: result.mcp.calls,
            mcpToolNames: result.mcp.toolNames,
          },
        });
        return {
          mapping: parsed,
          attempts,
          model: lastModel,
          invalidIds: [],
          unresolved: false,
        };
      }

      cumulativeInvalid = invalid;
    }

    const durationMs = Date.now() - started;
    if (!lastMapping) {
      throw new Error('All attempts produced unparseable output');
    }
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'warn',
      message: `Suggest unresolved after ${attempts} attempts: ${input.code} · ${cumulativeInvalid.length} invalid IDs`,
      metrics: {
        phase: 'map',
        model: lastModel,
        code: input.code,
        completion: lastMapping,
        invalidIds: cumulativeInvalid,
        durationMs,
        attempts,
      },
    });
    return {
      mapping: lastMapping,
      attempts,
      model: lastModel,
      invalidIds: cumulativeInvalid,
      unresolved: true,
    };
  } finally {
    try {
      await mcp.close();
    } catch {
      // non-fatal
    }
  }
}
