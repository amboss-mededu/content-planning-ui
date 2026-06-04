import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ContentInput,
  ExtractedCodeRecord,
  MappingFilter,
  PipelineEventRecord,
  PipelineRunRecord,
  PipelineStageRecord,
} from '@/lib/pb/types';
import { derivePhase, type Phase } from '@/lib/phase';
import { isStageRunningFresh } from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';

// Pipeline runs/stages/events live in PocketBase. RSC pages and route
// handlers call the cookie-authed helpers (`*` and `list*`); workflow
// code (no cookies in scope) calls the `*AsAdmin` variants which use a
// superuser-authed PB client.
//
// Real-time updates happen via the dashboard's 2s polling loop
// (router.refresh) — no PB subscribe needed here.

export type ContentInputRef = ContentInput;

export type MappingFilterRef = MappingFilter;

export type PipelineRunRow = {
  id: string;
  specialtySlug: string;
  status: string;
  workflowRunId: string | null;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  contentOutlineUrls: ContentInputRef[] | null;
  identifyModulesInstructions: string | null;
  extractCodesInstructions: string | null;
  milestonesInstructions: string | null;
  mappingInstructions: string | null;
  mappingCheckIds: boolean;
  mappingFilter: MappingFilterRef | null;
  targetCategories: string[] | null;
};

export type PipelineStageRow = {
  id: string;
  runId: string;
  stage: string;
  status: string;
  workflowRunId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  outputSummary: unknown;
  draftPayload: unknown;
  errorMessage: string | null;
};

export type PipelineEventRow = {
  id: string;
  runId: string;
  stage: string;
  level: string;
  message: string;
  metrics: Record<string, unknown> | null;
  createdAt: Date;
};

export type StageContext = {
  stage: PipelineStageRow;
  runUrls: ContentInputRef[] | null;
  events: PipelineEventRow[];
};

export type MapCodesHistory = {
  runs: PipelineRunRow[];
  events: PipelineEventRow[];
  eventsByRunId: Record<string, PipelineEventRow[]>;
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

// --- Mappers ----------------------------------------------------------------

function toRun(r: PipelineRunRecord): PipelineRunRow {
  return {
    id: r.id,
    specialtySlug: r.specialtySlug,
    status: r.status,
    workflowRunId: r.workflowRunId ?? null,
    startedAt: new Date(r.startedAt),
    updatedAt: new Date(r.updatedAt),
    finishedAt: r.finishedAt !== undefined ? new Date(r.finishedAt) : null,
    error: r.error ?? null,
    contentOutlineUrls: r.contentOutlineUrls ?? null,
    identifyModulesInstructions: r.identifyModulesInstructions ?? null,
    extractCodesInstructions: r.extractCodesInstructions ?? null,
    milestonesInstructions: r.milestonesInstructions ?? null,
    mappingInstructions: r.mappingInstructions ?? null,
    mappingCheckIds: r.mappingCheckIds,
    mappingFilter: r.mappingFilter ?? null,
    targetCategories: r.targetCategories ?? null,
  };
}

function toStage(r: PipelineStageRecord): PipelineStageRow {
  return {
    id: r.id,
    runId: r.runId,
    stage: r.stage,
    status: r.status,
    workflowRunId: r.workflowRunId ?? null,
    startedAt: r.startedAt !== undefined ? new Date(r.startedAt) : null,
    finishedAt: r.finishedAt !== undefined ? new Date(r.finishedAt) : null,
    approvedAt: r.approvedAt !== undefined ? new Date(r.approvedAt) : null,
    approvedBy: r.approvedBy ?? null,
    outputSummary: r.outputSummary ?? null,
    draftPayload: r.draftPayload ?? null,
    errorMessage: r.errorMessage ?? null,
  };
}

function toEvent(r: PipelineEventRecord): PipelineEventRow {
  return {
    id: r.id,
    runId: r.runId,
    stage: r.stage,
    level: r.level,
    message: r.message,
    metrics: (r.metrics as Record<string, unknown> | undefined) ?? null,
    createdAt: new Date(r.createdAt),
  };
}

// --- User-facing reads (cookie-authed) -------------------------------------

/**
 * The "current" run for a specialty: the most recent non-terminal run if any
 * exists; otherwise the most recent of any status. Null if no runs.
 */
export async function getCurrentPipelineRun(
  slug: string,
): Promise<PipelineRunRow | null> {
  await connection();
  const pb = await userClient();
  const active = await pb.collection<PipelineRunRecord>('pipelineRuns').getList(1, 1, {
    filter: pb.filter(
      'specialtySlug = {:slug} && status != "completed" && status != "failed" && status != "cancelled"',
      { slug },
    ),
    sort: '-startedAt',
  });
  const activeRow = active.items.find((r) => !TERMINAL_STATUSES.has(r.status));
  if (activeRow) return toRun(activeRow);

  const latest = await pb.collection<PipelineRunRecord>('pipelineRuns').getList(1, 1, {
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    sort: '-startedAt',
  });
  return latest.items[0] ? toRun(latest.items[0]) : null;
}

export async function listPipelineRuns(slug: string): Promise<PipelineRunRow[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    sort: '-startedAt',
  });
  return rows.map(toRun);
}

