/**
 * Step functions that own every pipeline write.
 *
 * All exports are `'use step'` so they retry on transient failure and persist
 * their results to the workflow event log. Workflow functions never touch the
 * DB directly — they call these helpers.
 *
 * Pipeline runs/stages/events/extracted-codes plus the editor data tables
 * all live in PocketBase; mutations go through the admin client (workflow
 * code has no request cookie in scope).
 */

import {
  bulkInsertCodesAsAdmin,
  clearInFlightForRunAsAdmin,
  clearMappingAsAdmin,
  listUnmappedCodesAsAdmin,
  markCodesInFlightAsAdmin,
  writeCodeMappingAsAdmin,
  writeCodeSuggestionsAsAdmin,
} from '@/lib/data/codes';
import {
  createPipelineRunAsAdmin,
  getPipelineRunStatusAsAdmin,
  initPipelineStageAsAdmin,
  listExtractedCodesForRunAsAdmin,
  updatePipelineRunAsAdmin,
  updatePipelineStageAsAdmin,
  writeExtractedCodesAsAdmin,
} from '@/lib/data/pipeline';
import {
  getSpecialtyRecordAsAdmin,
  resolvePipelineMode,
  updateMilestonesAsAdmin,
} from '@/lib/data/specialties';
import { log } from '@/lib/log';
import type {
  GuidelineCoverage,
  GuidelineRecommendationRef,
  QuestionRef,
} from '@/lib/pb/types';
import type { MappingSource, PipelineMode } from '@/lib/types';
import type { MappingOutput } from './amboss-mcp';
import type { RawExtractedCode } from './gemini';
import {
  type CoverageVerdict,
  coerceScore,
  type GuidelineCoverageBlock,
} from './guidelines-mcp';
import type { QuestionCoverageBlock } from './questions-mcp';

export type PipelineRunStatus =
  | 'running'
  | 'awaiting_preprocessing_approval'
  | 'mapping'
  | 'consolidating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StageName =
  | 'extract_codes'
  | 'extract_milestones'
  | 'map_codes'
  | 'map_suggestions'
  | 'consolidate_primary'
  | 'consolidate_articles'
  | 'consolidate_sections'
  | 'literature_search';

/**
 * Event-log scope is wider than `StageName` because some sub-pipelines
 * (article writing) don't have a row in the specialty's `pipelineStages`
 * table but still produce useful events. `EventStageName` is the
 * superset that the event log + UI filters accept.
 */
export type EventStageName = StageName | 'write_article';

export type StageStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'skipped';

// --- pipeline_runs -----------------------------------------------------------

export async function createPipelineRun(input: {
  specialtySlug: string;
  workflowRunId?: string;
}): Promise<{ id: string }> {
  log('pipeline').info('createPipelineRun', input);
  const result = await createPipelineRunAsAdmin({
    specialtySlug: input.specialtySlug,
    workflowRunId: input.workflowRunId,
  });
  log('pipeline').info('createPipelineRun →', result.id);
  return { id: result.id };
}

export async function updatePipelineRunStatus(
  runId: string,
  status: PipelineRunStatus,
  error?: string | null,
): Promise<void> {
  log('pipeline').info('updatePipelineRunStatus', { runId, status, error });
  const terminal =
    status === 'completed' || status === 'failed' || status === 'cancelled';
  await updatePipelineRunAsAdmin(runId, {
    status,
    ...(terminal ? { finishedAt: Date.now() } : {}),
    ...(error !== undefined ? { error } : {}),
  });
}

/**
 * Poll a run's current status from the fire-and-forget workflow. Used by
 * mapCodesWorkflow between batches (and inside the per-code step) so that
 * a `resetStageCascade` → `cancelStaleRunsForSpecialty` flip causes
 * cooperative shutdown before the next mappedAt write lands.
 */
export async function getPipelineRunStatus(
  runId: string,
): Promise<PipelineRunStatus | null> {
  return (await getPipelineRunStatusAsAdmin(runId)) as PipelineRunStatus | null;
}

