/**
 * Code extraction (preprocessing stage).
 *
 * Mirrors the n8n pipeline at `n8n_workflows/code_extraction/`:
 *   1. Phase 1 — per PDF URL, identify module/chapter headings (Gemini call).
 *   2. Phase 2 — per (url, module), extract discrete medical items.
 *   3. Assemble `ab_<slug>_<nnnn>` codes and stage them.
 *   4. Promote staged rows straight into the canonical `codes` table.
 *
 * There is no approval gate: `extractCodesPhase1` runs end-to-end and, on
 * success, clears the specialty's existing codes and promotes the freshly
 * extracted rows into `codes` (so a re-run replaces rather than appends),
 * then marks the run completed. The route fires Phase 1 via `after()` so the
 * HTTP response returns immediately while extraction continues in the
 * background. `extractCodesPhase2` is kept only to resolve any legacy
 * `awaiting_approval` runs via /api/workflows/approve.
 */

import { deleteCodesForSpecialtyAsAdmin } from '@/lib/data/codes';
import { setPipelineStageStateAsAdmin } from '@/lib/data/specialties';
import {
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  promoteExtractedCodesToCodes,
  updatePipelineRunStatus,
  writeExtractedCodes,
} from '../lib/db-writes';
import { aggregateStageMetrics, logEvent } from '../lib/events';
import { extractCodesForCategory, identifyModulesForUrl } from '../lib/gemini';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { revalidateSpecialtyCache } from '../lib/revalidate';
import type { ContentInput } from '../lib/sources';
import { chunk } from '../lib/util';

const URL_CONCURRENCY = 10;
const CATEGORY_CONCURRENCY = 10;

export type ExtractCodesInput = {
  runId: string;
  specialtySlug: string;
  inputs: ContentInput[];
  identifyInstructions?: string;
  extractInstructions?: string;
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
};

export async function extractCodesPhase1(input: ExtractCodesInput): Promise<void> {
  console.log('[pipeline] extractCodesPhase1 start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    inputs: input.inputs.length,
  });

  try {
    await markStageRunning(input.runId, 'extract_codes');
    await logEvent({
      runId: input.runId,
      stage: 'extract_codes',
      level: 'info',
      message: `Run started for ${input.inputs.length} input(s)`,
    });

    // Phase 1: identify modules per (url, source), batched fan-out.
    const perUrlCategories: { url: string; source: string; category: string }[] = [];
    for (const batch of chunk(input.inputs, URL_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map((inp) =>
          identifyModulesForUrl({
            url: inp.url,
            source: inp.source,
            additionalInstructions: input.identifyInstructions,
            specialtySlug: input.specialtySlug,
            runId: input.runId,
            stage: 'extract_codes',
            model: input.model,
            apiKeys: input.apiKeys,
          }),
        ),
      );
      results.forEach((mods, i) => {
        const { url, source } = batch[i];
        for (const m of mods)
          perUrlCategories.push({ url, source, category: m.category });
      });
    }
    await logEvent({
      runId: input.runId,
      stage: 'extract_codes',
      level: 'info',
      message: `Phase 1 complete: ${perUrlCategories.length} modules across ${input.inputs.length} input(s). Starting Phase 2.`,
    });

    // Phase 2: extract codes per (url, module, source), batched fan-out.
    // `consolidationCategory` is the Phase 1 module name — stamped on every
    // code produced from that module so downstream consolidation can fan out
    // per-module without re-deriving chunks.
    const extracted: {
      category: string;
      description: string;
      source: string;
      consolidationCategory: string;
    }[] = [];
    for (const batch of chunk(perUrlCategories, CATEGORY_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map((p) =>
          extractCodesForCategory({
            url: p.url,
            source: p.source,
            category: p.category,
            specialtySlug: input.specialtySlug,
            additionalInstructions: input.extractInstructions,
            runId: input.runId,
            stage: 'extract_codes',
            model: input.model,
            apiKeys: input.apiKeys,
          }),
        ),
      );
      results.forEach((items, i) => {
        const { source, category: consolidationCategory } = batch[i];
        for (const it of items) extracted.push({ ...it, source, consolidationCategory });
      });
    }

    // Number codes per-source so each namespace starts at 0001.
    const perSourceCounts: Record<string, number> = {};
    const rawCodes = extracted.map((c) => {
      const n = (perSourceCounts[c.source] ?? 0) + 1;
      perSourceCounts[c.source] = n;
      return {
        code: `${c.source}_${input.specialtySlug}_${String(n).padStart(4, '0')}`,
        category: c.category,
        consolidationCategory: c.consolidationCategory,
        description: c.description,
        source: c.source,
      };
    });

    const { inserted } = await writeExtractedCodes(
      input.runId,
      input.specialtySlug,
      rawCodes,
    );
    const totals = await aggregateStageMetrics(input.runId, 'extract_codes');
    const summary = {
      extracted: inserted,
      pdfs: input.inputs.length,
      modules: perUrlCategories.length,
      apiCalls: totals.apiCalls,
      durationMs: totals.durationMs,
      computeMs: totals.computeMs,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      reasoningTokens: totals.reasoningTokens,
      costUsd: totals.costUsd,
    };
    // No approval gate: promote straight into the canonical `codes` table so the
    // codes appear in Mapping/Categories immediately. Clear the specialty's
    // existing codes first so a re-run replaces rather than duplicates — the
    // `codes` schema has no unique constraint on `code`, and bulk insert is
    // create-only.
    await deleteCodesForSpecialtyAsAdmin(input.specialtySlug);
    await promoteExtractedCodesToCodes(input.runId, input.specialtySlug);
    await markStageCompleted(input.runId, 'extract_codes', undefined, summary);
    // Auto-flip the card to "Completed" — the badge reflects the manual stage
    // state, so without this a finished run would still read "Not started".
    await setPipelineStageStateAsAdmin(input.specialtySlug, 'extract_codes', 'complete');
    await updatePipelineRunStatus(input.runId, 'completed');
    await logEvent({
      runId: input.runId,
      stage: 'extract_codes',
      level: 'info',
      message: `Extraction complete — ${inserted} codes added.`,
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
    const msg = e instanceof Error ? e.message : String(e);
    await markStageFailed(input.runId, 'extract_codes', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}

/**
 * Continuation invoked by /api/workflows/approve once the operator approves
 * (or rejects) the staged extraction. Promotes staged rows into the
 * canonical `codes` table on approval; marks the stage failed on rejection.
 */
export async function extractCodesPhase2(input: {
  runId: string;
  specialtySlug: string;
  approved: boolean;
  approvedBy?: string;
  note?: string;
}): Promise<void> {
  console.log('[pipeline] extractCodesPhase2', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    approved: input.approved,
  });

  try {
    if (!input.approved) {
      const reason = input.note ? `: ${input.note}` : '';
      await markStageFailed(input.runId, 'extract_codes', `Rejected${reason}`);
      await updatePipelineRunStatus(input.runId, 'cancelled', 'Rejected');
      await revalidateSpecialtyCache(input.specialtySlug);
      return;
    }
    await promoteExtractedCodesToCodes(input.runId, input.specialtySlug);
    await markStageCompleted(input.runId, 'extract_codes', input.approvedBy);
    // Single-stage pipeline for now — finalize the run so the UI stops showing
    // it as active. When the preprocessing orchestrator + mapping/consolidation
    // pieces land, this will move to a top-level orchestrator instead.
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markStageFailed(input.runId, 'extract_codes', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
