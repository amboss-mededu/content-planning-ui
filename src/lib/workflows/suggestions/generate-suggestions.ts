/**
 * Generate-suggestions pipeline step (the `map_suggestions` backfill).
 *
 * For every code that was coverage-mapped but never processed for suggestions
 * (`mappedAt > 0 && !suggestionsGeneratedAt`), runs a suggestion-only MCP agent
 * call that REUSES the stored coverage — coverage is never recomputed — and
 * writes back only the suggestion fields. Mirrors `mapCodesWorkflow`'s
 * fan-out / cancellation / metrics structure.
 *
 * Fire-and-forget from /api/workflows/map-suggestions.
 */

import {
  listMappedCodesWithoutSuggestionsAsAdmin,
  type MappedCodeForSuggestions,
} from '@/lib/data/codes';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import { generateSuggestionsForCode } from '../lib/amboss-mcp';
import {
  clearInFlightForRun,
  getPipelineRunStatus,
  loadSpecialtyForMapping,
  markCodesInFlight,
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
  writeCodeSuggestions,
} from '../lib/db-writes';
import { aggregateStageMetrics, logEvent } from '../lib/events';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { revalidateSpecialtyCache } from '../lib/revalidate';
import { chunk } from '../lib/util';

const CODE_CONCURRENCY = 10;

class RunCancelledError extends Error {
  constructor(public readonly observedStatus: string | null) {
    super(`map_suggestions run cancelled (status=${observedStatus ?? 'missing'})`);
    this.name = 'RunCancelledError';
  }
}

function shouldAbort(status: string | null): boolean {
  return status === 'cancelled' || status === 'failed' || status === null;
}

export type GenerateSuggestionsInput = {
  runId: string;
  specialtySlug: string;
  contentBase?: string;
  language?: string;
  additionalInstructions?: string;
  checkAgainstLibrary: boolean;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
};

function deriveContentBase(region: string | null): string {
  if (region === 'us') return 'US';
  if (region === 'de') return 'German';
  return region ?? 'US';
}

function deriveLanguage(language: string | null): string {
  return language || 'en';
}