export async function listPipelineStages(
  runId: string,
  _slug: string,
): Promise<PipelineStageRow[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<PipelineStageRecord>('pipelineStages')
    .getFullList({ filter: pb.filter('runId = {:runId}', { runId }) });
  return rows.map(toStage);
}

export async function listPipelineEvents(
  runId: string,
  _slug: string,
): Promise<PipelineEventRow[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<PipelineEventRecord>('pipelineEvents').getFullList({
    filter: pb.filter('runId = {:runId}', { runId }),
    sort: 'createdAt',
  });
  return rows.map(toEvent);
}

/**
 * Latest stage per stage-name for a specialty, with each stage's owning run
 * URLs and the run+stage events. Used by the dashboard so each stage card is
 * self-contained.
 */
export async function getLatestStageContexts(
  slug: string,
): Promise<Partial<Record<StageName, StageContext>>> {
  await connection();
  const pb = await userClient();
  const runs = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
  });
  if (runs.length === 0) return {};

  const runById = new Map<string, PipelineRunRecord>(runs.map((r) => [r.id, r]));
  const stageRows: PipelineStageRecord[] = [];
  for (const r of runs) {
    const stages = await pb
      .collection<PipelineStageRecord>('pipelineStages')
      .getFullList({ filter: pb.filter('runId = {:runId}', { runId: r.id }) });
    stageRows.push(...stages);
  }

  // Pick the most recent stage per stage-name. Precedence:
  //   finishedAt > startedAt > run.startedAt.
  const latestByStage = new Map<string, { row: PipelineStageRecord; ts: number }>();
  for (const s of stageRows) {
    const run = runById.get(s.runId);
    const ts = s.finishedAt ?? s.startedAt ?? run?.startedAt ?? 0;
    const prev = latestByStage.get(s.stage);
    if (!prev || ts > prev.ts) latestByStage.set(s.stage, { row: s, ts });
  }

  const contributedRunIds = new Set([...latestByStage.values()].map((v) => v.row.runId));
  const eventRows: PipelineEventRecord[] = [];
  for (const rid of contributedRunIds) {
    const evs = await pb
      .collection<PipelineEventRecord>('pipelineEvents')
      .getFullList({ filter: pb.filter('runId = {:runId}', { runId: rid }) });
    eventRows.push(...evs);
  }
  eventRows.sort((a, b) => a.createdAt - b.createdAt);

  const out: Partial<Record<StageName, StageContext>> = {};
  for (const [stageName, { row }] of latestByStage.entries()) {
    const run = runById.get(row.runId);
    out[stageName as StageName] = {
      stage: toStage(row),
      runUrls: run?.contentOutlineUrls ?? null,
      events: eventRows
        .filter((e) => e.runId === row.runId && e.stage === stageName)
        .map(toEvent),
    };
  }
  return out;
}

