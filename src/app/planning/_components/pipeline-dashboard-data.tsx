import { listArticleBacklog } from '@/lib/data/article-backlog';
import { listArticleReviews } from '@/lib/data/article-reviews';
import {
  listArticleSourceCount,
  listArticleSourcesByArticleKey,
} from '@/lib/data/article-sources';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listCategoryOrchestration } from '@/lib/data/categories';
import { listCodeSources } from '@/lib/data/code-sources';
import {
  countMappedWithoutSuggestions,
  listCodeCount,
  listUnmappedCodeCount,
} from '@/lib/data/codes';
import { listMilestoneSources } from '@/lib/data/milestone-sources';
import { getCurrentPipelineRun, getLatestStageContexts } from '@/lib/data/pipeline';
import { listConsolidatedSections } from '@/lib/data/sections';
import { getPipelineStageStates, getSpecialty } from '@/lib/data/specialties';
import { PipelineDashboard } from '../[specialty]/pipeline/_components/pipeline-dashboard';
import { canStartDraft } from './pipeline-stage-gates';

function deriveContentBase(region: string | undefined | null): string {
  if (region === 'us') return 'US';
  if (region === 'de') return 'German';
  return 'US';
}

/**
 * Fetches everything the pipeline dashboard needs and renders it. Shared by the
 * Content Planner specialty pipeline page and the Teaching curriculum pipeline
 * page — `basePath` controls which URL prefix in-dashboard navigation uses.
 */
export async function PipelineDashboardData({
  slug,
  basePath = '/planning',
}: {
  slug: string;
  basePath?: string;
}) {
  // Each stage's latest state comes from its own run, so a milestones-only run
  // doesn't wipe the codes card back to "pending."
  const [
    run,
    sources,
    milestoneSources,
    stageCtxs,
    codeCount,
    unmappedCodeCount,
    specialty,
    consolidatedArticleRecs,
    consolidatedSectionRecs,
    articleReviewRecs,
    articleBacklogRecs,
    articleSourceCount,
    sourcesByKey,
    stageStates,
    orchestration,
    mappedWithoutSuggestionsCount,
  ] = await Promise.all([
    getCurrentPipelineRun(slug),
    listCodeSources(),
    listMilestoneSources(),
    getLatestStageContexts(slug),
    listCodeCount(slug),
    listUnmappedCodeCount(slug),
    getSpecialty(slug),
    listConsolidatedArticles(slug),
    listConsolidatedSections(slug),
    listArticleReviews(slug),
    listArticleBacklog(slug),
    listArticleSourceCount(slug),
    listArticleSourcesByArticleKey(slug),
    getPipelineStageStates(slug),
    listCategoryOrchestration(slug),
    countMappedWithoutSuggestions(slug),
  ]);

  const staleBucketCount = orchestration.filter((o) => o.isStale).length;
  const mappingOnly = specialty?.mappingOnly ?? false;
  const pipelineMode = specialty?.pipelineMode ?? 'full';

  const stages = {
    extract_codes: stageCtxs.extract_codes ?? null,
    extract_milestones: stageCtxs.extract_milestones ?? null,
    map_codes: stageCtxs.map_codes ?? null,
    map_suggestions: stageCtxs.map_suggestions ?? null,
    consolidate_primary: stageCtxs.consolidate_primary ?? null,
    consolidate_articles: stageCtxs.consolidate_articles ?? null,
    consolidate_sections: stageCtxs.consolidate_sections ?? null,
    literature_search: stageCtxs.literature_search ?? null,
  };

  // Backlog stats for the Literature search card. "waiting" covers
  // every approved article whose effective backlog status is
  // unassigned / missing-row / waiting-for-sources — the same gate
  // the API route uses for eligibility.
  let waitingForSources = 0;
  let searched = 0;
  let laterStages = 0;
  let approvedNew = 0;
  // Eligibility list for the bulk-draft card. An article is draftable once
  // its sources are settled — at least one approved source and every approved
  // source carrying a Cortex ID (`canStartDraft`). This mirrors the modal's
  // per-article Draft button and is a strict subset of the write-article
  // endpoint's own gate, so every counted article actually enqueues. The
  // backlog status is no longer consulted (the collapsed badge can't sit at
  // `ready-for-llm-draft` anymore). We collect the underlying
  // consolidatedArticles PB ids so the card can POST them straight to the
  // bulk endpoint.
  const draftEligibleIds: string[] = [];
  for (const r of consolidatedArticleRecs) {
    const id = r.id;
    const key = r.articleKey;
    if (!id || !key) continue;
    if (articleReviewRecs[key]?.status !== 'approved') continue;
    approvedNew++;
    const status = articleBacklogRecs[key]?.status;
    if (
      status === undefined ||
      status === 'unassigned' ||
      status === 'waiting-for-sources'
    ) {
      waitingForSources++;
    } else if (status === 'sources-searched') {
      searched++;
    } else {
      laterStages++;
    }
    if (canStartDraft(sourcesByKey[key] ?? [])) draftEligibleIds.push(id);
  }
  const litSearchStats = {
    approvedTotal: approvedNew,
    waitingForSources,
    searched,
    laterStages,
  };

  // Specialty type from the repository layer doesn't expose `region`; read
  // directly from the underlying row via the getSpecialty-adjacent helper
  // once we've confirmed the record exists. For now, default to US.
  const defaultContentBase = deriveContentBase(
    (specialty as { region?: string | null } | null)?.region,
  );

  // Per-stage "has any output" gates for the manual mark-complete
  // button. 2nd-consolidation stages are intentionally always enabled
  // (the pass can legitimately produce nothing). Each gate is the
  // cheapest signal that proves the stage did something.
  const milestonesText =
    typeof (specialty as { milestones?: string | null } | null)?.milestones ===
      'string' &&
    ((specialty as { milestones?: string | null }).milestones ?? '').length > 0;
  const mappedCount = codeCount - unmappedCodeCount;
  const consolidationsOutput =
    consolidatedArticleRecs.length + consolidatedSectionRecs.length > 0;
  const stageHasOutput: Record<string, boolean> = {
    extract_codes: codeCount > 0,
    extract_milestones: milestonesText,
    map_codes: mappedCount > 0,
    // Output exists once at least one mapped code has been given suggestions.
    map_suggestions: mappedCount > mappedWithoutSuggestionsCount,
    consolidate_primary: consolidationsOutput,
    consolidate_articles: true,
    consolidate_sections: true,
    literature_search: articleSourceCount > 0,
  };

  return (
    <PipelineDashboard
      specialtySlug={slug}
      run={run}
      sources={sources.map((s) => ({ slug: s.slug, name: s.name }))}
      milestoneSources={milestoneSources.map((s) => ({ slug: s.slug, name: s.name }))}
      stages={stages}
      unmappedCodeCount={unmappedCodeCount}
      defaultContentBase={defaultContentBase}
      mappedCodeCount={mappedCount}
      litSearchStats={litSearchStats}
      draftEligibleIds={draftEligibleIds}
      stageHasOutput={stageHasOutput}
      stageStates={stageStates}
      staleBucketCount={staleBucketCount}
      mappingOnly={mappingOnly}
      pipelineMode={pipelineMode}
      mappedWithoutSuggestionsCount={mappedWithoutSuggestionsCount}
      basePath={basePath}
    />
  );
}
