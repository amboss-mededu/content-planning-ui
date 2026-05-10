'use client';

import {
  Button,
  Callout,
  Card,
  CardBox,
  H2,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AmbossLibraryStats } from '@/lib/data/amboss-library';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import type { MapCodesHistory, PipelineRunRow, StageContext } from '@/lib/data/pipeline';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { PhaseGroup } from './phase-group';
import { SourcesCard } from './sources-card';
import { StageCard } from './stage-card';
import { StartMapCodesForm } from './start-map-codes-form';
import { StartMilestonesForm } from './start-milestones-form';
import { StartRunForm } from './start-run-form';

type StagesMap = Record<StageName, StageContext | null>;

export type ArticleApprovalStats = {
  total: number;
  approved: number;
  rejected: number;
  unreviewed: number;
};

export function PipelineDashboard({
  specialtySlug,
  run,
  stages,
  sources,
  milestoneSources,
  unmappedCodeCount,
  defaultContentBase,
  libraryStats,
  codeCategories,
  unmappedCodePicker,
  mapCodesHistory,
  articleApprovalStats,
}: {
  specialtySlug: string;
  run: PipelineRunRow | null;
  stages: StagesMap;
  sources: CodeSource[];
  milestoneSources: CodeSource[];
  unmappedCodeCount: number;
  defaultContentBase: string;
  libraryStats: AmbossLibraryStats;
  codeCategories: CodeCategorySummary[];
  unmappedCodePicker: UnmappedCodePickerRow[];
  mapCodesHistory: MapCodesHistory;
  articleApprovalStats: ArticleApprovalStats;
}) {
  const runActive =
    run !== null &&
    run.status !== 'completed' &&
    run.status !== 'failed' &&
    run.status !== 'cancelled';
  const extractCodesDone = stages.extract_codes?.stage.status === 'completed';
  const extractMilestonesDone = stages.extract_milestones?.stage.status === 'completed';
  // "Is mapping complete for the specialty?" isn't the same as "did the last
  // map_codes run finish" — sequential runs are allowed, each handling a
  // subset of codes. The right signal is whether any codes are still
  // unmapped. When none are, we fall through to the consolidation placeholder.
  const hasUnmappedCodes = unmappedCodeCount > 0;
  const [showStartForm, setShowStartForm] = useState(false);
  const [showMilestonesForm, setShowMilestonesForm] = useState(false);
  const [showMapForm, setShowMapForm] = useState(false);
  const router = useRouter();

  // While a run is active, poll the server for fresh stage/run data every 2s
  // so the UI reflects progress without manual refresh. Stops automatically
  // once the run transitions to a terminal state.
  useEffect(() => {
    if (!runActive) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [runActive, router]);

  // "Continue mapping" CTA on the Map codes card: cancel any zombie runs
  // (so getCurrentPipelineRun stops insisting a run is active), reveal the
  // existing Next-step start form, and scroll the form into view. The form
  // lives in the Next step section above; this handler does not duplicate it.
  const onContinueMapping = async () => {
    try {
      await fetch('/api/workflows/clear-stale-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specialtySlug }),
      });
    } catch {
      // Surfaced indirectly: if cancellation fails the next-step section
      // will still show "Run in progress" after refresh, prompting another try.
    }
    setShowMapForm(true);
    router.refresh();
    requestAnimationFrame(() => {
      document.getElementById('next-step')?.scrollIntoView({ behavior: 'smooth' });
    });
  };

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

      <div id="next-step" />
      <Stack space="s">
        <H2>Next step</H2>
        {(() => {
          // Priority order:
          //   1. A stage awaiting approval → render its full card so the
          //      Approve/Reject buttons are right there.
          //   2. A run is mid-flight → info callout (nothing to action).
          //   3. Preprocessing incomplete → the corresponding start CTA.
          //   4. Preprocessing done, mapping not run → mapping start CTA.
          //   5. Mapping done → "Next: Consolidation" placeholder.
          const codesStatus = stages.extract_codes?.stage.status;
          const milestonesStatus = stages.extract_milestones?.stage.status;
          const mapStatus = stages.map_codes?.stage.status;

          if (mapStatus === 'awaiting_approval' && stages.map_codes) {
            return (
              <StageCard
                title="Map codes"
                description="Per-code LLM + AMBOSS MCP lookup. Review the mapped coverage + suggestions before approving."
                stage={stages.map_codes.stage}
                specialtySlug={specialtySlug}
                stageName="map_codes"
                events={stages.map_codes.events}
                alwaysShowReset
                treatAsInProgress={hasUnmappedCodes}
                mapCodesHistory={mapCodesHistory}
                unmappedCount={unmappedCodeCount}
              />
            );
          }
          if (codesStatus === 'awaiting_approval' && stages.extract_codes) {
            return (
              <StageCard
                title="Extract codes"
                description="Identify modules per PDF, then extract discrete items per module."
                stage={stages.extract_codes.stage}
                specialtySlug={specialtySlug}
                stageName="extract_codes"
                runUrls={stages.extract_codes.runUrls}
                events={stages.extract_codes.events}
                sources={sources}
              />
            );
          }
          if (milestonesStatus === 'awaiting_approval' && stages.extract_milestones) {
            return (
              <StageCard
                title="Extract milestones"
                description="Extract ACGME-style milestones for this specialty."
                stage={stages.extract_milestones.stage}
                specialtySlug={specialtySlug}
                stageName="extract_milestones"
                runUrls={stages.extract_milestones.runUrls}
                events={stages.extract_milestones.events}
                sources={milestoneSources}
              />
            );
          }
          if (runActive) {
            return (
              <Card title="Run in progress" titleAs="h3" outlined>
                <CardBox>
                  <Text color="secondary">
                    A workflow run is active — polling every 2s. Expand the relevant phase
                    below to watch progress.
                  </Text>
                </CardBox>
              </Card>
            );
          }
          if (!extractCodesDone) {
            return showStartForm ? (
              <Stack space="s">
                <Inline space="s" vAlignItems="center">
                  <H2>Extract codes</H2>
                  <Button variant="secondary" onClick={() => setShowStartForm(false)}>
                    Cancel
                  </Button>
                </Inline>
                <Text color="secondary">Provide URLs or upload PDFs.</Text>
                <StartRunForm specialtySlug={specialtySlug} sources={sources} />
              </Stack>
            ) : (
              <button
                type="button"
                onClick={() => setShowStartForm(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <Card title="Extract codes" titleAs="h3" outlined>
                  <CardBox>
                    <Text color="secondary">
                      Click to provide content outline URLs or upload PDFs for this run.
                    </Text>
                  </CardBox>
                </Card>
              </button>
            );
          }
          if (!extractMilestonesDone) {
            return showMilestonesForm ? (
              <Stack space="s">
                <Inline space="s" vAlignItems="center">
                  <H2>Extract milestones</H2>
                  <Button
                    variant="secondary"
                    onClick={() => setShowMilestonesForm(false)}
                  >
                    Cancel
                  </Button>
                </Inline>
                <Text color="secondary">Provide URLs or upload PDFs.</Text>
                <StartMilestonesForm
                  specialtySlug={specialtySlug}
                  sources={milestoneSources}
                />
              </Stack>
            ) : (
              <button
                type="button"
                onClick={() => setShowMilestonesForm(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <Card title="Extract milestones" titleAs="h3" outlined>
                  <CardBox>
                    <Text color="secondary">
                      Click to provide content outline URLs or upload PDFs. A single
                      Gemini call produces a plain-text milestones document across every
                      source.
                    </Text>
                  </CardBox>
                </Card>
              </button>
            );
          }
          if (hasUnmappedCodes) {
            return showMapForm ? (
              <Stack space="s">
                <Inline space="s" vAlignItems="center">
                  <H2>Map codes</H2>
                  <Button variant="secondary" onClick={() => setShowMapForm(false)}>
                    Cancel
                  </Button>
                </Inline>
                <StartMapCodesForm
                  specialtySlug={specialtySlug}
                  unmappedCount={unmappedCodeCount}
                  defaultContentBase={defaultContentBase}
                  libraryStats={libraryStats}
                  categories={codeCategories}
                  unmappedCodes={unmappedCodePicker}
                />
              </Stack>
            ) : (
              <button
                type="button"
                onClick={() => setShowMapForm(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <Card title="Map codes" titleAs="h3" outlined>
                  <CardBox>
                    <Text color="secondary">
                      {`Click to map ${unmappedCodeCount} unmapped code${unmappedCodeCount === 1 ? '' : 's'} against the AMBOSS MCP server. Sequential runs are allowed — the CTA reappears as long as any codes remain unmapped.`}
                    </Text>
                  </CardBox>
                </Card>
              </button>
            );
          }
          return (
            <Card title="Next: Suggestion consolidation" titleAs="h3" outlined>
              <CardBox>
                <Text color="secondary">
                  Combine code mappings into new-article and article-update candidates.
                  Not yet implemented — this phase runs once the consolidation workflows
                  are wired up.
                </Text>
              </CardBox>
            </Card>
          );
        })()}
      </Stack>

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
          />
          <StageCard
            title="Extract milestones"
            description="Extract ACGME-style milestones for this specialty."
            stage={stages.extract_milestones?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="extract_milestones"
            runUrls={stages.extract_milestones?.runUrls}
            events={stages.extract_milestones?.events ?? []}
            sources={milestoneSources}
          />
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
          alwaysShowReset
          mapCodesHistory={mapCodesHistory}
          unmappedCount={unmappedCodeCount}
          continueAction={
            hasUnmappedCodes
              ? { label: 'Continue mapping', onClick: onContinueMapping }
              : undefined
          }
        />
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
          />
          <StageCard
            title="Articles (secondary)"
            description={
              articleApprovalStats.total === 0
                ? 'Dedupe new-article candidates across the specialty. Only approved 1st-pass articles flow into this pass — review them on the New Articles tab first.'
                : `Dedupe new-article candidates across the specialty. Only approved 1st-pass articles flow into this pass — currently ${articleApprovalStats.approved}/${articleApprovalStats.total} approved · ${articleApprovalStats.rejected} rejected · ${articleApprovalStats.unreviewed} unreviewed. Review the unreviewed ones on the New Articles tab before kicking off this stage.`
            }
            stage={stages.consolidate_articles?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="consolidate_articles"
            events={stages.consolidate_articles?.events ?? []}
          />
          <StageCard
            title="Sections (secondary)"
            description="Dedupe sections and updates within each consolidated article."
            stage={stages.consolidate_sections?.stage ?? null}
            specialtySlug={specialtySlug}
            stageName="consolidate_sections"
            events={stages.consolidate_sections?.events ?? []}
          />
        </Stack>
      </PhaseGroup>

      <SourcesCard kind="code" sources={sources} />
      <SourcesCard kind="milestone" sources={milestoneSources} />
    </Stack>
  );
}