export async function getMapCodesHistory(slug: string): Promise<MapCodesHistory> {
  await connection();
  const pb = await userClient();
  const runs = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    sort: '-startedAt',
  });
  if (runs.length === 0) return { runs: [], events: [], eventsByRunId: {} };
  const events: PipelineEventRecord[] = [];
  const runIdsWithMapEvents = new Set<string>();
  for (const r of runs) {
    const evs = await pb.collection<PipelineEventRecord>('pipelineEvents').getFullList({
      filter: pb.filter('runId = {:runId} && stage = {:stage}', {
        runId: r.id,
        stage: 'map_codes',
      }),
    });
    if (evs.length > 0) {
      runIdsWithMapEvents.add(r.id);
      events.push(...evs);
    }
  }
  events.sort((a, b) => a.createdAt - b.createdAt);
  const eventRows = events.map(toEvent);
  const eventsByRunId: Record<string, PipelineEventRow[]> = {};
  for (const event of eventRows) {
    const list = eventsByRunId[event.runId] ?? [];
    list.push(event);
    eventsByRunId[event.runId] = list;
  }
  return {
    runs: runs.filter((r) => runIdsWithMapEvents.has(r.id)).map(toRun),
    events: eventRows,
    eventsByRunId,
  };
}

/**
 * Phase lookup for the home-page specialty grid. One scan returns the most
 * recent run status per specialty; result is keyed by slug.
 */
export async function listSpecialtyPhases(): Promise<Record<string, Phase>> {
  await connection();
  const pb = await userClient();
  const runs = await pb
    .collection<PipelineRunRecord>('pipelineRuns')
    .getFullList({ sort: '-startedAt' });
  const latest = new Map<string, { status: string; startedAt: number }>();
  for (const r of runs) {
    const prev = latest.get(r.specialtySlug);
    if (!prev || r.startedAt > prev.startedAt) {
      latest.set(r.specialtySlug, { status: r.status, startedAt: r.startedAt });
    }
  }
  const out: Record<string, Phase> = {};
  for (const [slug, v] of latest.entries()) {
    out[slug] = derivePhase({ status: v.status });
  }
  return out;
}

/**
 * Per-code mapping run metadata: the most recent `map_codes` run that touched
 * `code` for `slug`, plus the per-attempt event log for that code.
 */
export type CodeRunMetadataResult = {
  run: PipelineRunRow;
  stage: PipelineStageRow | null;
  events: PipelineEventRow[];
};

export async function getCodeRunMetadataPipeline(
  slug: string,
  code: string,
): Promise<CodeRunMetadataResult | null> {
  await connection();
  const pb = await userClient();
  const runs = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    sort: '-startedAt',
  });
  for (const run of runs) {
    const events = await pb
      .collection<PipelineEventRecord>('pipelineEvents')
      .getFullList({
        filter: pb.filter('runId = {:runId} && stage = {:stage}', {
          runId: run.id,
          stage: 'map_codes',
        }),
        sort: 'createdAt',
      });
    const codeEvents = events.filter((e) => {
      const m = e.metrics as { code?: string } | undefined;
      return m?.code === code;
    });
    if (codeEvents.length === 0) continue;
    let stageRow: PipelineStageRecord | null = null;
    try {
      stageRow = await pb
        .collection<PipelineStageRecord>('pipelineStages')
        .getFirstListItem(
          pb.filter('runId = {:runId} && stage = {:stage}', {
            runId: run.id,
            stage: 'map_codes',
          }),
        );
    } catch (e) {
      if (!(e instanceof ClientResponseError && e.status === 404)) throw e;
    }
    return {
      run: toRun(run),
      stage: stageRow ? toStage(stageRow) : null,
      events: codeEvents.map(toEvent),
    };
  }
  return null;
}

/**
 * Consolidation lock state for a specialty. Locked when the most recent
 * `consolidate_primary` stage across every run for the specialty is in any
 * status other than `pending`/`skipped`.
 */
export async function getConsolidationLockState(
  slug: string,
): Promise<{ locked: boolean; status: string | null }> {
  await connection();
  const pb = await userClient();
  const runs = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
  });
  let latest: { status: string; ts: number } | null = null;
  for (const r of runs) {
    const stages = await pb
      .collection<PipelineStageRecord>('pipelineStages')
      .getFullList({
        filter: pb.filter('runId = {:runId} && stage = {:stage}', {
          runId: r.id,
          stage: 'consolidate_primary',
        }),
      });
    for (const s of stages) {
      const ts = s.finishedAt ?? s.startedAt ?? r.startedAt;
      if (!latest || ts > latest.ts) latest = { status: s.status, ts };
    }
  }
  const status = latest?.status ?? null;
  const locked = status !== null && status !== 'pending' && status !== 'skipped';
  return { locked, status };
}

