import type { PipelineMode } from '@/lib/types';
import type { StageName } from '@/lib/workflows/lib/db-writes';

export const PIPELINE_STAGE_NAMES = [
  'extract_codes',
  'extract_milestones',
  'map_codes',
  'map_suggestions',
  'consolidate_primary',
  'consolidate_articles',
  'consolidate_sections',
  'literature_search',
] as const satisfies readonly StageName[];

/**
 * Stages shown in the high-level Overview strip, by workflow mode.
 * `map_suggestions` is a conditional backfill stage (surfaced only on the
 * pipeline dashboard), so it's excluded here.
 * - `mapping-only`       → preprocessing + mapping, nothing downstream.
 * - `curriculum-mapping` → preprocessing + mapping (AMBOSS only), nothing downstream.
 * - `rag-corpus`         → preprocessing + mapping + literature search (the corpus).
 * - `full`               → everything except the conditional `map_suggestions`.
 */
export function visiblePipelineStages(mode: PipelineMode): readonly StageName[] {
  if (mode === 'mapping-only' || mode === 'curriculum-mapping')
    return ['extract_codes', 'extract_milestones', 'map_codes'];
  if (mode === 'rag-corpus') {
    return ['extract_codes', 'extract_milestones', 'map_codes', 'literature_search'];
  }
  return PIPELINE_STAGE_NAMES.filter((s) => s !== 'map_suggestions');
}

export const SKIPPABLE_PIPELINE_STAGES = [
  'consolidate_articles',
  'consolidate_sections',
] as const satisfies readonly StageName[];

export type PipelineCardState = 'not_started' | 'in_progress' | 'complete' | 'skipped';

export type PipelineStageStates = Partial<Record<StageName, PipelineCardState>>;

const STAGE_SET = new Set<string>(PIPELINE_STAGE_NAMES);
const STATE_SET = new Set<string>(['not_started', 'in_progress', 'complete', 'skipped']);
const SKIPPABLE_SET = new Set<string>(SKIPPABLE_PIPELINE_STAGES);

export function isPipelineStageName(value: string): value is StageName {
  return STAGE_SET.has(value);
}

export function isPipelineCardState(value: string): value is PipelineCardState {
  return STATE_SET.has(value);
}

export function canSkipPipelineStage(stageName: string): boolean {
  return SKIPPABLE_SET.has(stageName);
}

/**
 * A stage whose `status` is still `'running'` but whose `startedAt` is older
 * than this is treated as jammed, not live. A fire-and-forget workflow that
 * crashes (or whose deferred body is dropped) leaves the stage pinned at
 * `'running'` forever; without this guard the UI would animate "Running…" and
 * disable the Start button indefinitely.
 */
export const FRESH_RUNNING_MS = 15 * 60 * 1000;

/**
 * True when a stage is genuinely running *right now* — `status === 'running'`
 * and it started within `FRESH_RUNNING_MS`.
 *
 * `startedAt` arrives in three shapes depending on the caller: a number (raw PB
 * record, server-side), a `Date` (mapped row), or a string (a `Date` serialized
 * across the RSC → client boundary). All three are coerced to epoch ms. If it's
 * unreadable we **fail open** — a stage marked `running` is shown as running
 * rather than silently hidden — so the freshness guard can only ever suppress a
 * stage we can prove is stale, never an active one.
 */
export function isStageRunningFresh(
  stage: { status: string; startedAt?: number | Date | string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!stage || stage.status !== 'running') return false;
  const raw = stage.startedAt;
  const startedAt =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Date.parse(raw)
          : Number.NaN;
  if (!Number.isFinite(startedAt)) return true;
  return startedAt > now - FRESH_RUNNING_MS;
}

export function normalizePipelineStageStates(input: {
  states?: Record<string, unknown> | null;
  overrides?: Record<string, unknown> | null;
  skipped?: Record<string, unknown> | null;
}): PipelineStageStates {
  const out: PipelineStageStates = {};
  for (const stageName of PIPELINE_STAGE_NAMES) {
    const state = input.states?.[stageName];
    if (typeof state === 'string' && isPipelineCardState(state)) {
      out[stageName] =
        state === 'skipped' && !canSkipPipelineStage(stageName) ? 'not_started' : state;
      continue;
    }
    if (input.skipped?.[stageName] === true && canSkipPipelineStage(stageName)) {
      out[stageName] = 'skipped';
    } else if (input.overrides?.[stageName] === true) {
      out[stageName] = 'complete';
    } else {
      out[stageName] = 'not_started';
    }
  }
  return out;
}