// --- pipeline_stages ---------------------------------------------------------

export async function initPipelineStage(
  runId: string,
  stage: StageName,
): Promise<{ id: string }> {
  log('pipeline').info('initPipelineStage', { runId, stage });
  return await initPipelineStageAsAdmin({ runId, stage });
}

export async function markStageRunning(
  runId: string,
  stage: StageName,
  workflowRunId?: string,
): Promise<void> {
  log('pipeline').info('markStageRunning', { runId, stage, workflowRunId });
  await updatePipelineStageAsAdmin({
    runId,
    stage,
    patch: {
      status: 'running',
      startedAt: Date.now(),
      ...(workflowRunId ? { workflowRunId } : {}),
    },
  });
}

export async function markStageAwaitingApproval(
  runId: string,
  stage: StageName,
  outputSummary: Record<string, unknown>,
  draftPayload?: unknown,
): Promise<void> {
  log('pipeline').info('markStageAwaitingApproval', { runId, stage, outputSummary });
  await updatePipelineStageAsAdmin({
    runId,
    stage,
    patch: {
      status: 'awaiting_approval',
      outputSummary,
      ...(draftPayload !== undefined ? { draftPayload } : {}),
    },
  });
}

export async function markStageCompleted(
  runId: string,
  stage: StageName,
  approvedBy?: string,
  outputSummary?: Record<string, unknown>,
): Promise<void> {
  log('pipeline').info('markStageCompleted', { runId, stage, approvedBy });
  await updatePipelineStageAsAdmin({
    runId,
    stage,
    patch: {
      status: 'completed',
      finishedAt: Date.now(),
      ...(approvedBy ? { approvedAt: Date.now(), approvedBy } : {}),
      ...(outputSummary ? { outputSummary } : {}),
    },
  });
}

export async function markStageFailed(
  runId: string,
  stage: StageName,
  errorMessage: string,
): Promise<void> {
  log('pipeline').info('markStageFailed', { runId, stage, errorMessage });
  await updatePipelineStageAsAdmin({
    runId,
    stage,
    patch: {
      status: 'failed',
      finishedAt: Date.now(),
      errorMessage,
    },
  });
}

// --- extracted_codes ---------------------------------------------------------

export async function writeExtractedCodes(
  runId: string,
  specialtySlug: string,
  rawCodes: RawExtractedCode[],
): Promise<{ inserted: number }> {
  log('pipeline').info('writeExtractedCodes', {
    runId,
    specialtySlug,
    count: rawCodes.length,
  });
  if (rawCodes.length === 0) return { inserted: 0 };
  const rows = rawCodes.map((c) => ({
    code: c.code,
    category: c.category,
    consolidationCategory: c.consolidationCategory,
    description: c.description,
    source: c.source,
    metadata: c.metadata,
    curriculumMeta: c.curriculumMeta,
  }));
  // PocketBase has no per-call write limits the way Convex does, but inserts
  // run sequentially per row. Chunking keeps progress visible in logs.
  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await writeExtractedCodesAsAdmin({
      runId,
      specialtySlug,
      rows: rows.slice(i, i + chunkSize),
    });
  }
  return { inserted: rows.length };
}

/**
 * Promote approved rows from the extracted_codes staging table into the
 * canonical `codes` collection. Mapping-specific fields stay unset so the
 * mapping stage can fill them in. `metadata` is dropped — the codes schema
 * doesn't carry it — but `curriculumMeta` (the time dimension) is promoted.
 */