async function generateAndWriteOne(input: {
  runId: string;
  specialtySlug: string;
  row: MappedCodeForSuggestions;
  specialty: string;
  contentBase: string;
  language: string;
  milestones: string;
  additionalInstructions?: string;
  checkAgainstLibrary: boolean;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<{ code: string; attempts: number; model: string; unresolved: boolean }> {
  const result = await generateSuggestionsForCode({
    code: input.row.code,
    description: input.row.description ?? '',
    category: input.row.category ?? '',
    specialty: input.specialty,
    contentBase: input.contentBase,
    language: input.language,
    milestones: input.milestones,
    additionalInstructions: input.additionalInstructions,
    checkAgainstLibrary: input.checkAgainstLibrary,
    coverage: {
      isInAMBOSS: input.row.isInAMBOSS,
      coverageLevel: input.row.coverageLevel,
      depthOfCoverage: input.row.depthOfCoverage,
      notes: input.row.notes,
      gaps: input.row.gaps,
      articlesWhereCoverageIs: input.row.articlesWhereCoverageIs,
    },
    runId: input.runId,
    stage: 'map_suggestions',
    primaryModel: input.primaryModel,
    backupModel: input.backupModel,
    apiKeys: input.apiKeys,
  });
  // Cooperative cancellation: don't write over a row whose stage was reset
  // mid-call.
  const status = await getPipelineRunStatus(input.runId);
  if (shouldAbort(status)) throw new RunCancelledError(status);
  await writeCodeSuggestions(
    input.specialtySlug,
    input.row.code,
    result.mapping.suggestion,
  );
  return {
    code: input.row.code,
    attempts: result.attempts,
    model: result.model,
    unresolved: result.unresolved,
  };
}

export async function generateSuggestionsWorkflow(
  input: GenerateSuggestionsInput,
): Promise<void> {
  log('pipeline').info('generateSuggestionsWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    checkAgainstLibrary: input.checkAgainstLibrary,
  });

  try {
    await markStageRunning(input.runId, 'map_suggestions');

    const [spec, pending] = await Promise.all([
      loadSpecialtyForMapping(input.specialtySlug),
      listMappedCodesWithoutSuggestionsAsAdmin(input.specialtySlug),
    ]);
    const contentBase = input.contentBase || deriveContentBase(spec.region);
    const language = input.language || deriveLanguage(spec.language);
    const milestones = spec.milestones ?? '';

    await logEvent({
      runId: input.runId,
      stage: 'map_suggestions',
      level: 'info',
      message: `Run started for ${pending.length} code(s) needing suggestions · ${contentBase} · lang=${language}`,
      metrics: { model: 'mapper-ladder' },
    });

    if (pending.length === 0) {
      await markStageCompleted(input.runId, 'map_suggestions');
      await logEvent({
        runId: input.runId,
        stage: 'map_suggestions',
        level: 'info',
        message: 'No codes need suggestions — closing stage.',
      });
    } else {
      let escalations = 0;
      let unresolvedCount = 0;
      for (const batch of chunk(pending, CODE_CONCURRENCY)) {
        const preStatus = await getPipelineRunStatus(input.runId);
        if (shouldAbort(preStatus)) throw new RunCancelledError(preStatus);

        await markCodesInFlight(
          input.specialtySlug,
          batch.map((c) => c.code),
          input.runId,
        );
        const results = await Promise.all(
          batch.map((row) =>
            generateAndWriteOne({
              runId: input.runId,
              specialtySlug: input.specialtySlug,
              row,
              specialty: input.specialtySlug,
              contentBase,
              language,
              milestones,
              additionalInstructions: input.additionalInstructions,
              checkAgainstLibrary: input.checkAgainstLibrary,
              primaryModel: input.primaryModel,
              backupModel: input.backupModel,
              apiKeys: input.apiKeys,
            }),
          ),
        );
        for (const r of results) {
          if (r.model.startsWith('claude-')) escalations += 1;
          if (r.unresolved) unresolvedCount += 1;
        }
        await revalidateSpecialtyCache(input.specialtySlug);
      }

      // Final cancellation check before the terminal writes (see map-codes):
      // catch a cancel that lands after the last code but before completion is
      // written, so it isn't silently resurrected to 'completed'.
      const finalStatus = await getPipelineRunStatus(input.runId);
      if (shouldAbort(finalStatus)) throw new RunCancelledError(finalStatus);

      const totals = await aggregateStageMetrics(input.runId, 'map_suggestions');
      await markStageCompleted(input.runId, 'map_suggestions', undefined, {
        codes: pending.length,
        escalations,
        invalidIdsRemaining: unresolvedCount,
        apiCalls: totals.apiCalls,
        durationMs: totals.durationMs,
        computeMs: totals.computeMs,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        reasoningTokens: totals.reasoningTokens,
        costUsd: totals.costUsd,
      });
      await logEvent({
        runId: input.runId,
        stage: 'map_suggestions',
        level: 'info',
        message: `Suggestions complete — ${pending.length} codes · ${escalations} escalated · ${unresolvedCount} unresolved.`,
        metrics: {
          durationMs: totals.durationMs ?? undefined,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          reasoningTokens: totals.reasoningTokens,
          costUsd: totals.costUsd,
        },
      });
    }

    await clearInFlightForRun(input.runId);
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
  } catch (e) {
    if (e instanceof RunCancelledError) {
      log('pipeline').info('generateSuggestionsWorkflow cancelled mid-batch', {
        runId: input.runId,
        observedStatus: e.observedStatus,
      });
      await clearInFlightForRun(input.runId);
      await logEvent({
        runId: input.runId,
        stage: 'map_suggestions',
        level: 'info',
        message: 'Run cancelled mid-batch — stage reset by editor.',
      }).catch(() => {});
      await revalidateSpecialtyCache(input.specialtySlug);
      return;
    }
    const msg = errorMessage(e);
    await markStageFailed(input.runId, 'map_suggestions', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await clearInFlightForRun(input.runId);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
