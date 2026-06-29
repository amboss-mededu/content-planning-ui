/**
 * Per-stage event logger — writes a row to pipelineEvents (PocketBase) for
 * observability. Called from inside other `'use step'` functions; making
 * `logEvent` itself a step gives it its own retry semantics and bakes the
 * event-log writes into the workflow's durability replay.
 */

import {
  getStageAsAdmin,
  listEventsAsAdmin,
  logPipelineEventAsAdmin,
} from '@/lib/data/pipeline';
import type { EventStageName, StageName } from './db-writes';

export type EventLevel = 'info' | 'warn' | 'error';

export type EventMetrics = {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number | null;
  model?: string;
  /** Which provider produced the call. Used by the UI to badge attempts and
   *  by aggregateStageMetrics to tell escalations apart from primary calls. */
  provider?: 'google' | 'anthropic' | 'openai';
  /** Reasoning level passed to the model — surfaces what the user picked at
   *  kickoff so the per-call browser can show e.g. "Gemini 3 Flash · low". */
  reasoning?: 'auto' | 'low' | 'medium' | 'high';
  url?: string;
  source?: string;
  category?: string;
  /** Which sub-step produced the event — so the UI can split completions
   *  into "Identify modules" / "Extract codes" / "Milestones" / "Map" /
   *  "Map (guidelines)" / "Overall synthesis" buckets. */
  phase?:
    | 'identify'
    | 'extract'
    | 'milestones'
    | 'map'
    | 'map_guidelines'
    | 'map_questions'
    | 'synthesize_overall';
  /** Raw parsed LLM output for this call. */
  completion?: unknown;
  /** Overall-synthesis chain-of-thought: the per-source assessments the model
   *  produced (AMBOSS first, then guidelines) before judging the overall. */
  ambossAssessment?: string;
  guidelineAssessment?: string;
  /** True when the call used a stricter retry after malformed JSON. */
  jsonRetry?: boolean;
  /** Length of malformed model text observed during JSON recovery. */
  textLength?: number;
  /** AI SDK finish reason for malformed-object recovery paths. */
  finishReason?: string;
  /** Truncated/short parse failure message for malformed-object recovery paths. */
  parseError?: string;
  /** Classified JSON failure reason for model-output recovery diagnostics. */
  failureKind?: 'no_parseable_json' | 'schema_validation_failed';
  /** First short schema or parse issue without raw model output. */
  validationIssue?: string;
  /** First Zod issue path for model-output recovery diagnostics. */
  validationIssuePath?: string;
  /** First Zod issue message for model-output recovery diagnostics. */
  validationIssueMessage?: string;
  /** Top-level parsed JSON keys seen during schema-validation failure. */
  topLevelKeys?: string[];
  /** Compact top-level JSON shape observed during malformed-object recovery. */
  jsonShape?: string;
  /** First N chars of the raw model output, captured when JSON recovery fails
   *  so the persisted error event is enough to debug a shape mismatch
   *  without re-running the call. */
  rawTextSample?: string;
  /** Number of rows recovered from malformed-object output. */
  recoveredRows?: number;
  /** Per-code metadata for `map` events. */
  code?: string;
  attempts?: number;
  invalidIds?: string[];
  mcpToolCalls?: number;
  mcpToolNames?: string[];
  /** Which writing-pipeline pass produced this event (write_article only). */
  pass?: 'primary' | 'secondary' | 'proofreader' | 'style' | 'html' | 'copy';
  /** Total pass count for the write-article run header log. */
  passes?: number;
  /** Source count for the write-article run header log. */
  sources?: number;
  /** Which article this event belongs to within a multi-article lit-search run. */
  articleRecordId?: string;
  /** Lifecycle marker for a per-article lit-search invocation. Used by the
   *  modal's progress badge to derive "is this article currently being
   *  searched" from the latest event tagged with the same `articleRecordId`. */
  litSearchPhase?: 'start' | 'end';
  /** Number of Gemini Files PDFs attached to a writing-pass request. */
  attachedFiles?: number;
  /** Gemini Files ensure-upload counters logged at the start of a
   *  writing run (the JIT PDF upload pre-step). */
  uploaded?: number;
  reused?: number;
  failed?: number;
  noUrl?: number;
};

export async function logEvent(input: {
  runId: string;
  stage: EventStageName;
  level: EventLevel;
  message: string;
  metrics?: EventMetrics;
}): Promise<void> {
  await logPipelineEventAsAdmin({
    runId: input.runId,
    stage: input.stage,
    level: input.level,
    message: input.message,
    metrics: input.metrics,
  });
}

export type StageTotals = {
  apiCalls: number;
  durationMs: number | null;
  computeMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
};

/**
 * Sum per-call metrics from pipelineEvents for a single stage, plus wall-clock
 * durationMs from the stage's startedAt. Called once at stage completion to
 * populate outputSummary.
 */
export async function aggregateStageMetrics(
  runId: string,
  stage: StageName,
): Promise<StageTotals> {
  const events = await listEventsAsAdmin(runId);
  const stageRow = await getStageAsAdmin({ runId, stage });

  let apiCalls = 0;
  let computeMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let costUsd = 0;
  let anyCost = false;
  for (const e of events) {
    if (e.stage !== stage) continue;
    const m = (e.metrics ?? {}) as EventMetrics;
    if (typeof m.durationMs === 'number' && m.durationMs > 0) {
      apiCalls += 1;
      computeMs += m.durationMs;
    }
    if (typeof m.inputTokens === 'number') inputTokens += m.inputTokens;
    if (typeof m.outputTokens === 'number') outputTokens += m.outputTokens;
    if (typeof m.reasoningTokens === 'number') reasoningTokens += m.reasoningTokens;
    if (typeof m.costUsd === 'number') {
      costUsd += m.costUsd;
      anyCost = true;
    }
  }

  const stageStartedMs = stageRow?.startedAt ? stageRow.startedAt.getTime() : null;
  const durationMs =
    stageStartedMs !== null ? Math.max(0, Date.now() - stageStartedMs) : null;

  return {
    apiCalls,
    durationMs,
    computeMs,
    inputTokens,
    outputTokens,
    reasoningTokens,
    costUsd: anyCost ? costUsd : null,
  };
}