export async function promoteExtractedCodesToCodes(
  runId: string,
  specialtySlug: string,
): Promise<{ promoted: number }> {
  log('pipeline').info('promoteExtractedCodesToCodes', { runId, specialtySlug });
  const staged = await listExtractedCodesForRunAsAdmin(runId);
  if (staged.length === 0) return { promoted: 0 };
  const rows = staged.map((s) => ({
    code: s.code,
    category: s.category ?? undefined,
    consolidationCategory: s.consolidationCategory ?? undefined,
    description: s.description ?? undefined,
    source: s.source ?? undefined,
    curriculumMeta: s.curriculumMeta ?? undefined,
  }));
  const chunkSize = 25;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await bulkInsertCodesAsAdmin(specialtySlug, chunk);
  }
  log('pipeline').info('promoteExtractedCodesToCodes → promoted', rows.length);
  return { promoted: rows.length };
}

// --- specialties.milestones --------------------------------------------------

export async function writeApprovedMilestones(
  specialtySlug: string,
  milestones: string,
): Promise<void> {
  log('pipeline').info('writeApprovedMilestones', {
    specialtySlug,
    chars: milestones.length,
  });
  await updateMilestonesAsAdmin({
    slug: specialtySlug,
    milestones,
    bumpSeedTimestamp: true,
  });
}

export type SpecialtyMappingContext = {
  region: string | null;
  language: string | null;
  milestones: string | null;
  /** Which content source(s) to map against. Empty/unknown → 'amboss'.
   *  Forced to 'guidelines' for rag-corpus and to 'amboss' for
   *  curriculum-mapping specialties. */
  mappingSource: MappingSource;
  /** The specialty's run mode. */
  pipelineMode: PipelineMode;
};

/**
 * One-shot fetch of the specialty fields the mapping workflow needs. Step-
 * cached so replays read from the workflow event log, not the DB.
 */
export async function loadSpecialtyForMapping(
  specialtySlug: string,
): Promise<SpecialtyMappingContext> {
  log('pipeline').info('loadSpecialtyForMapping', { specialtySlug });
  const row = await getSpecialtyRecordAsAdmin(specialtySlug);
  const pipelineMode = resolvePipelineMode(row);
  const src = row?.mappingSource;
  const storedSource: MappingSource =
    src === 'guidelines' || src === 'both' ? src : 'amboss';
  // Modes that pin the mapping source override whatever is stored:
  // rag-corpus → guidelines, curriculum-mapping → amboss.
  const mappingSource: MappingSource =
    pipelineMode === 'rag-corpus'
      ? 'guidelines'
      : pipelineMode === 'curriculum-mapping'
        ? 'amboss'
        : storedSource;
  return {
    region: row?.region ?? null,
    language: row?.language ?? null,
    milestones: row?.milestones ?? null,
    mappingSource,
    pipelineMode,
  };
}

// --- codes (mapping writes) --------------------------------------------------

export type UnmappedCodeRow = {
  code: string;
  category: string | null;
  description: string | null;
  /** Curriculum learning objective (curriculum-mapping); null otherwise. */
  objective: string | null;
};

/** Optional filter applied to the unmapped-codes query. */
export type MappingFilter = {
  /** Restrict to codes whose `category` is in this list. */
  categories?: string[];
  /** Restrict to specific `code` values (takes precedence when combined with
   *  categories: both filters union — a row matches if it's in either list). */
  codes?: string[];
};

export async function listUnmappedCodes(
  specialtySlug: string,
  filter?: MappingFilter | null,
  /** Curriculum-mapping gate: restrict to human-approved codes only. */
  approvedOnly = false,
): Promise<UnmappedCodeRow[]> {
  log('pipeline').info('listUnmappedCodes', { specialtySlug, filter, approvedOnly });
  const rows = await listUnmappedCodesAsAdmin(specialtySlug, {
    categories: filter?.categories?.filter((s) => typeof s === 'string' && s.length > 0),
    codes: filter?.codes?.filter((s) => typeof s === 'string' && s.length > 0),
    approvedOnly,
  });
  log('pipeline').info('listUnmappedCodes →', rows.length);
  return rows;
}

