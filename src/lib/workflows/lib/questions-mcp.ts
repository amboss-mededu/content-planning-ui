/**
 * AMBOSS-questions mapping step — the question track for curriculum-mapping
 * specialties.
 *
 * A SEPARATE agent from the AMBOSS article mapper (`amboss-mcp.ts`) and the
 * guidelines mapper (`guidelines-mcp.ts`), so the three tracks never
 * cross-contaminate. It runs against the SAME AMBOSS MCP server but exposes
 * ONLY the `search_questions` tool, and returns the matched AMBOSS Qbank
 * question EIDs + stems (+ the tool's metadata).
 *
 * Like the guidelines ladder:
 *   - No library-ID validation (there is no local question catalog) — the
 *     first well-formed JSON parse is accepted; the ladder only retries parse
 *     failures.
 *   - No coverage level / score and no suggestion block — questions are a
 *     presence list, not a graded assessment.
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
  DEFAULT_QUESTIONS_SYSTEM_PROMPT,
  DEFAULT_QUESTIONS_USER_MESSAGE_TEMPLATE,
} from './prompts';

// ---------------------------------------------------------------------------
// Output schema (modelled defensively against the `search_questions` shape).
// Sub-fields are lenient so a partial/odd metadata object never drops the row.
// ---------------------------------------------------------------------------

const QuestionRefSchema = z.object({
  questionId: z.string().optional(),
  questionStem: z.string().optional(),
  studyObjectives: z.array(z.string()).optional().catch(undefined),
  learningObjective: z.string().optional(),
  competency: z.string().optional(),
  system: z.string().optional(),
  difficulty: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? undefined : String(v))),
});

export const QuestionOutputSchema = z.object({
  code: z.string().optional(),
  description: z.string().optional(),
  coverage: z.object({
    inQuestions: z.boolean().optional().default(false),
    coveredQuestions: z.array(QuestionRefSchema).default([]),
    generalNotes: z.string().optional().default(''),
    gaps: z.string().optional().default(''),
  }),
});

export type QuestionOutput = z.infer<typeof QuestionOutputSchema>;
/** The agent's coverage block (distinct from the stored per-question
 *  `QuestionRef` in `pb/types`). */
export type QuestionCoverageBlock = QuestionOutput['coverage'];

export type QuestionMappingResult = {
  mapping: QuestionOutput;
  attempts: number;
  model: string;
  /** `true` when every attempt produced unparseable output (written through as
   *  an empty result rather than failing the code's mapping). */
  unresolved: boolean;
};

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function composeQuestionsSystem(milestones: string, additional?: string): string {
  const base = DEFAULT_QUESTIONS_SYSTEM_PROMPT.replace(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder
    '${milestones}',
    milestones || 'N/A',
  );
  const extra = additional?.trim();
  if (!extra) return base;
  return `${base}\n\n## Additional instructions\n\n${extra}`;
}

function composeQuestionsUser(input: {
  specialty: string;
  code: string;
  codeCategory: string;
  description: string;
  contentBase: string;
  language: string;
}): string {
  /* biome-ignore-start lint/suspicious/noTemplateCurlyInString: intentional placeholder */
  return DEFAULT_QUESTIONS_USER_MESSAGE_TEMPLATE.replaceAll(
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

function stubQuestionMapping(code: string, description: string): QuestionOutput {
  return {
    code,
    description,
    coverage: {
      inQuestions: false,
      coveredQuestions: [],
      generalNotes: 'stubbed (no AMBOSS MCP creds / search_questions tool)',
      gaps: '',
    },
  };
}

// ---------------------------------------------------------------------------
// Public step: per-code question mapping.
// ---------------------------------------------------------------------------

export async function mapQuestionsForCode(input: {
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
}): Promise<QuestionMappingResult> {
  log('pipeline').info('mapQuestionsForCode', {
    code: input.code,
    primary: input.primaryModel.model,
    backup: input.backupModel.model,
    stubbed: !hasMappingCreds(),
  });

  // Stub path: no MCP creds → canned "no questions" result.
  if (!hasMappingCreds()) {
    const stub = stubQuestionMapping(input.code, input.description);
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'info',
      message: `Questions (stub): ${input.code}`,
      metrics: { phase: 'map_questions', completion: stub, model: 'stub' },
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
    // Prefer the documented name; tolerate a renamed tool by matching
    // /question/i. If absent, fail soft so the run never crashes.
    const questionsToolName =
      'search_questions' in allTools
        ? 'search_questions'
        : Object.keys(allTools).find((n) => n.toLowerCase().includes('question'));
    if (!questionsToolName) {
      const none = stubQuestionMapping(input.code, input.description);
      none.coverage.generalNotes = 'search_questions tool not exposed by the MCP server';
      await logEvent({
        runId: input.runId,
        stage: input.stage,
        level: 'warn',
        message: `Questions skipped — search_questions tool not found: ${input.code}`,
        metrics: { phase: 'map_questions', code: input.code },
      });
      return { mapping: none, attempts: 0, model: 'none', unresolved: true };
    }
    const tools: ToolSet = { [questionsToolName]: allTools[questionsToolName] };

    const system = composeQuestionsSystem(input.milestones, input.additionalInstructions);
    const userMessage = composeQuestionsUser({
      specialty: input.specialty,
      code: input.code,
      codeCategory: input.category,
      description: input.description,
      contentBase: input.contentBase,
      language: input.language,
    });

    // Ladder: two primary attempts + one backup, retried only on parse failure
    // (no ID validation for questions).
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
        message: `Questions attempt ${attempts} (${step.label}): ${input.code}`,
        metrics: {
          phase: 'map_questions',
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
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'warn',
          message: `Questions attempt ${attempts} (${step.label}) agent call failed for ${input.code}: ${errorMessage(e)}`,
          metrics: { phase: 'map_questions', model: lastModel, code: input.code },
        });
        continue;
      }
      const durationMs = Date.now() - started;

      let parsed: QuestionOutput;
      try {
        parsed = QuestionOutputSchema.parse(parseAgentJson(result.text));
      } catch (e) {
        await logEvent({
          runId: input.runId,
          stage: input.stage,
          level: 'warn',
          message: `Questions attempt ${attempts} (${step.label}) parse failed for ${input.code}: ${errorMessage(e)}`,
          metrics: {
            phase: 'map_questions',
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
        message: `Questions done: ${input.code}`,
        metrics: {
          phase: 'map_questions',
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

    // Every attempt failed to parse — write through an empty result rather than
    // throwing, so the code's article mapping still lands.
    const none = stubQuestionMapping(input.code, input.description);
    none.coverage.generalNotes = 'question mapping produced unparseable output';
    await logEvent({
      runId: input.runId,
      stage: input.stage,
      level: 'warn',
      message: `Questions unresolved after ${attempts} attempts: ${input.code}`,
      metrics: { phase: 'map_questions', model: lastModel, code: input.code, attempts },
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
