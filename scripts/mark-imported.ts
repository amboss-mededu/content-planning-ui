/**
 * Backfill a synthetic completed pipeline run so the dashboard reflects state
 * imported outside of the workflow (e.g. seed:local + import-milestones).
 *
 * Inserts one PB pipelineRuns row + one pipelineStages row per requested
 * stage (status='completed', approvedBy='import'). Output summaries record
 * what was imported (codes count, milestones length).
 *
 * Usage:
 *   npm run mark-imported -- anesthesiology codes milestones mapping
 *   npm run mark-imported -- anesthesiology codes
 */

import { pbAdminClient } from './_lib/pb';

type Stage = 'codes' | 'milestones' | 'mapping';
const STAGE_NAME: Record<Stage, 'extract_codes' | 'extract_milestones' | 'map_codes'> = {
  codes: 'extract_codes',
  milestones: 'extract_milestones',
  mapping: 'map_codes',
};

async function main() {
  const [slug, ...stageArgs] = process.argv.slice(2);
  if (!slug || stageArgs.length === 0) {
    console.error('Usage: mark-imported -- <slug> <codes|milestones|mapping> [...]');
    process.exit(1);
  }
  const stages = stageArgs.map((s) => {
    if (s !== 'codes' && s !== 'milestones' && s !== 'mapping') {
      throw new Error(
        `unknown stage '${s}' — expected 'codes', 'milestones', or 'mapping'`,
      );
    }
    return s as Stage;
  });

  const pb = await pbAdminClient();

  const spec = await pb
    .collection('specialties')
    .getFirstListItem(`slug = "${slug}"`)
    .catch(() => null);
  if (!spec) {
    console.error(`No specialty '${slug}' in PocketBase.`);
    process.exit(1);
  }

  const codeCount =
    stages.includes('codes') || stages.includes('mapping')
      ? (
          await pb
            .collection('codes')
            .getList(1, 1, { filter: `specialtySlug = "${slug}"`, fields: 'id' })
        ).totalItems
      : 0;
  const milestonesText = (spec as { milestones?: string }).milestones ?? '';
  const milestoneChars = stages.includes('milestones') ? milestonesText.length : 0;

  if (stages.includes('codes') && codeCount === 0) {
    console.warn(
      '[mark-imported] codes stage requested but PB has no codes for this specialty.',
    );
  }
  if (stages.includes('mapping') && codeCount === 0) {
    console.warn(
      '[mark-imported] mapping stage requested but no codes — synthetic map_codes will report mapped: 0.',
    );
  }
  if (stages.includes('milestones') && milestoneChars === 0) {
    console.warn(
      '[mark-imported] milestones stage requested but specialty has no milestones text in PB.',
    );
  }

  const now = Date.now();
  const run = await pb.collection('pipelineRuns').create({
    specialtySlug: slug,
    status: 'completed',
    startedAt: now,
    updatedAt: now,
    finishedAt: now,
  });
  const runId = run.id;

  for (const stage of stages) {
    const stageName = STAGE_NAME[stage];
    const outputSummary =
      stage === 'codes'
        ? { source: 'manual_import', codes: codeCount }
        : stage === 'milestones'
          ? { source: 'manual_import', milestones_chars: milestoneChars }
          : { source: 'manual_import', mapped: codeCount };
    await pb.collection('pipelineStages').create({
      runId,
      stage: stageName,
      status: 'completed',
      startedAt: now,
      finishedAt: now,
      approvedAt: now,
      approvedBy: 'import',
      outputSummary,
    });
  }

  console.log(
    `✓ Backfilled run ${runId} for '${slug}' — stages: ${stages.map((s) => STAGE_NAME[s]).join(', ')}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