/**
 * Coerce a `coveredSections[].sections` block into the typed array form the
 * codes schema expects. The mapping prompt encourages a `record<title, id>`
 * shape and we want unicode section titles (e.g. "Vitamin B₁₂") preserved.
 * The corresponding read-side fallback in `code-detail-modal.tsx` is kept to
 * handle any pre-normalisation rows that survive a wipe gap.
 */
function normaliseCoveredSections(
  blocks: MappingOutput['coverage']['coveredSections'],
): Array<{
  articleTitle?: string;
  articleId?: string;
  sections?: Array<{ sectionTitle?: string; sectionId?: string }>;
}> {
  return (blocks ?? []).map((b) => {
    const s = b.sections;
    let sections: Array<{ sectionTitle?: string; sectionId?: string }> | undefined;
    if (Array.isArray(s)) {
      sections = s.map((row) => ({
        sectionTitle: row.sectionTitle,
        sectionId: row.sectionId,
      }));
    } else if (s && typeof s === 'object') {
      sections = Object.entries(s).map(([sectionTitle, sectionId]) => ({
        sectionTitle,
        sectionId: typeof sectionId === 'string' ? sectionId : undefined,
      }));
    }
    return {
      articleTitle: b.articleTitle,
      articleId: b.articleId,
      sections,
    };
  });
}

/**
 * Coerce a guideline agent's `coveredGuidelines` block into the stored
 * `GuidelineCoverage[]` shape. Mirrors {@link normaliseCoveredSections} — the
 * `recommendations` field may arrive as a `record<title, id>` or an array.
 */
function normaliseGuidelineCoverage(
  blocks: GuidelineCoverageBlock['coveredGuidelines'],
): GuidelineCoverage[] {
  return (blocks ?? []).map((b) => {
    const r = b.recommendations;
    let recommendations: GuidelineRecommendationRef[] | undefined;
    if (Array.isArray(r)) {
      recommendations = r.map((row) => ({
        recommendationTitle: row.recommendationTitle,
        recommendationId: row.recommendationId,
      }));
    } else if (r && typeof r === 'object') {
      recommendations = Object.entries(r).map(
        ([recommendationTitle, recommendationId]) => ({
          recommendationTitle,
          recommendationId:
            typeof recommendationId === 'string' ? recommendationId : undefined,
        }),
      );
    }
    const year =
      typeof b.year === 'number'
        ? b.year
        : typeof b.year === 'string'
          ? Number.parseInt(b.year, 10) || undefined
          : undefined;
    return {
      guidelineTitle: b.guidelineTitle,
      guidelineId: b.guidelineId,
      organization: b.organization,
      year,
      recommendations,
    };
  });
}

/**
 * Coerce a question agent's `coveredQuestions` block into the stored
 * `QuestionRef[]` shape. Drops entries with no EID (a question without an id is
 * not actionable). Mirrors {@link normaliseGuidelineCoverage}.
 */
function normaliseQuestions(
  blocks: QuestionCoverageBlock['coveredQuestions'],
): QuestionRef[] {
  return (blocks ?? [])
    .filter((q) => Boolean(q.questionId))
    .map((q) => ({
      questionId: q.questionId,
      questionStem: q.questionStem,
      studyObjectives: q.studyObjectives,
      learningObjective: q.learningObjective,
      competency: q.competency,
      system: q.system,
      difficulty: q.difficulty,
    }));
}

