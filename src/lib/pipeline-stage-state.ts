import type { StageName } from '@/lib/workflows/lib/db-writes';

export const PIPELINE_STAGE_NAMES = [
  'extract_codes',
  'extract_milestones',
  'map_codes',
  'consolidate_primary',
  'consolidate_articles',
  'consolidate_sections',
  'literature_search',
] as const satisfies readonly StageName[];

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
