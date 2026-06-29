import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { SpecialtyRecord } from '@/lib/pb/types';
import {
  normalizePipelineStageStates,
  type PipelineCardState,
  type PipelineStageStates,
} from '@/lib/pipeline-stage-state';
import type { MappingSource, PipelineMode, Specialty } from '@/lib/types';
import { DEFAULT_CURRICULUM_MILESTONES } from '@/lib/workflows/lib/student-milestones';

// Specialties live in PocketBase. RSC pages call these helpers and get a
// snapshot via the cookie-authed PB client. Client components that need
// real-time updates subscribe via pb.collection('specialties').subscribe()
// from the browser SDK.
//
// `'use cache'` and `cacheTag`/`cacheLife` are intentionally absent — PB
// real-time subscriptions handle invalidation, and Next's cache layer
// would just add staleness without saving any work for an internal tool.

function toSpecialty(row: SpecialtyRecord): Specialty {
  const pipelineMode = resolvePipelineMode(row);
  return {
    slug: row.slug,
    name: row.name,
    // The repo-typed Specialty narrows source to `'sheets'|'xlsx'|'manual'|
    // 'board'`. Keep the runtime value untouched and cast — call-sites
    // string-equality-check the variants they care about.
    source: row.source as Specialty['source'],
    sheetId: row.sheetId,
    xlsxPath: row.xlsxPath,
    pipelineMode,
    // `mappingOnly` is derived from the mode — both 'mapping-only' and
    // 'rag-corpus' want consolidation/suggestions hidden, so every existing
    // `mappingOnly` consumer keeps working unchanged.
    mappingOnly: pipelineMode !== 'full',
    mappingSource: normalizeMappingSource(row.mappingSource),
  };
}

/** Narrow the stored text to the union; empty/unknown → 'amboss' (today's
 *  behaviour) so existing specialties keep mapping against AMBOSS only. */
function normalizeMappingSource(value: string | undefined): MappingSource {
  return value === 'guidelines' || value === 'both' ? value : 'amboss';
}

/**
 * Resolve a specialty's run mode. The `pipelineMode` column is the source of
 * truth; legacy rows written before it fall back to the old `mappingOnly`
 * boolean (`true` → 'mapping-only'). Unknown/empty values read as 'full'.
 * Exported for the workflow context loader (`loadSpecialtyForMapping`).
 */
export function resolvePipelineMode(
  row: Pick<SpecialtyRecord, 'pipelineMode' | 'mappingOnly'> | null | undefined,
): PipelineMode {
  const v = row?.pipelineMode;
  if (
    v === 'full' ||
    v === 'mapping-only' ||
    v === 'rag-corpus' ||
    v === 'curriculum-mapping'
  )
    return v;
  return row?.mappingOnly ? 'mapping-only' : 'full';
}

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

// `await connection()` marks each call as request-time so Next 16's
// `cacheComponents` static prerender doesn't try to statically inline the
// PocketBase fetch.

export async function listSpecialties(): Promise<Specialty[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection('specialties')
    .getFullList<SpecialtyRecord>({ sort: 'name' });
  return rows.map(toSpecialty);
}

export async function getSpecialty(slug: string): Promise<Specialty | null> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection('specialties')
      .getFirstListItem<SpecialtyRecord>(`slug = "${slug}"`);
    return toSpecialty(row);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Approved milestones blob for a specialty. Lives on
 * `specialties.milestones` (plain text, written at the end of the
 * extract-milestones workflow). Returns `null` when the pipeline hasn't
 * produced any yet.
 */
export async function getMilestones(slug: string): Promise<string | null> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection('specialties')
      .getFirstListItem<SpecialtyRecord>(`slug = "${slug}"`);
    return row.milestones ?? null;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Create or upsert a specialty (matched on slug). Used by the manual
 * "Add specialty" form, exposed as POST /api/specialties.
 */
