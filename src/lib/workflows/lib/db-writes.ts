/**
 * Step functions that own every pipeline write.
 *
 * All exports are `'use step'` so they retry on transient failure and persist
 * their results to the workflow event log. Workflow functions never touch the
 * DB directly — they call these helpers.
 *
 * Single-DB Convex setup: pipeline runs/stages/events/extracted-codes plus
 * editor data all live in Convex; mutations are invoked via fetchMutation.
 */

import { fetchMutation, fetchQuery } from 'convex/nextjs';
import {
  bulkInsertCodesAsAdmin,
  clearInFlightForRunAsAdmin,
  clearMappingAsAdmin,
  listUnmappedCodesAsAdmin,
  markCodesInFlightAsAdmin,
  writeCodeMappingAsAdmin,
} from '@/lib/data/codes';
import {
  getSpecialtyRecordAsAdmin,
  updateMilestonesAsAdmin,
} from '@/lib/data/specialties';
import { api } from '../../../../convex/_generated/api';
import type { MappingOutput } from './amboss-mcp';
import type { RawExtractedCode } from './gemini';

// Workflow + script callers run outside a Next.js request and have no user
// JWT. Public Convex functions accept the shared secret on a `_secret` arg
// to authorize machine traffic. The Convex deployment must have
// WORKFLOW_SECRET set to the matching value (see .env.example).
function workflowSecret(): string {
  const s = process.env.WORKFLOW_SECRET;
  if (!s) {
    throw new Error(
      'WORKFLOW_SECRET unset — workflow cannot authenticate to Convex. ' +
        'Set it in the Vercel environment and on the Convex deployment.',
    );
  }
  return s;
}

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
  | 'consolidate_primary'
  | 'consolidate_articles'
  | 'consolidate_sections';

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
  'use step';
  console.log('[pipeline] createPipelineRun', input);
  const result = await fetchMutation(api.pipeline.createRun, {
    specialtySlug: input.specialtySlug,
    workflowRunId: input.workflowRunId,
    _secret: workflowSecret(),
  });
  console.log('[pipeline] createPipelineRun →', result.id);
  return { id: result.id };
}

export async function updatePipelineRunStatus(
  runId: string,
  status: PipelineRunStatus,
  error?: string | null,
): Promise<void> {
  'use step';
  console.log('[pipeline] updatePipelineRunStatus', { runId, status, error });
  const terminal =
    status === 'completed' || status === 'failed' || status === 'cancelled';
  await fetchMutation(api.pipeline.updateRun, {
    runId,
    patch: {
      status,
      ...(terminal ? { finishedAt: Date.now() } : {}),
      ...(error !== undefined ? { error } : {}),
    },
    _secret: workflowSecret(),
  });
}

// --- pipeline_stages ---------------------------------------------------------

export async function initPipelineStage(
  runId: string,
  stage: StageName,
): Promise<{ id: string }> {
  'use step';
  console.log('[pipeline] initPipelineStage', { runId, stage });
  return await fetchMutation(api.pipeline.initStage, {
    runId,
    stage,
    _secret: workflowSecret(),
  });
}

export async function markStageRunning(
  runId: string,
  stage: StageName,
  workflowRunId?: string,
): Promise<void> {
  'use step';
  console.log('[pipeline] markStageRunning', { runId, stage, workflowRunId });
  await fetchMutation(api.pipeline.updateStage, {
    runId,
    stage,
    patch: {
      status: 'running',
      startedAt: Date.now(),
      ...(workflowRunId ? { workflowRunId } : {}),
    },
    _secret: workflowSecret(),
  });
}

export async function markStageAwaitingApproval(
  runId: string,
  stage: StageName,
  outputSummary: Record<string, unknown>,
  draftPayload?: unknown,
): Promise<void> {
  'use step';
  console.log('[pipeline] markStageAwaitingApproval', { runId, stage, outputSummary });
  await fetchMutation(api.pipeline.updateStage, {
    runId,
    stage,
    patch: {
      status: 'awaiting_approval',
      outputSummary: JSON.stringify(outputSummary),
      ...(draftPayload !== undefined
        ? { draftPayload: JSON.stringify(draftPayload) }
        : {}),
    },
    _secret: workflowSecret(),
  });
}

export async function markStageCompleted(
  runId: string,
  stage: StageName,
  approvedBy?: string,
  outputSummary?: Record<string, unknown>,
): Promise<void> {
  'use step';
  console.log('[pipeline] markStageCompleted', { runId, stage, approvedBy });
  await fetchMutation(api.pipeline.updateStage, {
    runId,
    stage,
    patch: {
      status: 'completed',
      finishedAt: Date.now(),
      ...(approvedBy ? { approvedAt: Date.now(), approvedBy } : {}),
      ...(outputSummary ? { outputSummary: JSON.stringify(outputSummary) } : {}),
    },
    _secret: workflowSecret(),
  });
}

export async function markStageFailed(
  runId: string,
  stage: StageName,
  errorMessage: string,
): Promise<void> {
  'use step';
  console.log('[pipeline] markStageFailed', { runId, stage, errorMessage });
  await fetchMutation(api.pipeline.updateStage, {
    runId,
    stage,
    patch: {
      status: 'failed',
      finishedAt: Date.now(),
      errorMessage,
    },
    _secret: workflowSecret(),
  });
}

// --- extracted_codes ---------------------------------------------------------

