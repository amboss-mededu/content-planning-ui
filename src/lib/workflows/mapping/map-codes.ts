/**
 * Map-codes pipeline step.
 *
 * Fans out per-code MCP agent calls with concurrency cap 10, writing each
 * mapping through to the `codes` row as soon as it resolves. When every
 * unmapped code is done, the stage transitions straight to `completed` —
 * results are visible row-by-row in the codes table as they land, so an
 * explicit approval gate doesn't add value here.
 *
 * Run as fire-and-forget from /api/workflows/map-codes; the route returns
 * immediately and the work continues in the same Node process.
 */

import { log } from '@/lib/log';
import { mapAndValidateCode } from '../lib/amboss-mcp';
import {
  clearInFlightForRun,
  getPipelineRunStatus,
  listUnmappedCodes,
  loadSpecialtyForMapping,
  type MappingFilter,
  markCodesInFlight,
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
  writeCodeMapping,
} from '../lib/db-writes';
import { aggregateStageMetrics, logEvent } from '../lib/events';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { revalidateSpecialtyCache } from '../lib/revalidate';
import { chunk } from '../lib/util';

const CODE_CONCURRENCY = 10;

/**
 * Thrown when a cooperative cancellation check sees the run is no longer
 * `running`. The outer `try/catch` in `mapCodesWorkflow` treats this as
 * "the editor reset the stage" — no `markStageFailed`, no rethrow.
 */
class RunCancelledError extends Error {
  constructor(public readonly observedStatus: string | null) {
    super(`map_codes run cancelled (status=${observedStatus ?? 'missing'})`);
    this.name = 'RunCancelledError';
  }
}

function shouldAbort(status: string | null): boolean {
  return status === 'cancelled' || status === 'failed' || status === null;
}

export type MapCodesInput = {
  runId: string;
  specialtySlug: string;
  contentBase?: string;
  language?: string;
  additionalInstructions?: string;
  checkAgainstLibrary: boolean;
  /** Optional category/code filter applied to `listUnmappedCodes`. Null or
   *  empty → map every unmapped code for the specialty. */
  filter?: MappingFilter | null;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
};

/**
 * Derive a sensible `contentBase` label for the agent prompt when the caller
 * didn't override it. n8n's convention: `US` / `German` strings (not `us` /
 * `de` region slugs) — the LLM uses this verbatim in its prompt.
 */
function deriveContentBase(region: string | null): string {
  if (region === 'us') return 'US';
  if (region === 'de') return 'German';
  return region ?? 'US';
}

function deriveLanguage(language: string | null): string {
  return language || 'en';
}

/**
 * Single step that wraps "map this code + persist the result" as one atomic
 * unit in the event log. On crash, the workflow replays completed codes as
 * cache hits and re-executes only whichever code was in flight.
 */
async function mapAndWriteOne(input: {
  runId: string;
  specialtySlug: string;
  code: string;
  description: string;
  category: string;
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
  const result = await mapAndValidateCode({
    code: input.code,
    description: input.description,
    category: input.category,
    specialty: input.specialty,
    contentBase: input.contentBase,
    language: input.language,
    milestones: input.milestones,
    additionalInstructions: input.additionalInstructions,
    checkAgainstLibrary: input.checkAgainstLibrary,
    runId: input.runId,
    stage: 'map_codes',
    primaryModel: input.primaryModel,
    backupModel: input.backupModel,
    apiKeys: input.apiKeys,
  });
  // Cooperative cancellation: agent call took 10–60s; if the editor reset
  // the stage mid-call we must not stamp mappedAt over the cleared row.
  const status = await getPipelineRunStatus(input.runId);
  if (shouldAbort(status)) throw new RunCancelledError(status);
  await writeCodeMapping(input.specialtySlug, input.code, result.mapping);
  return {
    code: input.code,
    attempts: result.attempts,
    model: result.model,
    unresolved: result.unresolved,
  };
}

export async function mapCodesWorkflow(input: MapCodesInput): Promise<void> {
  log('pipeline').info('mapCodesWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    checkAgainstLibrary: input.checkAgainstLibrary,
  });

  try {
    await markStageRunning(input.runId, 'map_codes');

    const [spec, unmapped] = await Promise.all([
      loadSpecialtyForMapping(input.specialtySlug),
      listUnmappedCodes(input.specialtySlug, input.filter ?? null),
    ]);
    const contentBase = input.contentBase || deriveContentBase(spec.region);
    const language = input.language || deriveLanguage(spec.language);
    const milestones = spec.milestones ?? '';

    await logEvent({
      runId: input.runId,
      stage: 'map_codes',
      level: 'info',
      message: `Run started for ${unmapped.length} unmapped code(s) · ${contentBase} · lang=${language}`,
      metrics: {
        model: 'mapper-ladder',
      },
    });

    if (unmapped.length === 0) {
      await markStageCompleted(input.runId, 'map_codes');
      await logEvent({
        runId: input.runId,
        stage: 'map_codes',
        level: 'info',
        message: 'Nothing to map — closing stage.',
      });
    } else {
      let escalations = 0;
      let unresolvedCount = 0;
      for (const batch of chunk(unmapped, CODE_CONCURRENCY)) {
        // Cooperative cancellation: bail if a Reset flipped the run.
        const preStatus = await getPipelineRunStatus(input.runId);
        if (shouldAbort(preStatus)) throw new RunCancelledError(preStatus);

        await markCodesInFlight(
          input.specialtySlug,
          batch.map((c) => c.code),
          input.runId,
        );
        const results = await Promise.all(
          batch.map((c) =>
            mapAndWriteOne({
              runId: input.runId,
              specialtySlug: input.specialtySlug,
              code: c.code,
              description: c.description ?? '',
              category: c.category ?? '',
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
        // Surface incremental progress so polling clients can pick it up
        // before the workflow reaches the final stage write.
        await revalidateSpecialtyCache(input.specialtySlug);
      }

      const totals = await aggregateStageMetrics(input.runId, 'map_codes');
      // Stash the run-level summary on the stage row alongside completion so
      // the pipeline card still shows mapped/escalations/cost without going
      // through awaiting_approval.
      await markStageCompleted(input.runId, 'map_codes', undefined, {
        mapped: unmapped.length,
        codes: unmapped.length,
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
        stage: 'map_codes',
        level: 'info',
        message: `Mapping complete — ${unmapped.length} codes · ${escalations} escalated · ${unresolvedCount} unresolved.`,
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
      // Editor reset the stage mid-run. The reset cascade already cleared
      // the stage row and any mappedAt fields; do not flip the stage to
      // `failed`. Just drop in-flight markers and surface the cancellation
      // in the run log.
      log('pipeline').info('mapCodesWorkflow cancelled mid-batch', {
        runId: input.runId,
        observedStatus: e.observedStatus,
      });
      await clearInFlightForRun(input.runId);
      await logEvent({
        runId: input.runId,
        stage: 'map_codes',
        level: 'info',
        message: 'Run cancelled mid-batch — stage reset by editor.',
      }).catch(() => {});
      await revalidateSpecialtyCache(input.specialtySlug);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    await markStageFailed(input.runId, 'map_codes', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await clearInFlightForRun(input.runId);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
