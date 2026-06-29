/**
 * Milestone extraction (preprocessing stage).
 *
 * Single Gemini call across every provided URL (via `url_context`) produces a
 * plain-text milestones blob, which the user approves before it lands on
 * `specialties.milestones`.
 *
 * Approval is a hard split: `extractMilestonesPhase1` runs to
 * `awaiting_approval` (the draft is stashed on `pipelineStages.draftPayload`
 * as `{ milestones }`); the approve route handler invokes
 * `extractMilestonesPhase2` to finalise.
 */

import { getStageAsAdmin } from '@/lib/data/pipeline';
import { setPipelineStageStateAsAdmin } from '@/lib/data/specialties';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type { PipelineMode } from '@/lib/types';
import {
  markStageAwaitingApproval,
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
  writeApprovedMilestones,
} from '../lib/db-writes';
import { aggregateStageMetrics, logEvent } from '../lib/events';
import { type ExtractionVariant, extractMilestonesForInputs } from '../lib/gemini';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { revalidateSpecialtyCache } from '../lib/revalidate';
import type { ContentInput } from '../lib/sources';

export type ExtractMilestonesInput = {
  runId: string;
  specialtySlug: string;
  inputs: ContentInput[];
  milestonesInstructions?: string;
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
  /** Specialty run mode. `'curriculum-mapping'` swaps in the medical-student
   *  (Core EPAs) milestone prompt instead of the ACGME clinician one. */
  pipelineMode?: PipelineMode;
};

export async function extractMilestonesPhase1(
  input: ExtractMilestonesInput,
): Promise<void> {
  log('pipeline').info('extractMilestonesPhase1 start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    inputs: input.inputs.length,
  });

  try {
    await markStageRunning(input.runId, 'extract_milestones');
    await logEvent({
      runId: input.runId,
      stage: 'extract_milestones',
      level: 'info',
      message: `Run started for ${input.inputs.length} input(s)`,
    });

    const variant: ExtractionVariant =
      input.pipelineMode === 'curriculum-mapping' ? 'curriculum' : 'default';
    const milestones = await extractMilestonesForInputs({
      inputs: input.inputs,
      specialtySlug: input.specialtySlug,
      additionalInstructions: input.milestonesInstructions,
      runId: input.runId,
      stage: 'extract_milestones',
      model: input.model,
      apiKeys: input.apiKeys,
      variant,
    });

    const totals = await aggregateStageMetrics(input.runId, 'extract_milestones');
    await markStageAwaitingApproval(
      input.runId,
      'extract_milestones',
      {
        chars: milestones.length,
        inputs: input.inputs.length,
        apiCalls: totals.apiCalls,
        durationMs: totals.durationMs,
        computeMs: totals.computeMs,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        reasoningTokens: totals.reasoningTokens,
        costUsd: totals.costUsd,
      },
      { milestones },
    );
    await logEvent({
      runId: input.runId,
      stage: 'extract_milestones',
      level: 'info',
      message: `Extraction complete. Awaiting approval — ${milestones.length} chars drafted.`,
      metrics: {
        durationMs: totals.durationMs ?? undefined,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        reasoningTokens: totals.reasoningTokens,
        costUsd: totals.costUsd,
      },
    });
    await revalidateSpecialtyCache(input.specialtySlug);
  } catch (e) {
    const msg = errorMessage(e);
    await markStageFailed(input.runId, 'extract_milestones', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}

/**
 * Continuation invoked by /api/workflows/approve. Reads the draft milestones
 * blob off the staged stage row and either commits it to
 * `specialties.milestones` (approve) or marks the stage failed (reject).
 */
export async function extractMilestonesPhase2(input: {
  runId: string;
  specialtySlug: string;
  approved: boolean;
  approvedBy?: string;
  note?: string;
}): Promise<void> {
  log('pipeline').info('extractMilestonesPhase2', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    approved: input.approved,
  });

  try {
    if (!input.approved) {
      const reason = input.note ? `: ${input.note}` : '';
      await markStageFailed(input.runId, 'extract_milestones', `Rejected${reason}`);
      await updatePipelineRunStatus(input.runId, 'cancelled', 'Rejected');
      await revalidateSpecialtyCache(input.specialtySlug);
      return;
    }
    const stage = await getStageAsAdmin({
      runId: input.runId,
      stage: 'extract_milestones',
    });
    const draft = stage?.draftPayload as { milestones?: string } | null;
    const milestones = draft?.milestones;
    if (typeof milestones !== 'string' || milestones.length === 0) {
      throw new Error('No drafted milestones blob found on stage row');
    }
    await writeApprovedMilestones(input.specialtySlug, milestones);
    await markStageCompleted(input.runId, 'extract_milestones', input.approvedBy);
    // Auto-flip the card to "Completed" (the badge reflects the manual state).
    await setPipelineStageStateAsAdmin(
      input.specialtySlug,
      'extract_milestones',
      'complete',
    );
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
  } catch (e) {
    const msg = errorMessage(e);
    await markStageFailed(input.runId, 'extract_milestones', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
