import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { logEvent } from '../lib/events';
import type { ModelSpec, resolveModel } from '../lib/llm';
import { estimateCostUsd } from '../lib/pricing';
import {
  type ConsolidationOutput,
  ConsolidationOutputGenerationSchema,
  ConsolidationValidationError,
  parseConsolidationJsonText,
  validateConsolidationOutput,
} from './primary-output';
import { CONSOLIDATION_SYSTEM_PROMPT } from './prompts';

const STRICT_JSON_RETRY_SUFFIX =
  '\n\nReturn exactly one valid JSON object and nothing else. Do not wrap it in markdown, do not include commentary, and do not omit any required top-level keys.';

function shortIssueSummary(error: unknown): string {
  if (error instanceof ConsolidationValidationError) return error.message;
  if (!(error instanceof Error)) return String(error);
  return error.message;
}

function finishReasonFrom(result: { finishReason?: unknown }): string | undefined {
  return typeof result.finishReason === 'string' ? result.finishReason : undefined;
}

type JsonFailure = {
  kind: 'no_parseable_json' | 'schema_validation_failed';
  issue?: string;
  issuePath?: string;
  issueMessage?: string;
  topLevelKeys?: string[];
};

function classifyTextFailure(text: string | undefined, category: string): JsonFailure {
  if (!text) return { kind: 'no_parseable_json' };
  let parsed: unknown;
  try {
    parsed = parseConsolidationJsonText(text);
  } catch (error) {
    return { kind: 'no_parseable_json', issue: shortIssueSummary(error) };
  }
  try {
    validateConsolidationOutput(withExpectedCategory(parsed, category), category);
  } catch (error) {
    return { kind: 'schema_validation_failed', issue: shortIssueSummary(error) };
  }
  return { kind: 'no_parseable_json' };
}

function validationFailure(error: unknown): JsonFailure {
  if (error instanceof ConsolidationValidationError) {
    return {
      kind: 'schema_validation_failed',
      issue: error.message,
      issuePath: error.issuePath,
      issueMessage: error.issueMessage,
      topLevelKeys: error.topLevelKeys,
    };
  }
  return { kind: 'schema_validation_failed', issue: shortIssueSummary(error) };
}

function validationMetrics(failure: JsonFailure, fallback?: unknown) {
  return {
    failureKind: failure.kind,
    validationIssue:
      failure.issue ?? (fallback ? shortIssueSummary(fallback) : undefined),
    validationIssuePath: failure.issuePath,
    validationIssueMessage: failure.issueMessage,
    topLevelKeys: failure.topLevelKeys,
  };
}

function invalidJsonError({
  category,
  prompt,
  resolved,
  failure,
}: {
  category: string;
  prompt: string;
  resolved: ReturnType<typeof resolveModel>;
  failure: JsonFailure;
}) {
  const reason =
    failure.kind === 'no_parseable_json'
      ? 'returned no parseable JSON'
      : 'returned JSON that failed validation';
  const issue = failure.issue ? `; first issue: ${failure.issue}` : '';
  return new Error(
    `Invalid consolidation JSON for "${category}" using ${resolved.provider}/${resolved.modelId} (prompt ${prompt.length} chars): ${reason}${issue}`,
  );
}

function withExpectedCategory(raw: unknown, category: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  // The workflow already scopes the model input and database writes by this
  // server-side category. Treat the model's `category` field as echo metadata:
  // long taxonomy labels are easy to slightly shorten or re-punctuate, and
  // that should not invalidate otherwise schema-valid consolidation rows.
  return { ...raw, category };
}

