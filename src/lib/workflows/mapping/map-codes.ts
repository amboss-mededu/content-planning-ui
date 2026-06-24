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

import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type { MappingSource, PipelineMode } from '@/lib/types';
import { type MappingOutput, mapAndValidateCode } from '../lib/amboss-mcp';
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
import { mapGuidelinesForCode, synthesizeOverallCoverage } from '../lib/guidelines-mcp';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { mapQuestionsForCode } from '../lib/questions-mcp';
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
  /** When false (mapping-only specialty) the prompt drops the suggestion
   *  portion and no suggestions are persisted — coverage only. */
  includeSuggestions?: boolean;
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

/** Empty AMBOSS coverage, used when a code is mapped against guidelines only
 *  so the AMBOSS columns stay blank (no AMBOSS run happened). */
function emptyAmbossMapping(code: string, description: string): MappingOutput {
  return {
    code,
    description,
    coverage: {
      inAMBOSS: false,
      coveredSections: [],
      generalNotes: '',
      gaps: '',
      coverageLevel: '',
      coverageScore: undefined,
    },
    suggestion: { improvement: '', sectionUpdates: [], newArticlesNeeded: [] },
  };
}

/**
 * Single step that wraps "map this code + persist the result" as one atomic
 * unit in the event log. On crash, the workflow replays completed codes as
 * cache hits and re-executes only whichever code was in flight.
 *
 * Dispatches per the specialty's `mappingSource`: AMBOSS agent, guidelines
 * agent, or both (run concurrently, then reconciled into an overall verdict).
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
  includeSuggestions: boolean;
  mappingSource: MappingSource;
  pipelineMode: PipelineMode;
  primaryModel: ModelSpec;
  backupModel: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<{
  code: string;
  attempts: number;
  model: string;
  escalated: boolean;
  unresolved: boolean;
}> {
  const source = input.mappingSource;
  const runAmboss = source === 'amboss' || source === 'both';
  const runGuidelines = source === 'guidelines' || source === 'both';
  // Curriculum-mapping additionally maps each code against AMBOSS Qbank
  // questions, as a SEPARATE agent call (its own MCP `search_questions` tool),
  // run concurrently with the article/guideline agents. Other modes skip it.
  const runQuestions = input.pipelineMode === 'curriculum-mapping';

  const [ambossResult, guidelineResult, questionsResult] = await Promise.all([
    runAmboss
      ? mapAndValidateCode({
          code: input.code,
          description: input.description,
          category: input.category,
          specialty: input.specialty,
          contentBase: input.contentBase,
          language: input.language,
          milestones: input.milestones,
          additionalInstructions: input.additionalInstructions,
          checkAgainstLibrary: input.checkAgainstLibrary,
          includeSuggestions: input.includeSuggestions,
          pipelineMode: input.pipelineMode,
          runId: input.runId,
          stage: 'map_codes',
          primaryModel: input.primaryModel,
          backupModel: input.backupModel,
          apiKeys: input.apiKeys,
        })
      : Promise.resolve(null),
    runGuidelines
      ? mapGuidelinesForCode({
          code: input.code,
          description: input.description,
          category: input.category,
          specialty: input.specialty,
          contentBase: input.contentBase,
          language: input.language,
          milestones: input.milestones,
          additionalInstructions: input.additionalInstructions,
          runId: input.runId,
          stage: 'map_codes',
          primaryModel: input.primaryModel,
          backupModel: input.backupModel,
          apiKeys: input.apiKeys,
        })
      : Promise.resolve(null),
    runQuestions
      ? mapQuestionsForCode({
          code: input.code,
          description: input.description,
          category: input.category,
          specialty: input.specialty,
          contentBase: input.contentBase,
          language: input.language,
          milestones: input.milestones,
          additionalInstructions: input.additionalInstructions,
          runId: input.runId,
          stage: 'map_codes',
          primaryModel: input.primaryModel,
          backupModel: input.backupModel,
          apiKeys: input.apiKeys,
        })
      : Promise.resolve(null),
  ]);

  // Cooperative cancellation: agent calls took 10–60s; if the editor reset
  // the stage mid-call we must not stamp mappedAt over the cleared row.
  const status = await getPipelineRunStatus(input.runId);
  if (shouldAbort(status)) throw new RunCancelledError(status);

  // Reconcile into an overall verdict. Short-circuits without an LLM call for
  // single-source runs; only `both` makes the synthesis call.
  const overall = await synthesizeOverallCoverage({
    ambossCoverage: ambossResult
      ? {
          inAMBOSS: ambossResult.mapping.coverage.inAMBOSS,
          coverageLevel: ambossResult.mapping.coverage.coverageLevel,
          coverageScore: ambossResult.mapping.coverage.coverageScore,
          generalNotes: ambossResult.mapping.coverage.generalNotes,
          gaps: ambossResult.mapping.coverage.gaps,
        }
      : null,
    guidelineCoverage: guidelineResult ? guidelineResult.mapping.coverage : null,
    milestones: input.milestones,
    runId: input.runId,
    stage: 'map_codes',
    model: input.primaryModel,
    apiKeys: input.apiKeys,
  });

  await writeCodeMapping(
    input.specialtySlug,
    input.code,
    ambossResult?.mapping ?? emptyAmbossMapping(input.code, input.description),
    // Suggestions are an AMBOSS-only concept — never on a guidelines-only run.
    runAmboss ? input.includeSuggestions : false,
    {
      guideline: guidelineResult?.mapping.coverage ?? null,
      questions: questionsResult?.mapping.coverage ?? null,
      overall,
      mappingSourceUsed: source,
    },
  );

  return {
    code: input.code,
    attempts:
      (ambossResult?.attempts ?? 0) +
      (guidelineResult?.attempts ?? 0) +
      (questionsResult?.attempts ?? 0),
    model:
      ambossResult?.model ?? guidelineResult?.model ?? questionsResult?.model ?? 'none',
    // Any agent that fell through to the (claude) backup counts as an
    // escalation — including the questions agent, whose model the single
    // `model` field above never surfaces for curriculum runs.
    escalated: [ambossResult, guidelineResult, questionsResult].some((r) =>
      Boolean(r?.model.startsWith('claude-')),
    ),
    unresolved:
      Boolean(ambossResult?.unresolved) ||
      Boolean(guidelineResult?.unresolved) ||
      Boolean(questionsResult?.unresolved),
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
    // Source is a per-specialty setting — read from the specialty, not the run.
    const mappingSource = spec.mappingSource;

    await logEvent({
      runId: input.runId,
      stage: 'map_codes',
      level: 'info',
      message: `Run started for ${unmapped.length} unmapped code(s) · ${contentBase} · lang=${language} · source=${mappingSource}`,
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
              includeSuggestions: input.includeSuggestions ?? true,
              mappingSource,
              pipelineMode: spec.pipelineMode,
              primaryModel: input.primaryModel,
              backupModel: input.backupModel,
              apiKeys: input.apiKeys,
            }),
          ),
        );
        for (const r of results) {
          if (r.escalated) escalations += 1;
          if (r.unresolved) unresolvedCount += 1;
        }
        // Surface incremental progress so polling clients can pick it up
        // before the workflow reaches the final stage write.
        await revalidateSpecialtyCache(input.specialtySlug);
      }

      // Final cancellation check before the terminal writes. The per-batch and
      // per-code polls can't catch a cancel that lands after the last code
      // resolves but before completion is written — and markStageCompleted /
      // updatePipelineRunStatus are plain updates with no status precondition,
      // so without this a late cancel would be silently resurrected to
      // 'completed'. Bail into the RunCancelledError path instead.
      const finalStatus = await getPipelineRunStatus(input.runId);
      if (shouldAbort(finalStatus)) throw new RunCancelledError(finalStatus);

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
    const msg = errorMessage(e);
    await markStageFailed(input.runId, 'map_codes', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await clearInFlightForRun(input.runId);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
