'use client';

import {
  Callout,
  Card,
  CardBox,
  H2,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { PipelineRunRow, StageContext } from '@/lib/data/pipeline';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { BulkDraftArticlesButton } from './bulk-draft-card';
import { PhaseGroup } from './phase-group';
import { RunMapAllButton } from './run-all-mappings-button';
import { RunConsolidationButton } from './run-consolidation-button';
import { RunLitSearchButton } from './run-lit-search-button';
import { StageCard } from './stage-card';
import { StartCodesModal } from './start-codes-modal';
import { StartMilestonesModal } from './start-milestones-modal';

type StagesMap = Record<StageName, StageContext | null>;

function stageState(
  states: PipelineStageStates,
  stageName: StageName,
): NonNullable<PipelineStageStates[StageName]> {
  return states[stageName] ?? 'not_started';
}

export function PipelineDashboard({
  specialtySlug,
  run,
  stages,
  sources,
  milestoneSources,
  unmappedCodeCount,
  defaultContentBase,
  mappedCodeCount,
  litSearchStats,
  draftEligibleIds,
  stageHasOutput,
  stageStates,
}: {
  specialtySlug: string;
  run: PipelineRunRow | null;
  stages: StagesMap;
  sources: CodeSource[];
  milestoneSources: CodeSource[];
  unmappedCodeCount: number;
  defaultContentBase: string;
  mappedCodeCount: number;
  litSearchStats: {
    approvedTotal: number;
    waitingForSources: number;
    searched: number;
    laterStages: number;
  };
  /** newArticleSuggestions PB ids whose backlog status is
   *  `ready-for-llm-draft` — eligible to enqueue for article writing. */
  draftEligibleIds: string[];
  stageHasOutput: Record<string, boolean>;
  stageStates: PipelineStageStates;
}) {
  const runActive =
    run !== null &&
    run.status !== 'completed' &&
    run.status !== 'failed' &&
    run.status !== 'cancelled';
  const hasUnmappedCodes = unmappedCodeCount > 0;
  const router = useRouter();

  useEffect(() => {
    if (!runActive) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [runActive, router]);

  return (
    <Stack space="l">
      {runActive ? (
        <Inline space="s" vAlignItems="center">
          <Text color="secondary">
            Live · polling every 2s · workflow run{' '}
            <code>{run.workflowRunId ?? run.id}</code>
          </Text>
        </Inline>
      ) : null}
      {run?.error ? <Callout type="error" text={run.error} /> : null}

      <PhaseGroup title="Preprocessing">
        <Stack space="m">
          <StageCard
            title="Extract codes"
            description="Identify modules per PDF, then extract discrete items per module."
            stage={stages.extract_codes?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="extract_codes"
            runUrls={stages.extract_codes?.runUrls}
            events={stages.extract_codes?.events ?? []}
            sources={sources}
            hasOutput={stageHasOutput.extract_codes ?? false}
            manualState={stageState(stageStates, 'extract_codes')}
          >
            <StartCodesModal
              specialtySlug={specialtySlug}
              sources={sources}
              running={stages.extract_codes?.stage.status === 'running'}
            />
          </StageCard>
          <StageCard
            title="Extract milestones"
            description="Extract ACGME-style milestones for this specialty."
            stage={stages.extract_milestones?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="extract_milestones"
            runUrls={stages.extract_milestones?.runUrls}
            events={stages.extract_milestones?.events ?? []}
            sources={milestoneSources}
            hasOutput={stageHasOutput.extract_milestones ?? false}
            manualState={stageState(stageStates, 'extract_milestones')}
          >
            <StartMilestonesModal
              specialtySlug={specialtySlug}
              sources={milestoneSources}
              running={stages.extract_milestones?.stage.status === 'running'}
            />
          </StageCard>
        </Stack>
      </PhaseGroup>

      <PhaseGroup title="Mapping">
        <StageCard
          title="Map codes"
          description="Per-code LLM + AMBOSS MCP lookup. Runs once preprocessing is approved."
          stage={stages.map_codes?.stage ?? null}
          specialtySlug={specialtySlug}
          stageName="map_codes"
          events={stages.map_codes?.events ?? []}
          treatAsInProgress={hasUnmappedCodes}
          unmappedCount={unmappedCodeCount}
          mappedCount={mappedCodeCount}
          hasOutput={stageHasOutput.map_codes ?? false}
          manualState={stageState(stageStates, 'map_codes')}
        >
          <RunMapAllButton
            specialtySlug={specialtySlug}
            unmappedCount={unmappedCodeCount}
            defaultContentBase={defaultContentBase}
            running={stages.map_codes?.stage.status === 'running'}
          />
        </StageCard>
      </PhaseGroup>

      <PhaseGroup title="Suggestion consolidation">
        <Stack space="m">
          <StageCard
            title="Primary (per category)"
            description="Combine mappings into new-article and article-update candidates."
            stage={stages.consolidate_primary?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="consolidate_primary"
            events={stages.consolidate_primary?.events ?? []}
            hasOutput={stageHasOutput.consolidate_primary ?? false}
            manualState={stageState(stageStates, 'consolidate_primary')}
          >
            <RunConsolidationButton
              specialtySlug={specialtySlug}
              mappedCodeCount={mappedCodeCount}
            />
          </StageCard>
          <StageCard
            title="Articles (2nd consolidation)"
            description="Optional second pass over new-article candidates."
            stage={stages.consolidate_articles?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="consolidate_articles"
            events={stages.consolidate_articles?.events ?? []}
            hasOutput={stageHasOutput.consolidate_articles ?? false}
            manualState={stageState(stageStates, 'consolidate_articles')}
          />
          <StageCard
            title="Sections (2nd consolidation)"
            description="Optional second pass over article-update section candidates."
            stage={stages.consolidate_sections?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="consolidate_sections"
            events={stages.consolidate_sections?.events ?? []}
            hasOutput={stageHasOutput.consolidate_sections ?? false}
            manualState={stageState(stageStates, 'consolidate_sections')}
          />
        </Stack>
      </PhaseGroup>

      <H2>Articles</H2>
      <Stack space="m">
        <StageCard
          title="Literature search"
          description={
            litSearchStats.approvedTotal === 0
              ? 'Run a PubMed literature search for each approved article waiting for sources. Approve articles on the New Articles tab first; this card stays idle until at least one is waiting.'
              : `Run a PubMed literature search for each approved article waiting for sources. Currently ${litSearchStats.waitingForSources} waiting · ${litSearchStats.searched} already searched · ${litSearchStats.laterStages} further along.`
          }
          stage={stages.literature_search?.stage ?? null}
          specialtySlug={specialtySlug}
          stageName="literature_search"
          events={stages.literature_search?.events ?? []}
          hasOutput={stageHasOutput.literature_search ?? false}
          manualState={stageState(stageStates, 'literature_search')}
        >
          <RunLitSearchButton
            specialtySlug={specialtySlug}
            waitingCount={litSearchStats.waitingForSources}
            running={stages.literature_search?.stage.status === 'running'}
          />
        </StageCard>
        <Card outlined>
          <CardBox>
            <Stack space="s">
              <H2>Draft articles</H2>
              <Text size="s" color="secondary">
                {draftEligibleIds.length === 0
                  ? 'Enqueue the 6-pass LLM article draft for every article in Ready for LLM draft. The dispatcher runs at most 3 concurrently. No articles are currently ready.'
                  : `Enqueue the 6-pass LLM article draft for every article in Ready for LLM draft. The dispatcher runs at most 3 concurrently. ${draftEligibleIds.length} article${draftEligibleIds.length === 1 ? '' : 's'} ready.`}
              </Text>
              <BulkDraftArticlesButton
                specialtySlug={specialtySlug}
                articleRecordIds={draftEligibleIds}
              />
            </Stack>
          </CardBox>
        </Card>
        <Card outlined>
          <CardBox>
            <Stack space="s">
              <H2>Content drafting</H2>
              <Text size="s" color="secondary">
                Full content drafting pipeline. Work in progress.
              </Text>
            </Stack>
          </CardBox>
        </Card>
      </Stack>
    </Stack>
  );
}