/**
 * Whether code/milestone extraction is *freshly* running for a specialty —
 * drives the "Running…" Start-extraction buttons on the Categories, Mapping
 * and Milestones tabs (which live outside the pipeline dashboard and so lack
 * its 2s poll). Applies the same staleness guard (`isStageRunningFresh`) as the
 * dashboard stage card, so a jammed run never pins a button to "Running…".
 */
export async function getExtractionRunning(
  slug: string,
): Promise<{ extract_codes: boolean; extract_milestones: boolean }> {
  await connection();
  const pb = await userClient();
  const runs = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
  });
  type Latest = { status: string; startedAt: number };
  const latest: Partial<Record<'extract_codes' | 'extract_milestones', Latest>> = {};
  for (const r of runs) {
    const stages = await pb
      .collection<PipelineStageRecord>('pipelineStages')
      .getFullList({ filter: pb.filter('runId = {:runId}', { runId: r.id }) });
    for (const s of stages) {
      if (s.stage !== 'extract_codes' && s.stage !== 'extract_milestones') continue;
      const startedAt = s.startedAt ?? r.startedAt;
      const prev = latest[s.stage];
      if (!prev || startedAt > prev.startedAt) {
        latest[s.stage] = { status: s.status, startedAt };
      }
    }
  }
  return {
    extract_codes: isStageRunningFresh(latest.extract_codes),
    extract_milestones: isStageRunningFresh(latest.extract_milestones),
  };
}

// --- User-facing writes (cookie-authed) ------------------------------------

export type PipelineRunPatch = {
  status?: string;
  workflowRunId?: string;
  finishedAt?: number;
  error?: string | null;
  contentOutlineUrls?: ContentInputRef[];
  identifyModulesInstructions?: string;
  extractCodesInstructions?: string;
  milestonesInstructions?: string | null;
  mappingInstructions?: string | null;
  mappingCheckIds?: boolean;
  mappingFilter?: MappingFilterRef;
};

export async function createPipelineRun(args: {
  specialtySlug: string;
  workflowRunId?: string;
  createdByUserId?: string;
  /** Per-category re-run scope — written to `pipelineRuns.targetCategories`
   *  so live subscribers can derive which buckets are rebuilding. Omit
   *  for full-specialty runs. */
  targetCategories?: string[] | null;
}): Promise<{ id: string }> {
  const pb = await userClient();
  const now = Date.now();
  // Build the payload conditionally so optional fields are NEVER sent as
  // undefined. PocketBase's create() validates the payload against the
  // collection schema; an unrecognized field or an unexpected null can
  // surface as "Failed to create record." with no further detail, which
  // had me chasing a phantom JSON-column bug.
  const payload: Record<string, unknown> = {
    specialtySlug: args.specialtySlug,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    mappingCheckIds: true,
  };
  if (args.workflowRunId !== undefined) payload.workflowRunId = args.workflowRunId;
  if (args.createdByUserId !== undefined) payload.createdByUserId = args.createdByUserId;
  if (args.targetCategories && args.targetCategories.length > 0) {
    payload.targetCategories = args.targetCategories;
  }
  const created = await pb.collection<PipelineRunRecord>('pipelineRuns').create(payload);
  return { id: created.id };
}

export async function updatePipelineRun(
  runId: string,
  patch: PipelineRunPatch,
): Promise<void> {
  const pb = await userClient();
  const cleaned: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleaned[k] = v;
  }
  await pb.collection('pipelineRuns').update(runId, cleaned);
}

export async function initPipelineStage(args: {
  runId: string;
  stage: StageName;
  /** Initial stage status. Defaults to `'pending'`. Pass `'running'` to
   *  persist the in-progress state synchronously inside the request, so a
   *  reload shows "Running" immediately — before the (deferred) workflow
   *  body has a chance to call `markStageRunning`. */
  status?: 'pending' | 'running';
}): Promise<{ id: string }> {
  const pb = await userClient();
  const status = args.status ?? 'pending';
  const created = await pb.collection<PipelineStageRecord>('pipelineStages').create({
    runId: args.runId,
    stage: args.stage,
    status,
    ...(status === 'running' ? { startedAt: Date.now() } : {}),
  });
  return { id: created.id };
}

