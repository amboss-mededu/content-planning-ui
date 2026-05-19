/**
 * Trigger endpoint for the per-category primary consolidation step.
 *
 * POST /api/workflows/consolidate-primary
 *   body: {
 *     specialtySlug: string;
 *     categories?: string[];  // optional filter; omit for all mapped categories
 *   }
 *
 * The runner is an LLM stub today — see `consolidation/prompts.ts`. It
 * still creates a real pipelineRuns row + `consolidate_primary` stage
 * and writes per-category staging rows, so the rest of the dashboard
 * (status, reset cascade, event log) behaves identically to the future
 * LLM-backed implementation.
 */

import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { requireUserResponse } from '@/lib/auth';
import { listMappedCodesWithSuggestionsAsAdmin } from '@/lib/data/codes';
import { createPipelineRun, initPipelineStage } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { consolidateArticlesSecondaryWorkflow } from '@/lib/workflows/consolidation/articles-secondary';
import { consolidatePrimaryWorkflow } from '@/lib/workflows/consolidation/primary';
import { consolidateSectionsSecondaryWorkflow } from '@/lib/workflows/consolidation/sections-secondary';

type Body = {
  specialtySlug?: string;
  categories?: unknown;
  /** When true, the route waits for primary to finish then runs the two
   *  secondary stages in sequence on the same runId before responding.
   *  Used by the per-category "Start consolidation" button on the review
   *  page so one click produces end-to-end output. The pipeline-page
   *  start buttons leave this off and fire each stage individually. */
  chainSecondaries?: boolean;
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
  const guard = await requireUserResponse();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.specialtySlug;
  if (!slug) {
    return NextResponse.json({ error: 'specialtySlug required' }, { status: 400 });
  }

  const spec = await getSpecialty(slug);
  if (!spec) {
    return NextResponse.json({ error: `specialty not found: ${slug}` }, { status: 404 });
  }

  const categories = stringArray(body.categories) ?? null;

  // Readiness check: every targeted category must have all its codes
  // mapped, otherwise primary consolidation would silently skip the
  // unmapped rows (since the aggregator only sees `mappedAt > 0`).
  const mapped = await listMappedCodesWithSuggestionsAsAdmin(slug, categories);
  if (mapped.length === 0) {
    return NextResponse.json(
      {
        error: categories
          ? 'No mapped codes match the selected categories.'
          : 'No mapped codes for this specialty. Run code mapping first.',
      },
      { status: 409 },
    );
  }

  const chain = body.chainSecondaries === true;

  const { id: runId } = await createPipelineRun({
    specialtySlug: slug,
    targetCategories: categories,
  });
  await initPipelineStage({ runId, stage: 'consolidate_primary' });
  if (chain) {
    // Pre-init the secondary stage rows so their workflow's markStageRunning
    // calls find a row to update. Single run carries all three stages.
    await initPipelineStage({ runId, stage: 'consolidate_articles' });
    await initPipelineStage({ runId, stage: 'consolidate_sections' });
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
      const primaryStats = await consolidatePrimaryWorkflow({
        runId,
        specialtySlug: slug,
        categories,
      });
      // Forward `categories` so the secondaries' wipe-and-replace is
      // scoped to the same buckets — otherwise a single-category re-run
      // wipes every other category's consolidated output.
      const articlesStats = await consolidateArticlesSecondaryWorkflow({
        runId,
        specialtySlug: slug,
        categories,
      });
      const sectionsStats = await consolidateSectionsSecondaryWorkflow({
        runId,
        specialtySlug: slug,
        categories,
      });
      result = {
        stagingArticles: primaryStats.stagingArticles,
        stagingSections: primaryStats.stagingSections,
        consolidatedArticles: articlesStats.merged,
        consolidatedSections: sectionsStats.merged,
      };
    } catch (e) {
      console.error('[consolidate-primary] chained workflow failed', e);
      // The runners themselves already marked their stage failed and
      // flipped the run status. Surface as 500 so the UI shows an error.
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  } else {
    void consolidatePrimaryWorkflow({
      runId,
      specialtySlug: slug,
      categories,
    }).catch((e) => {
      console.error('[consolidate-primary] workflow unhandled rejection', e);
    });
  }

  revalidateTag(`pipeline:${slug}`, 'max');
  revalidateTag('specialty-phases', 'max');

  return NextResponse.json({
    runId,
    specialty: slug,
    result,
    categories: categories ?? null,
    mappedCodes: mapped.length,
    chained: chain,
  });
}
