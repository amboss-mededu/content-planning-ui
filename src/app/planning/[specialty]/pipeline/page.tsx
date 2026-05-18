import { Suspense } from 'react';
import { getAmbossLibraryStats } from '@/lib/data/amboss-library';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listArticleSourceCount } from '@/lib/data/article-sources';
import { listConsolidatedArticles, listNewArticleSuggestions } from '@/lib/data/articles';
import { listCodeSources } from '@/lib/data/code-sources';
import {
  listCodeCategories,
  listCodeCount,
  listUnmappedCodeCount,
  listUnmappedCodesForPicker,
} from '@/lib/data/codes';
import { listMilestoneSources } from '@/lib/data/milestone-sources';
import {
  getCurrentPipelineRun,
  getLatestStageContexts,
  getMapCodesHistory,
} from '@/lib/data/pipeline';
import { listConsolidatedSections } from '@/lib/data/sections';
import {
  getPipelineStageOverrides,
  getPipelineStageSkipped,
  getSpecialty,
} from '@/lib/data/specialties';
import { SkeletonLine } from '../../_components/skeleton';
import { PipelineDashboard } from './_components/pipeline-dashboard';

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty: slug } = await params;
  return (
    <Suspense fallback={<PipelineSkeleton />}>
      <PipelineData slug={slug} />
    </Suspense>
  );
}

function PipelineSkeleton() {
  const cards = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {cards.map((k) => (
        <div
          key={k}
          style={{
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: '#fff',
          }}
        >
          <SkeletonLine width={'30%'} height={18} />
          <SkeletonLine width={'70%'} height={12} />
          <SkeletonLine width={'50%'} height={12} />
        </div>
      ))}
    </div>
  );
}

function deriveContentBase(region: string | undefined | null): string {
  if (region === 'us') return 'US';
  if (region === 'de') return 'German';
  return 'US';
}

async function PipelineData({ slug }: { slug: string }) {
  // Each stage's latest state comes from its own run, so a milestones-only run
  // doesn't wipe the codes card back to "pending."
  const [
    run,
    sources,
    milestoneSources,
    stageCtxs,
    unmappedCodeCount,
    libraryStats,
    specialty,
    codeCategories,
    unmappedCodePicker,
    mapCodesHistory,
    consolidatedArticleRecs,
    consolidatedSectionRecs,
    articleReviewRecs,
    newArticleSuggestionRecs,
    articleBacklogRecs,
    codeCount,
    articleSourceCount,
    stageOverrides,
    stageSkipped,
  ] = await Promise.all([
    getCurrentPipelineRun(slug),
    listCodeSources(),
    listMilestoneSources(),
    getLatestStageContexts(slug),
    listUnmappedCodeCount(slug),
    getAmbossLibraryStats(),
    getSpecialty(slug),
    listCodeCategories(slug),
    listUnmappedCodesForPicker(slug),
    getMapCodesHistory(slug),
    listConsolidatedArticles(slug),
    listConsolidatedSections(slug),
    listArticleReviews(slug),
    listNewArticleSuggestions(slug),
    listArticleBacklog(slug),
    listCodeCount(slug),
    listArticleSourceCount(slug),
    getPipelineStageOverrides(slug),
    getPipelineStageSkipped(slug),
  ]);

  // Stats for the "Articles (secondary)" card — the 2nd consolidation
  // pass should only ingest approved 1st-pass articles. Surface the
  // current approval state on the card so the editor sees what's gated.
  let approved = 0;
  let rejected = 0;
  for (const a of consolidatedArticleRecs) {
    const id = a.id;
    if (!id) continue;
    const r = articleReviewRecs[id];
    if (r?.status === 'approved') approved++;
    else if (r?.status === 'rejected') rejected++;
  }
  const articleApprovalStats = {
    total: consolidatedArticleRecs.length,
    approved,
    rejected,
    unreviewed: consolidatedArticleRecs.length - approved - rejected,
  };

  const stages = {
    extract_codes: stageCtxs.extract_codes ?? null,
    extract_milestones: stageCtxs.extract_milestones ?? null,
    map_codes: stageCtxs.map_codes ?? null,
    consolidate_primary: stageCtxs.consolidate_primary ?? null,
    consolidate_articles: stageCtxs.consolidate_articles ?? null,
    consolidate_sections: stageCtxs.consolidate_sections ?? null,
    literature_search: stageCtxs.literature_search ?? null,
  };

  // Backlog stats for the Literature search card. "waiting" covers
  // every approved 2nd-pass article whose effective backlog status is
  // unassigned / missing-row / waiting-for-sources — the same gate
  // the API route uses for eligibility.
  let waitingForSources = 0;
  let searched = 0;
  let laterStages = 0;
  let approvedNew = 0;
  // Eligibility list for the bulk-draft card. We collect the underlying
  // newArticleSuggestions PB ids so the card can POST them straight to
  // the bulk endpoint.
  const draftEligibleIds: string[] = [];
  for (const r of newArticleSuggestionRecs) {
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
    if (status === 'ready-for-llm-draft') draftEligibleIds.push(id);
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
      libraryStats={libraryStats}
      codeCategories={codeCategories}
      unmappedCodePicker={unmappedCodePicker}
      mapCodesHistory={mapCodesHistory}
      articleApprovalStats={articleApprovalStats}
      litSearchStats={litSearchStats}
      draftEligibleIds={draftEligibleIds}
      stageHasOutput={stageHasOutput}
      stageOverrides={stageOverrides}
      stageSkipped={stageSkipped}
    />
  );
}