export async function createSpecialty(args: {
  slug: string;
  name: string;
  source: string;
  sheetId?: string;
  xlsxPath?: string;
  region?: string;
  language?: string;
  mappingOnly?: boolean;
  mappingSource?: MappingSource;
  pipelineMode?: PipelineMode;
}): Promise<string> {
  const pb = await userClient();
  const collection = pb.collection<SpecialtyRecord>('specialties');
  try {
    const existing = await collection.getFirstListItem(`slug = "${args.slug}"`);
    // Upsert path: never touch milestones here, so re-saving settings can't
    // clobber an edited/extracted milestone set. The create branch below seeds.
    const updated = await collection.update(existing.id, args);
    return updated.id;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      // New curriculum-mapping specialties start with the built-in year-based
      // coverage-level rubric so they're mappable immediately; student-tuned
      // extraction or a manual upload can override it later.
      const payload =
        args.pipelineMode === 'curriculum-mapping'
          ? {
              ...args,
              milestones: DEFAULT_CURRICULUM_MILESTONES,
              lastSeededAt: Date.now(),
            }
          : args;
      const created = await collection.create(payload);
      return created.id;
    }
    throw e;
  }
}

/**
 * Read the per-tab manual override map (`{ segment: true }`) for a
 * specialty. Used by pages that render `<MarkStepCompleteButton>` so
 * they can show the right "complete" vs "incomplete" label without
 * re-running the whole `getTabsComplete` derivation.
 */
export async function getTabOverrides(slug: string): Promise<Record<string, boolean>> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
    return (row.tabOverrides ?? {}) as Record<string, boolean>;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return {};
    throw e;
  }
}

/**
 * Set or clear a per-tab "manual step complete" override on a
 * specialty. Used by the `<MarkStepCompleteButton>` to flip a tab's
 * indicator to a checkmark when auto-derive can't determine completion
 * (Overview, Categories). Read-merge-write so concurrent edits on
 * different segments don't clobber each other.
 */
export async function setTabOverride(
  slug: string,
  segment: string,
  value: boolean,
): Promise<void> {
  const pb = await userClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${slug}"`);
  const current = (row.tabOverrides ?? {}) as Record<string, boolean>;
  const next: Record<string, boolean> = { ...current };
  if (value) next[segment] = true;
  else delete next[segment];
  await pb.collection('specialties').update(row.id, { tabOverrides: next });
}

/**
 * Flip the "Mapping only" mode on a specialty. Backs the header toggle
 * (PATCH /api/specialties). Coverage data and any already-generated
 * suggestions are left untouched — the flag only changes future mapping
 * behaviour and which surfaces are visible.
 */
export async function setSpecialtyMappingOnly(
  slug: string,
  value: boolean,
): Promise<void> {
  const pb = await userClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${slug}"`);
  await pb.collection('specialties').update(row.id, { mappingOnly: value });
}

/**
 * Set the mapping source ('amboss' | 'guidelines' | 'both') on a specialty.
 * Backs the header control (PATCH /api/specialties). Existing coverage data is
 * left untouched — the setting only changes which source(s) future mapping
 * runs query.
 */
export async function setSpecialtyMappingSource(
  slug: string,
  value: MappingSource,
): Promise<void> {
  const pb = await userClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${slug}"`);
  await pb.collection('specialties').update(row.id, { mappingSource: value });
}

/**
 * Set the per-specialty workflow mode ('full' | 'mapping-only' | 'rag-corpus'
 * | 'curriculum-mapping'). Source of truth for what the pipeline runs; the data
 * layer derives `mappingOnly` from it. Existing coverage/suggestion data is left
 * untouched — the mode only changes future runs and which surfaces are visible.
 * Callers that switch to 'rag-corpus' should also pin the mapping source to
 * 'guidelines', and 'curriculum-mapping' to 'amboss' (the API route does this).
 */
export async function setSpecialtyPipelineMode(
  slug: string,
  value: PipelineMode,
): Promise<void> {
  const pb = await userClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${slug}"`);
  await pb.collection('specialties').update(row.id, { pipelineMode: value });
}

/**
 * Read the legacy per-stage manual override map for a specialty. New
 * writes use `pipelineStageStates` instead; this is kept as a read-only
 * fallback for older rows. Used by `normalizePipelineStageStates`.
 */
export async function getPipelineStageOverrides(
  slug: string,
): Promise<Record<string, boolean>> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
    return (row.pipelineStageOverrides ?? {}) as Record<string, boolean>;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return {};
    throw e;
  }
}

/**
 * Read the legacy per-stage manual "skip" map for a specialty. New
 * writes use `pipelineStageStates`; this is the read-only fallback for
 * older rows applied to the optional 2nd-consolidation stages.
 */