// --- Admin-side helpers (workflow code: no cookies in scope) ---------------

async function findStageId(
  pb: PocketBase,
  runId: string,
  stage: string,
): Promise<string | null> {
  try {
    const row = await pb
      .collection<PipelineStageRecord>('pipelineStages')
      .getFirstListItem(
        pb.filter('runId = {:runId} && stage = {:stage}', { runId, stage }),
      );
    return row.id;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

export async function createPipelineRunAsAdmin(args: {
  specialtySlug: string;
  workflowRunId?: string;
  createdByUserId?: string;
}): Promise<{ id: string }> {
  const pb = await createAdminClient();
  const now = Date.now();
  const created = await pb.collection<PipelineRunRecord>('pipelineRuns').create({
    specialtySlug: args.specialtySlug,
    status: 'running',
    workflowRunId: args.workflowRunId,
    startedAt: now,
    updatedAt: now,
    mappingCheckIds: true,
    createdByUserId: args.createdByUserId,
  });
  return { id: created.id };
}

export async function updatePipelineRunAsAdmin(
  runId: string,
  patch: PipelineRunPatch,
): Promise<void> {
  const pb = await createAdminClient();
  const cleaned: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleaned[k] = v;
  }
  await pb.collection('pipelineRuns').update(runId, cleaned);
}

/**
 * Lean status read used by fire-and-forget workflows to cooperatively
 * cancel when an editor resets the stage mid-batch. Returns null if the
 * run row has been deleted underneath us.
 */
export async function getPipelineRunStatusAsAdmin(
  runId: string,
): Promise<PipelineRunRecord['status'] | null> {
  const pb = await createAdminClient();
  try {
    const row = await pb
      .collection<PipelineRunRecord>('pipelineRuns')
      .getOne(runId, { fields: 'status' });
    return row.status;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

export async function initPipelineStageAsAdmin(args: {
  runId: string;
  stage: StageName;
}): Promise<{ id: string }> {
  const pb = await createAdminClient();
  const created = await pb.collection<PipelineStageRecord>('pipelineStages').create({
    runId: args.runId,
    stage: args.stage,
    status: 'pending',
  });
  return { id: created.id };
}

export type PipelineStagePatch = {
  status?: string;
  workflowRunId?: string;
  startedAt?: number | null;
  finishedAt?: number | null;
  approvedAt?: number | null;
  approvedBy?: string | null;
  outputSummary?: unknown;
  draftPayload?: unknown;
  errorMessage?: string | null;
};

export async function updatePipelineStageAsAdmin(args: {
  runId: string;
  stage: StageName;
  patch: PipelineStagePatch;
}): Promise<void> {
  const pb = await createAdminClient();
  const id = await findStageId(pb, args.runId, args.stage);
  if (!id) throw new Error(`stage not found: ${args.runId}/${args.stage}`);
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.patch)) {
    if (v !== undefined) cleaned[k] = v;
  }
  await pb.collection('pipelineStages').update(id, cleaned);
}

export async function getStageAsAdmin(args: {
  runId: string;
  stage: StageName;
}): Promise<PipelineStageRow | null> {
  const pb = await createAdminClient();
  try {
    const row = await pb
      .collection<PipelineStageRecord>('pipelineStages')
      .getFirstListItem(
        pb.filter('runId = {:runId} && stage = {:stage}', {
          runId: args.runId,
          stage: args.stage,
        }),
      );
    return toStage(row);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

export async function listEventsAsAdmin(runId: string): Promise<PipelineEventRow[]> {
  const pb = await createAdminClient();
  const rows = await pb.collection<PipelineEventRecord>('pipelineEvents').getFullList({
    filter: pb.filter('runId = {:runId}', { runId }),
    sort: 'createdAt',
  });
  return rows.map(toEvent);
}

export async function logPipelineEventAsAdmin(args: {
  runId: string;
  stage: string;
  level: string;
  message: string;
  metrics?: unknown;
}): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('pipelineEvents').create({
    runId: args.runId,
    stage: args.stage,
    level: args.level,
    message: args.message,
    metrics: args.metrics,
    createdAt: Date.now(),
  });
}

export type ExtractedCodeInput = {
  code: string;
  category?: string;
  consolidationCategory?: string;
  description?: string;
  source?: string;
  metadata?: unknown;
};

export async function writeExtractedCodesAsAdmin(args: {
  runId: string;
  specialtySlug: string;
  rows: ExtractedCodeInput[];
}): Promise<void> {
  const pb = await createAdminClient();
  const now = Date.now();
  for (const r of args.rows) {
    try {
      await pb.collection('extractedCodes').create({
        runId: args.runId,
        specialtySlug: args.specialtySlug,
        ...r,
        createdAt: now,
      });
    } catch (e) {
      // PocketBase surfaces a generic "Failed to create record" that hides
      // which field/value was rejected. Re-throw with the offending code and
      // the validation detail so a bad row is diagnosable instead of failing
      // the whole extraction opaquely.
      const detail =
        e && typeof e === 'object' && 'response' in e
          ? JSON.stringify((e as { response?: unknown }).response)
          : String(e);
      throw new Error(`extractedCodes create failed for code "${r.code}": ${detail}`);
    }
  }
}

export type ExtractedCodeRow = {
  id: string;
  runId: string;
  specialtySlug: string;
  code: string;
  category?: string;
  consolidationCategory?: string;
  description?: string;
  source?: string;
  metadata?: unknown;
};

export async function listExtractedCodesForRunAsAdmin(
  runId: string,
): Promise<ExtractedCodeRow[]> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<ExtractedCodeRecord>('extractedCodes')
    .getFullList({ filter: pb.filter('runId = {:runId}', { runId }) });
  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    specialtySlug: r.specialtySlug,
    code: r.code,
    category: r.category,
    consolidationCategory: r.consolidationCategory,
    description: r.description,
    source: r.source,
    metadata: r.metadata,
  }));
}