export async function writeExtractedCodes(
  runId: string,
  specialtySlug: string,
  rawCodes: RawExtractedCode[],
): Promise<{ inserted: number }> {
  'use step';
  console.log('[pipeline] writeExtractedCodes', {
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
    metadata: c.metadata !== undefined ? JSON.stringify(c.metadata) : undefined,
  }));
  // Convex per-mutation write limits — chunk to stay safe.
  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await fetchMutation(api.pipeline.writeExtractedCodes, {
      runId,
      specialtySlug,
      rows: rows.slice(i, i + chunkSize),
      _secret: workflowSecret(),
    });
  }
  return { inserted: rows.length };
}

/**
 * Promote approved rows from the extracted_codes staging table into the
 * canonical `codes` collection. Mapping-specific fields stay unset so the
 * mapping stage can fill them in. metadata is dropped — the codes schema
 * doesn't carry it.
 */
export async function promoteExtractedCodesToCodes(
  runId: string,
  specialtySlug: string,
): Promise<{ promoted: number }> {
  'use step';
  console.log('[pipeline] promoteExtractedCodesToCodes', { runId, specialtySlug });
  const staged = await fetchQuery(api.pipeline.listExtractedCodesForRun, {
    runId,
    _secret: workflowSecret(),
  });
  if (staged.length === 0) return { promoted: 0 };
  const rows = staged.map((s) => ({
    code: s.code,
    category: s.category ?? undefined,
    consolidationCategory: s.consolidationCategory ?? undefined,
    description: s.description ?? undefined,
    source: s.source ?? undefined,
  }));
  const chunkSize = 25;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await bulkInsertCodesAsAdmin(specialtySlug, chunk);
  }
  console.log('[pipeline] promoteExtractedCodesToCodes → promoted', rows.length);
  return { promoted: rows.length };
}

// --- specialties.milestones --------------------------------------------------

export async function writeApprovedMilestones(
  specialtySlug: string,
  milestones: string,
): Promise<void> {
  'use step';
  console.log('[pipeline] writeApprovedMilestones', {
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
};

/**
 * One-shot fetch of the specialty fields the mapping workflow needs. Step-
 * cached so replays read from the workflow event log, not Convex.
 */
export async function loadSpecialtyForMapping(
  specialtySlug: string,
): Promise<SpecialtyMappingContext> {
  'use step';
  console.log('[pipeline] loadSpecialtyForMapping', { specialtySlug });
  const row = await getSpecialtyRecordAsAdmin(specialtySlug);
  return {
    region: row?.region ?? null,
    language: row?.language ?? null,
    milestones: row?.milestones ?? null,
  };
}

// --- codes (mapping writes) --------------------------------------------------

export type UnmappedCodeRow = {
  code: string;
  category: string | null;
  description: string | null;
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
): Promise<UnmappedCodeRow[]> {
  'use step';
  console.log('[pipeline] listUnmappedCodes', { specialtySlug, filter });
  const rows = await listUnmappedCodesAsAdmin(specialtySlug, {
    categories: filter?.categories?.filter((s) => typeof s === 'string' && s.length > 0),
    codes: filter?.codes?.filter((s) => typeof s === 'string' && s.length > 0),
  });
  console.log('[pipeline] listUnmappedCodes →', rows.length);
  return rows;
}

/**
 * Coerce a `coveredSections[].sections` block into the typed array form the
 * Convex schema expects. The mapping prompt encourages a `record<title, id>`
 * shape and Convex requires ASCII-only field names, so unicode section
 * titles (e.g. "Vitamin B₁₂") would fail at validation if stored as a
 * record. The corresponding read-side fallback in `code-detail-modal.tsx`
 * is kept to handle any pre-normalisation rows that survive a wipe gap.
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

export async function writeCodeMapping(
  specialtySlug: string,
  code: string,
  mapping: MappingOutput,
): Promise<void> {
  'use step';
  console.log('[pipeline] writeCodeMapping', { specialtySlug, code });
  const coverageScore =
    typeof mapping.coverage.coverageScore === 'number'
      ? mapping.coverage.coverageScore
      : typeof mapping.coverage.coverageScore === 'string'
        ? Number.parseInt(mapping.coverage.coverageScore, 10) || undefined
        : undefined;
  await writeCodeMappingAsAdmin({
    slug: specialtySlug,
    code,
    isInAMBOSS: mapping.coverage.inAMBOSS ?? undefined,
    coverageLevel: mapping.coverage.coverageLevel || undefined,
    depthOfCoverage: coverageScore,
    notes: mapping.coverage.generalNotes || undefined,
    gaps: mapping.coverage.gaps || undefined,
    improvements: mapping.suggestion.improvement || undefined,
    articlesWhereCoverageIs: mapping.coverage.coveredSections
      ? normaliseCoveredSections(mapping.coverage.coveredSections)
      : undefined,
    existingArticleUpdates: mapping.suggestion.sectionUpdates ?? undefined,
    newArticlesNeeded: mapping.suggestion.newArticlesNeeded ?? undefined,
  });
}

export async function clearMappingForCode(
  specialtySlug: string,
  code: string,
): Promise<void> {
  console.log('[pipeline] clearMappingForCode', { specialtySlug, code });
  await clearMappingAsAdmin(specialtySlug, code);
}

export async function markCodesInFlight(
  specialtySlug: string,
  codes: string[],
  runId: string,
): Promise<void> {
  'use step';
  console.log('[pipeline] markCodesInFlight', {
    specialtySlug,
    runId,
    count: codes.length,
  });
  if (codes.length === 0) return;
  await markCodesInFlightAsAdmin(specialtySlug, codes, runId);
}

export async function clearInFlightForRun(runId: string): Promise<void> {
  'use step';
  console.log('[pipeline] clearInFlightForRun', { runId });
  await clearInFlightForRunAsAdmin(runId);
}