export async function getPipelineStageSkipped(
  slug: string,
): Promise<Record<string, boolean>> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
    return (row.pipelineStageSkipped ?? {}) as Record<string, boolean>;
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return {};
    throw e;
  }
}

/**
 * Read editor-controlled pipeline card states. Falls back to legacy
 * boolean blobs for older rows: skipped wins, then complete, otherwise
 * not started.
 */
export async function getPipelineStageStates(slug: string): Promise<PipelineStageStates> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
    return normalizePipelineStageStates({
      states: row.pipelineStageStates,
      overrides: row.pipelineStageOverrides,
      skipped: row.pipelineStageSkipped,
    });
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      return normalizePipelineStageStates({});
    }
    throw e;
  }
}

/**
 * Bulk variant for the home grids: single `specialties` scan, normalized
 * stage state per slug. Replaces the broader cross-collection derivation
 * that used to back the now-removed last-completed-step badge.
 */
export async function listSpecialtyPipelineStageStates(): Promise<
  Record<string, PipelineStageStates>
> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<SpecialtyRecord>('specialties').getFullList();
  const out: Record<string, PipelineStageStates> = {};
  for (const row of rows) {
    out[row.slug] = normalizePipelineStageStates({
      states: row.pipelineStageStates,
      overrides: row.pipelineStageOverrides,
      skipped: row.pipelineStageSkipped,
    });
  }
  return out;
}

/**
 * Set a per-stage editor state. New writes intentionally avoid legacy
 * override/skip fields so those remain read-only compatibility fallbacks.
 */
export async function setPipelineStageState(
  slug: string,
  stageName: string,
  state: PipelineCardState,
): Promise<void> {
  const pb = await userClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${slug}"`);
  const current = normalizePipelineStageStates({
    states: row.pipelineStageStates,
    overrides: row.pipelineStageOverrides,
    skipped: row.pipelineStageSkipped,
  });
  const next: Record<string, PipelineCardState> = { ...current, [stageName]: state };
  await pb.collection('specialties').update(row.id, { pipelineStageStates: next });
}

/**
 * Admin-client variant of {@link setPipelineStageState} for fire-and-forget
 * workflow contexts that run outside a request cookie scope. Used to auto-flip
 * the two extraction cards to `complete` when a run finishes, and to clear
 * stage cards back to `not_started` as part of the reset cascade.
 */
export async function setPipelineStageStateAsAdmin(
  slug: string,
  stageName: string,
  state: PipelineCardState,
): Promise<void> {
  const pb = await createAdminClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${slug}"`);
  const current = normalizePipelineStageStates({
    states: row.pipelineStageStates,
    overrides: row.pipelineStageOverrides,
    skipped: row.pipelineStageSkipped,
  });
  const next: Record<string, PipelineCardState> = { ...current, [stageName]: state };
  await pb.collection('specialties').update(row.id, { pipelineStageStates: next });
}

/**
 * Workflow write — uses the admin client so it works outside a request
 * cookie context. Stores approved milestone text and bumps the
 * `lastSeededAt` timestamp. Pass `milestones: undefined` to clear (used
 * by reset-stage on extract_milestones).
 */
export async function updateMilestonesAsAdmin(args: {
  slug: string;
  milestones?: string;
  bumpSeedTimestamp?: boolean;
}): Promise<void> {
  const pb = await createAdminClient();
  const row = await pb
    .collection<SpecialtyRecord>('specialties')
    .getFirstListItem(`slug = "${args.slug}"`);
  const patch: { milestones?: string; lastSeededAt?: number } = {
    milestones: args.milestones,
  };
  if (args.bumpSeedTimestamp) patch.lastSeededAt = Date.now();
  await pb.collection('specialties').update(row.id, patch);
}

/**
 * Workflow-side specialty read (admin-authed, no cookie). Used by
 * workflow steps that may run outside a request context.
 */
export async function getSpecialtyAsAdmin(slug: string): Promise<Specialty | null> {
  const pb = await createAdminClient();
  try {
    const row = await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
    return toSpecialty(row);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Full PocketBase specialty record (admin-authed). Used by workflow
 * steps that need fields beyond the UI Specialty type — e.g. region,
 * language, milestones.
 */
export async function getSpecialtyRecordAsAdmin(
  slug: string,
): Promise<SpecialtyRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}
