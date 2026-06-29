/**
 * Trigger endpoint for the per-category primary consolidation step.
 *
 * POST /api/workflows/consolidate-primary
 *   body: {
 *     specialtySlug: string;
 *     consolidationCategories?: string[]; // optional bucket filter; omit for all buckets
 *     categories?: string[]; // optional legacy/source-category filter
 *   }
 *
 * The runner is an LLM stub today — see `consolidation/prompts.ts`. It
 * still creates a real pipelineRuns row + `consolidate_primary` stage
 * and writes per-category staging rows, so the rest of the dashboard
 * (status, reset cascade, event log) behaves identically to the future
 * LLM-backed implementation.
 */

import { revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireArchitectResponse } from '@/lib/auth';
import { listMappedCodesWithSuggestionsAsAdmin } from '@/lib/data/codes';
import {
  createPipelineRun,
  initPipelineStage,
  updatePipelineRun,
} from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { errorMessage } from '@/lib/error-message';
import { parseBodyOr400 } from '@/lib/http/parse-body';
import { log } from '@/lib/log';
import { consolidateArticlesSecondaryWorkflow } from '@/lib/workflows/consolidation/articles-secondary';
import { consolidatePrimaryWorkflow } from '@/lib/workflows/consolidation/primary';
import { resetConsolidationScope } from '@/lib/workflows/consolidation/reset-scope';
import { consolidateSectionsSecondaryWorkflow } from '@/lib/workflows/consolidation/sections-secondary';
import type { ModelSpec } from '@/lib/workflows/lib/llm';
import { parseModelSpec } from '@/lib/workflows/lib/parse-model';
import { resolveApiKeysForRun } from '@/lib/workflows/lib/resolve-keys';

const Body = z.object({
  specialtySlug: z.string().optional(),
  consolidationCategories: z.unknown().optional(),
  categories: z.unknown().optional(),
  model: z.unknown().optional(),
  /** When true, the route waits for primary to finish then runs the two
   *  secondary stages in sequence on the same runId before responding.
   *  Used by the per-category "Start consolidation" button on the review
   *  page so one click produces end-to-end output. The pipeline-page
   *  start buttons leave this off and fire each stage individually. */
  chainSecondaries: z.boolean().optional(),
  /** Optional editor-supplied note. Prepended to the LLM user message
   *  as an `EDITOR INSTRUCTIONS` block for this run only. */
  editorNote: z.unknown().optional(),
});

const MAX_EDITOR_NOTE_LENGTH = 4000;

function parseEditorNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_EDITOR_NOTE_LENGTH);
}

const DEFAULT_CONSOLIDATION_MODEL: ModelSpec = {
  provider: 'google',
  model: 'gemini-3.1-pro-preview',
  reasoning: 'high',
};

function stringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out.length > 0 ? [...new Set(out)] : undefined;
}

