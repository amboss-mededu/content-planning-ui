/**
 * Clinical-guidelines mapping step — the second mapping source.
 *
 * A SEPARATE agent from the AMBOSS mapper (`amboss-mcp.ts`) so the two sources
 * never cross-contaminate (the user's main concern). It runs against the SAME
 * AMBOSS MCP server but exposes ONLY the `get_guidelines` tool, and uses the
 * same coverage rubric so guideline scores are comparable to AMBOSS scores.
 *
 * Differences from the AMBOSS ladder:
 *   - No library-ID validation (there is no guideline catalog to check
 *     against) — the first well-formed JSON parse is accepted. The ladder is
 *     retained only to retry parse failures.
 *   - No suggestion block — guidelines don't feed the article/section pipeline.
 *
 * Also hosts `synthesizeOverallCoverage`, the cheap no-tools step that
 * reconciles AMBOSS + guideline coverage into an "overall" verdict (source =
 * 'both' only).
 */

import { createMCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { env } from '@/env';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import { hasMappingCreds, parseAgentJson, runAgentAttempt } from './amboss-mcp';
import type { StageName } from './db-writes';
import { logEvent } from './events';
import type { ModelSpec, ProviderApiKeys } from './llm';
import { estimateCostUsd } from './pricing';
import {
  DEFAULT_GUIDELINES_SYSTEM_PROMPT,
  DEFAULT_GUIDELINES_USER_MESSAGE_TEMPLATE,
  DEFAULT_OVERALL_SYNTHESIS_SYSTEM_PROMPT,
  DEFAULT_OVERALL_SYNTHESIS_USER_TEMPLATE,
} from './prompts';

// ---------------------------------------------------------------------------
// Output schema (modelled defensively — confirm against the real
// `get_guidelines` shape via scripts/probe-guidelines.ts).
// ---------------------------------------------------------------------------

const GuidelineRecsBlockSchema = z.union([
  // `{ "rec title": "rec id" }`
  z.record(z.string(), z.string()),
  z.array(
    z.object({
      recommendationTitle: z.string().optional(),
      recommendationId: z.string().optional(),
    }),
  ),
]);

const GuidelineCoverageRefSchema = z.object({
  guidelineTitle: z.string().optional(),
  guidelineId: z.string().optional(),
  organization: z.string().optional(),
  year: z.union([z.number(), z.string()]).optional(),
  recommendations: GuidelineRecsBlockSchema.optional(),
});

export const GuidelineOutputSchema = z.object({
  code: z.string().optional(),
  description: z.string().optional(),
  coverage: z.object({
    inGuidelines: z.boolean(),
    coveredGuidelines: z.array(GuidelineCoverageRefSchema).default([]),
    generalNotes: z.string().optional().default(''),
    gaps: z.string().optional().default(''),
    coverageLevel: z.string().optional().default('none'),
    coverageScore: z.union([z.number(), z.string()]).optional(),
  }),
});

export type GuidelineOutput = z.infer<typeof GuidelineOutputSchema>;
/** The agent's coverage block (distinct from the stored per-guideline
 *  `GuidelineCoverage` ref in `pb/types`). */
export type GuidelineCoverageBlock = GuidelineOutput['coverage'];

export type GuidelineMappingResult = {
  mapping: GuidelineOutput;
  attempts: number;
  model: string;
  /** `true` when every attempt produced unparseable output (written through as
   *  a "none" result rather than failing the code's AMBOSS mapping). */
  unresolved: boolean;
};

const OverallSynthesisSchema = z.object({
  overall: z.object({
    coverageLevel: z.string().optional().default('none'),
    coverageScore: z.union([z.number(), z.string()]).optional().default(0),
    rationale: z.string().optional().default(''),
  }),
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const SCORE_TO_LEVEL = [
  'none',
  'medical-student',
  'early-resident',
  'advanced-resident',
  'attending',
  'specialist',
] as const;

export function coerceScore(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function levelFromScore(score: number): string {
  const i = Math.min(5, Math.max(0, Math.round(score)));
  return SCORE_TO_LEVEL[i];
}

function composeGuidelinesSystem(milestones: string, additional?: string): string {
  const base = DEFAULT_GUIDELINES_SYSTEM_PROMPT.replace(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
    '${milestones}',
    milestones || 'N/A',
  );
  const extra = additional?.trim();
  if (!extra) return base;
  return `${base}\n\n## Additional instructions\n\n${extra}`;
}

function composeGuidelinesUser(input: {
  specialty: string;
  code: string;
  codeCategory: string;
  description: string;
  contentBase: string;
  language: string;
}): string {
  /* biome-ignore-start lint/suspicious/noTemplateCurlyInString: intentional placeholder */
  return DEFAULT_GUIDELINES_USER_MESSAGE_TEMPLATE.replaceAll(
    '${specialty}',
    input.specialty,
  )
    .replaceAll('${code}', input.code)
    .replaceAll('${codeCategory}', input.codeCategory)
    .replaceAll('${description}', input.description)
    .replaceAll('${contentBase}', input.contentBase)
    .replaceAll('${language}', input.language);
  /* biome-ignore-end lint/suspicious/noTemplateCurlyInString: intentional placeholder */
}

function stubGuidelineMapping(code: string, description: string): GuidelineOutput {
  return {
    code,
    description,
    coverage: {
      inGuidelines: false,
      coveredGuidelines: [],
      generalNotes: 'stubbed (no AMBOSS MCP creds / get_guidelines tool)',
      gaps: '',
      coverageLevel: 'none',
      coverageScore: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Public step: per-code guideline coverage.
// ---------------------------------------------------------------------------

export async function mapGuidelinesForCode(input: {
  code: string;
  description: string;
  category: string;
  specialty: string;
  contentBase: string;
  language: string;
  milestones: string;
  additionalInstructions?: string;
  runId: string;
  stage: StageName;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<GuidelineMappingResult> {
  log('pipeline').info('mapGuidelinesForCode', {
    code: input.code,
    primary: input.primaryModel.model,
    backup: input.backupModel.model,
    stubbed: !hasMappingCreds(),
  });

  // Stub path: no MCP creds → canned "not in guidelines" result.
  if (!hasMappingCreds()) {
    const stub = stubGuidelineMapping(input.code, input.description);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Guidelines (stub): ${input.code}`,
      metrics: { phase: 'map_guidelines', completion: stub, model: 'stub' },
    });
    return { mapping: stub, attempts: 0, model: 'stub', unresolved: false };
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

  try {
    const allTools = await mcp.tools();
    // Prefer the documented name; tolerate a renamed tool (R1) by matching
    // /guideline/i. If absent, fail soft so the run never crashes.
    const guidelineToolName =
      'get_guidelines' in allTools
        ? 'get_guidelines'
        : Object.keys(allTools).find((n) => n.toLowerCase().includes('guideline'));
    if (!guidelineToolName) {
      const none = stubGuidelineMapping(input.code, input.description);
      none.coverage.generalNotes = 'get_guidelines tool not exposed by the MCP server';
      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'warn',
        message: `Guidelines skipped — get_guidelines tool not found: ${input.code}`,
        metrics: { phase: 'map_guidelines', code: input.code },
      });
      return { mapping: none, attempts: 0, model: 'none', unresolved: true };
    }
    const tools: ToolSet = { [guidelineToolName]: allTools[guidelineToolName] };

    const system = composeGuidelinesSystem(
      input.milestones,
      input.additionalInstructions,
    );
    const userMessage = composeGuidelinesUser({
      specialty: input.specialty,
      code: input.code,
      codeCategory: input.category,
      description: input.description,
      contentBase: input.contentBase,
      language: input.language,
    });

    // Ladder: two primary attempts + one backup, retried only on parse
    // failure (no ID validation for guidelines).
    const ladder: Array<{ spec: ModelSpec; label: string }> = [
      { spec: input.primaryModel, label: 'primary-1' },
      { spec: input.primaryModel, label: 'primary-2' },
      { spec: input.backupModel, label: 'backup' },
    ];

    let attempts = 0;
    let lastModel = input.primaryModel.model;
    const started = Date.now();

    for (const step of ladder) {
      attempts += 1;
      lastModel = step.spec.model;
      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'info',
        message: `Guidelines attempt ${attempts} (${step.label}): ${input.code}`,
        metrics: {
          phase: 'map_guidelines',
          model: step.spec.model,
          provider: step.spec.provider,
          reasoning: step.spec.reasoning,
          code: input.code,
        },
      });

      let result: Awaited<ReturnType<typeof runAgentAttempt>>;
      try {
        result = await runAgentAttempt({
          spec: step.spec,
          apiKeys: input.apiKeys,
          system,
          userMessage,
          tools,
        });
      } catch (e) {
        // Timeout/abort (hung MCP or provider) or transport error — log and
        // fall through to the next rung instead of rejecting the batch.
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'warn',
          message: `Guidelines attempt ${attempts} (${step.label}) agent call failed for ${input.code}: ${errorMessage(e)}`,
          metrics: { phase: 'map_guidelines', model: lastModel, code: input.code },
        });
        continue;
      }
      const durationMs = Date.now() - started;

      let parsed: GuidelineOutput;
      try {
        parsed = GuidelineOutputSchema.parse(parseAgentJson(result.text));
      } catch (e) {
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'warn',
          message: `Guidelines attempt ${attempts} (${step.label}) parse failed for ${input.code}: ${errorMessage(e)}`,
          metrics: {
            phase: 'map_guidelines',
            model: lastModel,
            code: input.code,
            durationMs,
          },
        });
        continue;
      }

      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'info',
        message: `Guidelines done: ${input.code}`,
        metrics: {
          phase: 'map_guidelines',
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
      return { mapping: parsed, attempts, model: lastModel, unresolved: false };
    }

    // Every attempt failed to parse — write through a "none" result rather
    // than throwing, so the code's AMBOSS mapping (if any) still lands.
    const none = stubGuidelineMapping(input.code, input.description);
    none.coverage.generalNotes = 'guideline mapping produced unparseable output';
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'warn',
      message: `Guidelines unresolved after ${attempts} attempts: ${input.code}`,
      metrics: { phase: 'map_guidelines', model: lastModel, code: input.code, attempts },
    });
    return { mapping: none, attempts, model: lastModel, unresolved: true };
  } finally {
    try {
      await mcp.close();
    } catch {
      // non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Overall-coverage synthesis (source = 'both' only).
// ---------------------------------------------------------------------------

export type CoverageVerdict = {
  coverageLevel: string;
  coverageScore: number;
  rationale: string;
};

/** Minimal shape of the AMBOSS coverage block the synthesis needs. */
export type AmbossCoverageForSynthesis = {
  inAMBOSS?: boolean;
  coverageLevel?: string;
  coverageScore?: number | string;
  generalNotes?: string;
  gaps?: string;
};

function renderAmbossCoverage(c: AmbossCoverageForSynthesis): string {
  const score = coerceScore(c.coverageScore);
  return [
    `- In AMBOSS: ${c.inAMBOSS ? 'yes' : 'no'}`,
    `- Coverage level: ${c.coverageLevel || 'none'}`,
    typeof score === 'number' ? `- Coverage score (0-5): ${score}` : null,
    c.generalNotes ? `- Notes: ${c.generalNotes}` : null,
    c.gaps ? `- Gaps: ${c.gaps}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderGuidelineCoverage(c: GuidelineCoverageBlock): string {
  const score = coerceScore(c.coverageScore);
  const titles = (c.coveredGuidelines ?? [])
    .map((g) => g.guidelineTitle ?? g.guidelineId)
    .filter(Boolean)
    .join('; ');
  return [
    `- In guidelines: ${c.inGuidelines ? 'yes' : 'no'}`,
    `- Coverage level: ${c.coverageLevel || 'none'}`,
    typeof score === 'number' ? `- Coverage score (0-5): ${score}` : null,
    titles ? `- Guidelines: ${titles}` : null,
    c.generalNotes ? `- Notes: ${c.generalNotes}` : null,
    c.gaps ? `- Gaps: ${c.gaps}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Verdict for a single source (used when only one source ran). */
function verdictFromScore(
  level: string | undefined,
  score: number | undefined,
): CoverageVerdict {
  const s = score ?? 0;
  return { coverageLevel: level || levelFromScore(s), coverageScore: s, rationale: '' };
}

export async function synthesizeOverallCoverage(input: {
  ambossCoverage: AmbossCoverageForSynthesis | null;
  guidelineCoverage: GuidelineCoverageBlock | null;
  milestones: string;
  runId: string;
  stage: StageName;
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<CoverageVerdict> {
  const { ambossCoverage: a, guidelineCoverage: g } = input;

  // Single-source short-circuits — no LLM call.
  if (!g && a) return verdictFromScore(a.coverageLevel, coerceScore(a.coverageScore));
  if (!a && g) return verdictFromScore(g.coverageLevel, coerceScore(g.coverageScore));
  if (!a && !g) return { coverageLevel: 'none', coverageScore: 0, rationale: '' };

  const ambossScore = coerceScore(a?.coverageScore) ?? 0;
  const guidelineScore = coerceScore(g?.coverageScore) ?? 0;

  // Deterministic fallback used if the synthesis call fails or won't parse.
  const fallback = (): CoverageVerdict => {
    const s = Math.max(ambossScore, guidelineScore);
    return {
      coverageLevel: levelFromScore(s),
      coverageScore: s,
      rationale: 'max(amboss, guideline)',
    };
  };

  try {
    const system = DEFAULT_OVERALL_SYNTHESIS_SYSTEM_PROMPT.replace(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
      '${milestones}',
      input.milestones || 'N/A',
    );
    const userMessage = DEFAULT_OVERALL_SYNTHESIS_USER_TEMPLATE.replace(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
      '${ambossCoverage}',
      // biome-ignore lint/style/noNonNullAssertion: guarded above
      renderAmbossCoverage(a!),
    ).replace(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
      '${guidelineCoverage}',
      // biome-ignore lint/style/noNonNullAssertion: guarded above
      renderGuidelineCoverage(g!),
    );

    const result = await runAgentAttempt({
      spec: input.model,
      apiKeys: input.apiKeys,
      system,
      userMessage,
      tools: {},
    });
    const parsed = OverallSynthesisSchema.parse(parseAgentJson(result.text));
    const score =
      coerceScore(parsed.overall.coverageScore) ?? Math.max(ambossScore, guidelineScore);
    const verdict: CoverageVerdict = {
      coverageLevel: parsed.overall.coverageLevel || levelFromScore(score),
      coverageScore: score,
      rationale: parsed.overall.rationale || '',
    };
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: 'Overall synthesis done',
      metrics: {
        phase: 'synthesize_overall',
        model: input.model.model,
        completion: verdict,
        ...result.usage,
        costUsd: estimateCostUsd(input.model.model, result.usage),
      },
    });
    return verdict;
  } catch (e) {
    log('pipeline').warn('synthesizeOverallCoverage failed — using max() fallback', {
      error: errorMessage(e),
    });
    return fallback();
  }
}