/**
 * Cancel every non-terminal run for a specialty. Returns count cancelled.
 * Cookie-authed — called from request handlers (e.g. clear-stale-runs).
 */
export async function cancelStaleRunsForSpecialty(
  slug: string,
): Promise<{ cancelled: number }> {
  const pb = await userClient();
  return cancelStaleRuns(pb, slug);
}

export async function cancelStaleRunsForSpecialtyAsAdmin(
  slug: string,
): Promise<{ cancelled: number }> {
  const pb = await createAdminClient();
  return cancelStaleRuns(pb, slug);
}

async function cancelStaleRuns(
  pb: PocketBase,
  slug: string,
): Promise<{ cancelled: number }> {
  const rows = await pb.collection<PipelineRunRecord>('pipelineRuns').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
  });
  const now = Date.now();
  let cancelled = 0;
  for (const r of rows) {
    if (TERMINAL_STATUSES.has(r.status)) continue;
    await pb.collection('pipelineRuns').update(r.id, {
      status: 'cancelled',
      finishedAt: now,
      updatedAt: now,
    });
    cancelled += 1;
  }
  return { cancelled };
}

/**
 * Wipe the events + extracted_codes scoped to (runId, stage) and reset the
 * stage row to pending. Cookie-authed because /api/workflows/cancel runs in a
 * request context.
 */
export async function resetStage(args: {
  runId: string;
  stage: StageName;
}): Promise<void> {
  const pb = await userClient();
  await resetStageInternal(pb, args.runId, args.stage);
}

async function resetStageInternal(
  pb: PocketBase,
  runId: string,
  stage: StageName,
): Promise<void> {
  const events = await pb.collection<PipelineEventRecord>('pipelineEvents').getFullList({
    filter: pb.filter('runId = {:runId} && stage = {:stage}', { runId, stage }),
  });
  await Promise.all(events.map((e) => pb.collection('pipelineEvents').delete(e.id)));

  if (stage === 'extract_codes') {
    const ec = await pb
      .collection<ExtractedCodeRecord>('extractedCodes')
      .getFullList({ filter: pb.filter('runId = {:runId}', { runId }) });
    await Promise.all(ec.map((r) => pb.collection('extractedCodes').delete(r.id)));
  }

  const stageId = await findStageId(pb, runId, stage);
  if (stageId) {
    await pb.collection('pipelineStages').update(stageId, {
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      approvedAt: null,
      approvedBy: null,
      outputSummary: null,
      draftPayload: null,
      errorMessage: null,
    });
  }
}