export async function POST(req: NextRequest) {
  const guard = await requireArchitectResponse();
  if (guard) return guard;
  const body = await parseBodyOr400(req, Body);
  if (body instanceof NextResponse) return body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const consolidationCategories = stringArray(body.consolidationCategories) ?? null;
  const sourceCategories = stringArray(body.categories) ?? null;
  const modelParse = body.model
    ? parseModelSpec(body.model)
    : { ok: true as const, spec: DEFAULT_CONSOLIDATION_MODEL };
  if (!modelParse.ok) {
    return NextResponse.json({ error: `model: ${modelParse.error}` }, { status: 400 });
  }
  const model = modelParse.spec;

  // Readiness check: every targeted category must have all its codes
  // mapped, otherwise primary consolidation would silently skip the
  // unmapped rows (since the aggregator only sees `mappedAt > 0`).
  const mapped = await listMappedCodesWithSuggestionsAsAdmin(
    slug,
    consolidationCategories,
    sourceCategories,
  );
  if (mapped.length === 0) {
    return NextResponse.json(
      {
        error:
          consolidationCategories || sourceCategories
            ? 'No mapped codes match the selected categories.'
            : 'No mapped codes for this specialty. Run code mapping first.',
      },
      { status: 409 },
    );
  }

  const chain = body.chainSecondaries === true;
  const editorNote = parseEditorNote(body.editorNote);

  const apiKeys = await resolveApiKeysForRun([model.provider]);
  if (!apiKeys[model.provider]) {
    return NextResponse.json(
      {
        error: `No API key configured for ${model.provider}.`,
        code: 'MISSING_API_KEY',
        provider: model.provider,
      },
      { status: 409 },
    );
  }

  const { id: runId } = await createPipelineRun({
    specialtySlug: slug,
    targetCategories: consolidationCategories,
  });
  // Init stages and run the chain inside a single try so an early
  // failure (e.g. PB validation rejecting a stage create) doesn't leave
  // the just-created pipelineRuns row stuck on `status='running'` — a
  // stale row hides every targeted category in the review UI via the
  // useRerunningCategories live subscription.
  try {
    await initPipelineStage({ runId, stage: 'consolidate_primary' });
    if (chain) {
      // Pre-init the secondary stage rows so their workflow's markStageRunning
      // calls find a row to update. Single run carries all three stages.
      await initPipelineStage({ runId, stage: 'consolidate_articles' });
      await initPipelineStage({ runId, stage: 'consolidate_sections' });
    }
  } catch (e) {
    log('consolidate-primary').error('init failed', e);
    await updatePipelineRun(runId, {
      status: 'failed',
      finishedAt: Date.now(),
      error: errorMessage(e),
    }).catch(() => {});
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }

  let result: {
    stagingArticles: number;
    stagingSections: number;
    consolidatedArticles: number;
    consolidatedSections: number;
  } | null = null;
  if (chain) {
    // Synchronous chain: stubs are fast (no LLM calls today), and the
    // review page needs the final tables populated before we respond so
    // a router.refresh() on the client picks up the new rows. Switch to
    // fire-and-forget if a future LLM-backed runner makes this too slow.
    try {
      await resetConsolidationScope({
        specialtySlug: slug,
        consolidationCategories,
      });
      // Suppress each stage's own `pipelineRuns.status` update so the
      // run stays `running` for the full chain duration — otherwise the
      // primary stage flips status to `completed` mid-chain and the live
      // `useRerunningCategories` subscription drops the in-progress badge
      // before the secondaries finish. The route issues a single final
      // status flip below.
      const primaryStats = await consolidatePrimaryWorkflow({
        runId,
        specialtySlug: slug,
        consolidationCategories,
        sourceCategories,
        model,
        apiKeys,
        editorNote,
        skipRunStatusUpdate: true,
      });
      // Forward `consolidationCategories` so the secondaries'
      // wipe-and-replace is scoped to the same buckets — otherwise a
      // single-category re-run wipes every other category's consolidated output.
      const articlesStats = await consolidateArticlesSecondaryWorkflow({
        runId,
        specialtySlug: slug,
        categories: consolidationCategories,
        skipRunStatusUpdate: true,
      });
      const sectionsStats = await consolidateSectionsSecondaryWorkflow({
        runId,
        specialtySlug: slug,
        categories: consolidationCategories,
        skipRunStatusUpdate: true,
      });
      await updatePipelineRun(runId, {
        status: 'completed',
        finishedAt: Date.now(),
      });
      result = {
        stagingArticles: primaryStats.stagingArticles,
        stagingSections: primaryStats.stagingSections,
        consolidatedArticles: articlesStats.merged,
        consolidatedSections: sectionsStats.merged,
      };
      log('consolidate-primary').info('chained workflow result', {
        runId,
        specialtySlug: slug,
        consolidationCategories,
        sourceCategories,
        ...result,
      });
    } catch (e) {
      log('consolidate-primary').error('chained workflow failed', e);
      await updatePipelineRun(runId, {
        status: 'failed',
        finishedAt: Date.now(),
        error: errorMessage(e),
      }).catch(() => {});
      return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
    }
  } else {
    // Defer with `after()` so Next keeps the work alive past the response. A
    // bare `void ...()` is dropped once the handler returns and never runs.
    after(() =>
      (async () => {
        await resetConsolidationScope({
          specialtySlug: slug,
          consolidationCategories,
        });
        await consolidatePrimaryWorkflow({
          runId,
          specialtySlug: slug,
          consolidationCategories,
          sourceCategories,
          model,
          apiKeys,
          editorNote,
        });
      })().catch(async (e) => {
        log('consolidate-primary').error('workflow unhandled rejection', e);
        await updatePipelineRun(runId, {
          status: 'failed',
          finishedAt: Date.now(),
          error: errorMessage(e),
        }).catch(() => {});
      }),
    );
  }

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    result,
    consolidationCategories: consolidationCategories ?? null,
    categories: sourceCategories ?? null,
    mappedCodes: mapped.length,
    chained: chain,
  });
}