export async function writeCodeMapping(
  specialtySlug: string,
  code: string,
  mapping: MappingOutput,
  includeSuggestions = true,
  extra?: {
    /** Guideline coverage block (source includes 'guidelines'). */
    guideline?: GuidelineCoverageBlock | null;
    /** Question coverage block (curriculum-mapping question track). */
    questions?: QuestionCoverageBlock | null;
    /** Synthesized/active overall verdict. */
    overall?: CoverageVerdict | null;
    /** Which source(s) produced this row. Defaults to 'amboss'. */
    mappingSourceUsed?: MappingSource;
  },
): Promise<void> {
  log('pipeline').info('writeCodeMapping', {
    specialtySlug,
    code,
    includeSuggestions,
    mappingSourceUsed: extra?.mappingSourceUsed,
  });
  const coverageScore = coerceScore(mapping.coverage.coverageScore);
  const g = extra?.guideline ?? null;
  const q = extra?.questions ?? null;
  await writeCodeMappingAsAdmin({
    slug: specialtySlug,
    code,
    isInAMBOSS: mapping.coverage.inAMBOSS ?? undefined,
    coverageLevel: mapping.coverage.coverageLevel || undefined,
    depthOfCoverage: coverageScore,
    notes: mapping.coverage.generalNotes || undefined,
    gaps: mapping.coverage.gaps || undefined,
    articlesWhereCoverageIs: mapping.coverage.coveredSections
      ? normaliseCoveredSections(mapping.coverage.coveredSections)
      : undefined,
    // --- Guideline coverage track ------------------------------------------
    isInGuidelines: g ? (g.inGuidelines ?? undefined) : undefined,
    guidelineCoverageLevel: g ? g.coverageLevel || undefined : undefined,
    guidelineDepthOfCoverage: g ? coerceScore(g.coverageScore) : undefined,
    guidelineNotes: g ? g.generalNotes || undefined : undefined,
    guidelineGaps: g ? g.gaps || undefined : undefined,
    guidelinesWhereCoverageIs: g
      ? normaliseGuidelineCoverage(g.coveredGuidelines)
      : undefined,
    // --- Question mapping track (curriculum-mapping) -----------------------
    questionsWhereCoverageIs: q ? normaliseQuestions(q.coveredQuestions) : undefined,
    // --- Overall coverage track + provenance -------------------------------
    overallCoverageLevel: extra?.overall?.coverageLevel || undefined,
    overallDepthOfCoverage: extra?.overall?.coverageScore,
    mappingSourceUsed: extra?.mappingSourceUsed ?? 'amboss',
    // Coverage-only (mapping-only) writes persist NO suggestions and leave
    // `suggestionsGeneratedAt` at 0, so the backfill stage can find the code.
    improvements: includeSuggestions
      ? mapping.suggestion.improvement || undefined
      : undefined,
    existingArticleUpdates: includeSuggestions
      ? (mapping.suggestion.sectionUpdates ?? undefined)
      : [],
    newArticlesNeeded: includeSuggestions
      ? (mapping.suggestion.newArticlesNeeded ?? undefined)
      : [],
    suggestionsGeneratedAt: includeSuggestions ? Date.now() : 0,
  });
}

/**
 * Persist just the suggestion fields produced by the "Generate suggestions"
 * backfill pass — coverage and `mappedAt` are preserved.
 */
export async function writeCodeSuggestions(
  specialtySlug: string,
  code: string,
  suggestion: MappingOutput['suggestion'],
): Promise<void> {
  log('pipeline').info('writeCodeSuggestions', { specialtySlug, code });
  await writeCodeSuggestionsAsAdmin({
    slug: specialtySlug,
    code,
    improvements: suggestion.improvement || undefined,
    existingArticleUpdates: suggestion.sectionUpdates ?? [],
    newArticlesNeeded: suggestion.newArticlesNeeded ?? [],
  });
}

export async function clearMappingForCode(
  specialtySlug: string,
  code: string,
): Promise<void> {
  log('pipeline').info('clearMappingForCode', { specialtySlug, code });
  await clearMappingAsAdmin(specialtySlug, code);
}

export async function markCodesInFlight(
  specialtySlug: string,
  codes: string[],
  runId: string,
): Promise<void> {
  log('pipeline').info('markCodesInFlight', {
    specialtySlug,
    runId,
    count: codes.length,
  });
  if (codes.length === 0) return;
  await markCodesInFlightAsAdmin(specialtySlug, codes, runId);
}

export async function clearInFlightForRun(runId: string): Promise<void> {
  log('pipeline').info('clearInFlightForRun', { runId });
  await clearInFlightForRunAsAdmin(runId);
}