export async function generatePrimaryConsolidationOutput({
  runId,
  category,
  prompt,
  resolved,
  model,
}: {
  runId: string;
  category: string;
  prompt: string;
  resolved: ReturnType<typeof resolveModel>;
  model: ModelSpec;
}): Promise<{ output: ConsolidationOutput }> {
  async function callModel(promptText: string, retry: boolean) {
    const started = Date.now();
    const result = await generateText({
      model: resolved.sdkModel,
      system: CONSOLIDATION_SYSTEM_PROMPT,
      prompt: promptText,
      output: Output.object({
        schema: ConsolidationOutputGenerationSchema,
        name: 'primaryConsolidationOutput',
        description: 'Schema-valid primary consolidation output for one category.',
      }),
      providerOptions: resolved.providerOptions,
      ...(resolved.provider === 'anthropic' ? {} : { temperature: 1 }),
    });
    return { result, durationMs: Date.now() - started, retry };
  }

  for (const retry of [false, true]) {
    try {
      const { result, durationMs } = await callModel(
        retry ? `${prompt}${STRICT_JSON_RETRY_SUFFIX}` : prompt,
        retry,
      );
      let output: ConsolidationOutput;
      let objectValidationFailure: JsonFailure | null = null;
      try {
        output = validateConsolidationOutput(
          withExpectedCategory(result.output, category),
          category,
        );
      } catch (outputError) {
        objectValidationFailure = validationFailure(outputError);
        try {
          const recovered = validateConsolidationOutput(
            withExpectedCategory(parseConsolidationJsonText(result.text), category),
            category,
          );
          await logEvent({
            runId,
            stage: 'consolidate_primary',
            level: 'warn',
            message: `Recovered schema-valid JSON for "${category}" from LLM text${retry ? ' after retry' : ''}.`,
            metrics: {
              model: resolved.modelId,
              provider: resolved.provider,
              reasoning: model.reasoning,
              jsonRetry: retry,
              textLength: result.text.length,
              finishReason: finishReasonFrom(result),
              ...validationMetrics(objectValidationFailure),
            },
          });
          output = recovered;
        } catch (recoveryError) {
          const recoveryFailure = classifyTextFailure(result.text, category);
          const failure = objectValidationFailure ?? recoveryFailure;
          await logEvent({
            runId,
            stage: 'consolidate_primary',
            level: retry ? 'error' : 'warn',
            message: retry
              ? `Schema-valid JSON recovery failed for "${category}" after retry.`
              : `Schema-valid JSON recovery failed for "${category}"; retrying with stricter JSON-only prompt.`,
            metrics: {
              model: resolved.modelId,
              provider: resolved.provider,
              reasoning: model.reasoning,
              jsonRetry: retry,
              textLength: result.text.length,
              finishReason: finishReasonFrom(result),
              ...validationMetrics(failure, recoveryError),
            },
          });
          if (retry) {
            throw invalidJsonError({ category, prompt, resolved, failure });
          }
          continue;
        }
      }
      const usage = {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        reasoningTokens: result.usage?.reasoningTokens,
        cachedInputTokens: result.usage?.cachedInputTokens,
      };
      await logEvent({
        runId,
        stage: 'consolidate_primary',
        level: 'info',
        message: `LLM primary consolidation done for "${category}" in ${durationMs}ms${retry ? ' after JSON retry' : ''}.`,
        metrics: {
          durationMs,
          ...usage,
          costUsd: estimateCostUsd(resolved.modelId, usage),
          model: resolved.modelId,
          provider: resolved.provider,
          reasoning: model.reasoning,
          jsonRetry: retry,
          finishReason: finishReasonFrom(result),
        },
      });
      return { output };
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;

      const textLength = error.text?.length ?? 0;
      let loggedRecoveryFailure = false;
      let failure: JsonFailure = classifyTextFailure(error.text, category);
      try {
        if (error.text) {
          const recovered = validateConsolidationOutput(
            withExpectedCategory(parseConsolidationJsonText(error.text), category),
            category,
          );
          await logEvent({
            runId,
            stage: 'consolidate_primary',
            level: 'warn',
            message: `Recovered schema-valid JSON for "${category}" from malformed LLM response${retry ? ' after retry' : ''}.`,
            metrics: {
              model: resolved.modelId,
              provider: resolved.provider,
              reasoning: model.reasoning,
              jsonRetry: retry,
              textLength,
              finishReason: error.finishReason,
            },
          });
          return { output: recovered };
        }
      } catch (parseError) {
        loggedRecoveryFailure = true;
        failure = classifyTextFailure(error.text, category);
        await logEvent({
          runId,
          stage: 'consolidate_primary',
          level: retry ? 'error' : 'warn',
          message: retry
            ? `JSON recovery failed for "${category}" after retry.`
            : `JSON recovery failed for "${category}"; retrying with stricter JSON-only prompt.`,
          metrics: {
            model: resolved.modelId,
            provider: resolved.provider,
            reasoning: model.reasoning,
            jsonRetry: retry,
            textLength,
            finishReason: error.finishReason,
            ...validationMetrics(failure, parseError),
          },
        });
      }
      if (!loggedRecoveryFailure) {
        await logEvent({
          runId,
          stage: 'consolidate_primary',
          level: retry ? 'error' : 'warn',
          message: retry
            ? `LLM returned no parseable JSON text for "${category}" after retry.`
            : `LLM returned no parseable JSON text for "${category}"; retrying with stricter JSON-only prompt.`,
          metrics: {
            model: resolved.modelId,
            provider: resolved.provider,
            reasoning: model.reasoning,
            jsonRetry: retry,
            textLength,
            finishReason: error.finishReason,
          },
        });
      }

      if (retry) {
        throw invalidJsonError({ category, prompt, resolved, failure });
      }
    }
  }

  throw invalidJsonError({
    category,
    prompt,
    resolved,
    failure: { kind: 'no_parseable_json' },
  });
}
