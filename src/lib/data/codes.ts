import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { touchBucketInputChangedAsAdmin } from '@/lib/data/categories';
import {
  type CodeCategorySummary,
  deriveCodeCategories,
} from '@/lib/data/code-categories';
import { deriveCodeTableCounts } from '@/lib/data/code-table-counts';
import type { ParsedCodeRow } from '@/lib/import/code-import';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  CodeRecord,
  CoveredSection,
  GuidelineCoverage,
  MappingInFlightRecord,
  NewArticle,
  QuestionRef,
  SectionUpdate,
} from '@/lib/pb/types';
import { filterCodesByConsolidationCategories } from '@/lib/workflows/consolidation/buckets';

export type CodeTableRow = Pick<
  CodeRecord,
  | 'id'
  | 'created'
  | 'updated'
  | 'collectionId'
  | 'collectionName'
  | 'specialtySlug'
  | 'specialty'
  | 'source'
  | 'code'
  | 'category'
  | 'consolidationCategory'
  | 'description'
  | 'isInAMBOSS'
  | 'mappedAt'
  | 'consolidationInputChangedAt'
  | 'coverageLevel'
  | 'depthOfCoverage'
  | 'coverageArticleCount'
  | 'coverageSectionCount'
  | 'existingArticleUpdateCount'
  | 'newArticleSuggestionCount'
  | 'isInGuidelines'
  | 'guidelineCoverageLevel'
  | 'guidelineDepthOfCoverage'
  | 'guidelineCount'
  | 'guidelineRecommendationCount'
  | 'overallCoverageLevel'
  | 'overallDepthOfCoverage'
  | 'mappingSourceUsed'
  | 'questionCount'
  | 'litSearchStatus'
  | 'litSearchSourceCount'
  | 'litSearchedAt'
  | 'curriculumMeta'
  | 'curriculumReviewStatus'
>;

type CodeTableRowSource = CodeTableRow &
  Pick<
    CodeRecord,
    | 'articlesWhereCoverageIs'
    | 'existingArticleUpdates'
    | 'newArticlesNeeded'
    | 'guidelinesWhereCoverageIs'
    | 'questionsWhereCoverageIs'
  >;

const CODE_TABLE_FIELDS = [
  'id',
  'created',
  'updated',
  'collectionId',
  'collectionName',
  'specialtySlug',
  'specialty',
  'source',
  'code',
  'category',
  'consolidationCategory',
  'description',
  'isInAMBOSS',
  'mappedAt',
  'consolidationInputChangedAt',
  'coverageLevel',
  'depthOfCoverage',
  'coverageArticleCount',
  'coverageSectionCount',
  'existingArticleUpdateCount',
  'newArticleSuggestionCount',
  'isInGuidelines',
  'guidelineCoverageLevel',
  'guidelineDepthOfCoverage',
  'guidelineCount',
  'guidelineRecommendationCount',
  'overallCoverageLevel',
  'overallDepthOfCoverage',
  'mappingSourceUsed',
  'questionCount',
  'litSearchStatus',
  'litSearchSourceCount',
  'litSearchedAt',
  'curriculumMeta',
  'curriculumReviewStatus',
  'articlesWhereCoverageIs',
  'existingArticleUpdates',
  'newArticlesNeeded',
  'guidelinesWhereCoverageIs',
  'questionsWhereCoverageIs',
].join(',');

function buildMappingCounts(mapping: {
  articlesWhereCoverageIs?: CoveredSection[];
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
  guidelinesWhereCoverageIs?: GuidelineCoverage[];
  questionsWhereCoverageIs?: QuestionRef[];
}): {
  coverageArticleCount: number;
  coverageSectionCount: number;
  existingArticleUpdateCount: number;
  newArticleSuggestionCount: number;
  guidelineCount: number;
  guidelineRecommendationCount: number;
  questionCount: number;
} {
  return deriveCodeTableCounts(mapping);
}

function toCodeTableRow(row: CodeTableRowSource): CodeTableRow {
  const {
    articlesWhereCoverageIs,
    existingArticleUpdates,
    newArticlesNeeded,
    guidelinesWhereCoverageIs,
    questionsWhereCoverageIs,
    ...rest
  } = row;
  return {
    ...rest,
    ...deriveCodeTableCounts({
      articlesWhereCoverageIs,
      existingArticleUpdates,
      newArticlesNeeded,
      guidelinesWhereCoverageIs,
      questionsWhereCoverageIs,
      coverageArticleCount: row.coverageArticleCount,
      coverageSectionCount: row.coverageSectionCount,
      existingArticleUpdateCount: row.existingArticleUpdateCount,
      newArticleSuggestionCount: row.newArticleSuggestionCount,
      guidelineCount: row.guidelineCount,
      guidelineRecommendationCount: row.guidelineRecommendationCount,
      questionCount: row.questionCount,
    }),
  };
}

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

// --- Reads -----------------------------------------------------------------

export async function listCodes(slug: string): Promise<CodeRecord[]> {
  await connection();
  const pb = await userClient();
  return pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}"`, sort: 'code' });
}

export async function getCode(slug: string, code: string): Promise<CodeRecord | null> {
  await connection();
  const pb = await userClient();
  try {
    return await pb
      .collection<CodeRecord>('codes')
      .getFirstListItem(`specialtySlug = "${slug}" && code = "${code}"`);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

export async function listInFlightCodes(slug: string): Promise<string[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  return rows.map((r) => r.code);
}

export async function listCodesPaginated(
  slug: string,
  page: number,
  perPage: number,
): Promise<{ items: CodeRecord[]; totalItems: number }> {
  await connection();
  const pb = await userClient();
  const result = await pb.collection<CodeRecord>('codes').getList(page, perPage, {
    filter: `specialtySlug = "${slug}"`,
    sort: 'code',
    skipTotal: false,
  });
  return { items: result.items, totalItems: result.totalItems };
}

export async function listCodeTableRowsPage(
  slug: string,
  page: number,
  perPage: number,
  updatedAfter?: string | null,
): Promise<{ items: CodeTableRow[]; hasMore: boolean }> {
  await connection();
  const pb = await userClient();
  const filter = updatedAfter
    ? pb.filter('specialtySlug = {:slug} && updated > {:updatedAfter}', {
        slug,
        updatedAfter,
      })
    : pb.filter('specialtySlug = {:slug}', { slug });
  const result = await pb.collection<CodeTableRowSource>('codes').getList(page, perPage, {
    filter,
    sort: updatedAfter ? 'updated' : 'code',
    fields: CODE_TABLE_FIELDS,
    skipTotal: true,
  });
  return {
    items: result.items.map(toCodeTableRow),
    hasMore: result.items.length === perPage,
  };
}

export async function listUnmappedCodeCount(slug: string): Promise<number> {
  await connection();
  const pb = await userClient();
  // mappedAt is the canonical "mapping has run" signal — see the migration
  // 1779000000_codes_mappedAt for why `isInAMBOSS` alone can't carry an
  // "unset" state in PocketBase.
  const list = await pb.collection<CodeRecord>('codes').getList(1, 1, {
    filter: `specialtySlug = "${slug}" && (mappedAt = 0 || mappedAt = null)`,
    skipTotal: false,
  });
  return list.totalItems;
}

/** Lean read of just the `code` strings for a specialty (import diffing). */
export async function listCodeStrings(slug: string): Promise<string[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    fields: 'code',
  });
  return rows.map((r) => r.code);
}

export async function listCodeCount(slug: string): Promise<number> {
  await connection();
  const pb = await userClient();
  const list = await pb.collection<CodeRecord>('codes').getList(1, 1, {
    filter: `specialtySlug = "${slug}"`,
    skipTotal: false,
  });
  return list.totalItems;
}

export type UnmappedCodePickerRow = {
  code: string;
  description: string | null;
  category: string | null;
};

export async function listUnmappedCodesForPicker(
  slug: string,
): Promise<UnmappedCodePickerRow[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: `specialtySlug = "${slug}" && (mappedAt = 0 || mappedAt = null)`,
    sort: 'code',
  });
  return rows.map((r) => ({
    code: r.code,
    description: r.description ?? null,
    category: r.category ?? null,
  }));
}

export {
  type CodeCategorySummary,
  deriveCodeCategories,
} from '@/lib/data/code-categories';

export async function listCodeCategories(slug: string): Promise<CodeCategorySummary[]> {
  const codes = await listCodes(slug);
  return deriveCodeCategories(codes);
}

// --- Writes (request-scoped: user edits) -----------------------------------

export type PatchCodeFields = {
  source?: string;
  description?: string;
  category?: string;
  consolidationCategory?: string;
  isInAMBOSS?: boolean;
  coverageLevel?: string;
  depthOfCoverage?: number;
  notes?: string;
  gaps?: string;
  improvements?: string;
  articlesWhereCoverageIs?: CoveredSection[];
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
  /** Curriculum-mapping approval gate. The reviewer email + timestamp are
   *  stamped server-side in `patchCode`, never client-supplied. */
  curriculumReviewStatus?: '' | 'approved' | 'rejected';
};

// Editing any of these on an unmapped row implies a (manual) mapping verdict —
// stamp `mappedAt` so the row starts counting as mapped. Pure metadata edits
// (source/description/category/consolidationCategory) are deliberately excluded.
const MAPPING_SIGNAL_FIELDS: Array<keyof PatchCodeFields> = [
  'isInAMBOSS',
  'coverageLevel',
  'depthOfCoverage',
  'notes',
  'gaps',
  'improvements',
  'articlesWhereCoverageIs',
  'existingArticleUpdates',
  'newArticlesNeeded',
];

// Fields that feed the consolidation prompt (see
// `listMappedCodesWithSuggestionsAsAdmin`). Changing any of them — or newly
// mapping a code — invalidates the bucket's consolidation output, so we stamp
// `consolidationInputChangedAt`. `notes`/`gaps`/`improvements`/`source`/
// `category` are editor metadata, NOT consolidation inputs, and are excluded.
const CONSOLIDATION_INPUT_FIELDS: Array<keyof PatchCodeFields> = [
  'consolidationCategory',
  'isInAMBOSS',
  'coverageLevel',
  'depthOfCoverage',
  'description',
  'articlesWhereCoverageIs',
  'existingArticleUpdates',
  'newArticlesNeeded',
];

/** Structural inequality — scalars by identity, arrays/objects by JSON. Treats
 *  null/undefined/absent as equal so a no-op save never stamps staleness. */
function valuesDiffer(a: unknown, b: unknown): boolean {
  if (a === b) return false;
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

/**
 * Apply an editor's per-code edit. Composite-key lookup; the caller (the
 * route) has already validated `fields` against the strict schema and enforced
 * the consolidation lock. Returns the updated `CodeTableRow` so the client can
 * merge it into local table state without waiting for the poll.
 *
 * When any of the three JSON arrays is written, the derived count columns are
 * recomputed server-side from the merged arrays — client counts are never
 * trusted. When a mapping-signal field is set on a row that hasn't been mapped
 * yet, `mappedAt` is stamped so the UI's "mapped" predicates surface the edit.
 */
export async function patchCode(
  slug: string,
  code: string,
  fields: PatchCodeFields,
  reviewerEmail?: string | null,
): Promise<CodeTableRow> {
  const pb = await userClient();
  const row = await pb
    .collection<CodeRecord>('codes')
    .getFirstListItem(
      pb.filter('specialtySlug = {:slug} && code = {:code}', { slug, code }),
    );

  const update: Record<string, unknown> = { ...fields };

  // Curriculum approval gate: stamp reviewer + time when a decision is made,
  // and clear both when the decision is reset to pending (''). This never
  // touches mappedAt — approval is not a mapping verdict.
  if (fields.curriculumReviewStatus !== undefined) {
    if (fields.curriculumReviewStatus === '') {
      update.curriculumReviewedAt = 0;
      update.curriculumReviewedBy = '';
    } else {
      update.curriculumReviewedAt = Date.now();
      update.curriculumReviewedBy = reviewerEmail ?? '';
    }
  }

  const touchesArrays =
    fields.articlesWhereCoverageIs !== undefined ||
    fields.existingArticleUpdates !== undefined ||
    fields.newArticlesNeeded !== undefined;
  if (touchesArrays) {
    Object.assign(
      update,
      deriveCodeTableCounts({
        articlesWhereCoverageIs:
          fields.articlesWhereCoverageIs ?? row.articlesWhereCoverageIs,
        existingArticleUpdates:
          fields.existingArticleUpdates ?? row.existingArticleUpdates,
        newArticlesNeeded: fields.newArticlesNeeded ?? row.newArticlesNeeded,
        // The patch route never edits guideline coverage or questions —
        // preserve their stored counts rather than letting them fall back to 0.
        guidelinesWhereCoverageIs: row.guidelinesWhereCoverageIs,
        guidelineCount: row.guidelineCount,
        guidelineRecommendationCount: row.guidelineRecommendationCount,
        questionsWhereCoverageIs: row.questionsWhereCoverageIs,
        questionCount: row.questionCount,
      }),
    );
  }

  const stampsMapping =
    !((row.mappedAt ?? 0) > 0) &&
    MAPPING_SIGNAL_FIELDS.some((k) => fields[k] !== undefined);
  if (stampsMapping) update.mappedAt = Date.now();

  // Stamp consolidation staleness when a consolidation-input field actually
  // changes value, or when the code transitions to mapped (it now becomes
  // consolidation input). No-op edits (same value) don't stamp.
  const changedConsolidationInput = CONSOLIDATION_INPUT_FIELDS.some(
    (k) => fields[k] !== undefined && valuesDiffer(fields[k], row[k]),
  );
  if (changedConsolidationInput || stampsMapping) {
    update.consolidationInputChangedAt = Date.now();
  }

  // A bucket move stales BOTH buckets: the destination via this code's own
  // stamp above, the origin via a bucket-level stamp (the code is gone from
  // it, so nothing else would mark it stale).
  const movedBucket =
    fields.consolidationCategory !== undefined &&
    valuesDiffer(fields.consolidationCategory, row.consolidationCategory);

  const updated = await pb.collection<CodeTableRowSource>('codes').update(row.id, update);
  if (movedBucket) {
    await touchBucketInputChangedAsAdmin(slug, row.consolidationCategory);
  }
  return toCodeTableRow(updated);
}

/**
 * Workflow-side lean read of unmapped codes, optionally narrowed by
 * category or by exact code.
 */
export async function listUnmappedCodesAsAdmin(
  slug: string,
  filter?: { categories?: string[]; codes?: string[]; approvedOnly?: boolean } | null,
): Promise<
  Array<{
    code: string;
    category: string | null;
    description: string | null;
    objective: string | null;
  }>
> {
  const pb = await createAdminClient();
  // Curriculum-mapping gate: only human-approved curriculum items are mapped.
  const approvedClause = filter?.approvedOnly
    ? ' && curriculumReviewStatus = "approved"'
    : '';
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: `specialtySlug = "${slug}" && (mappedAt = 0 || mappedAt = null)${approvedClause}`,
  });
  const catSet = filter?.categories?.length ? new Set(filter.categories) : null;
  const codeSet = filter?.codes?.length ? new Set(filter.codes) : null;
  return rows
    .filter((r) => {
      if (!catSet && !codeSet) return true;
      if (catSet && r.category && catSet.has(r.category)) return true;
      if (codeSet?.has(r.code)) return true;
      return false;
    })
    .map((r) => ({
      code: r.code,
      category: r.category ?? null,
      description: r.description ?? null,
      // The curriculum learning objective travels with the code so the mapping
      // agents can factor it into the AMBOSS/question coverage assessment.
      objective: r.curriculumMeta?.learningObjective ?? null,
    }));
}

/**
 * Workflow-side reader of mapped codes plus their LLM-emitted suggestion
 * blobs (`newArticlesNeeded`, `existingArticleUpdates`). The consolidation
 * runners feed these into the per-category aggregator, then (once the
 * real LLM dedupe prompt arrives) into the consolidation call itself.
 */
export async function listMappedCodesWithSuggestionsAsAdmin(
  slug: string,
  consolidationCategories?: string[] | null,
  sourceCategories?: string[] | null,
): Promise<
  Array<{
    code: string;
    category: string | null;
    consolidationCategory: string | null;
    description: string | null;
    depthOfCoverage?: number;
    newArticlesNeeded: NewArticle[];
    existingArticleUpdates: SectionUpdate[];
  }>
> {
  const pb = await createAdminClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: `specialtySlug = "${slug}" && mappedAt > 0`,
  });
  const sourceSet = sourceCategories?.length ? new Set(sourceCategories) : null;
  const byBucket = filterCodesByConsolidationCategories(rows, consolidationCategories);
  const bySource = sourceSet
    ? rows.filter((row) => row.category != null && sourceSet.has(row.category))
    : [];
  const selected = consolidationCategories?.length
    ? byBucket.length > 0
      ? byBucket
      : bySource
    : sourceSet
      ? bySource
      : byBucket;
  const seen = new Set<string>();
  return selected
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .map((r) => ({
      code: r.code,
      category: r.category ?? null,
      consolidationCategory: r.consolidationCategory ?? null,
      description: r.description ?? null,
      depthOfCoverage: r.depthOfCoverage,
      newArticlesNeeded: Array.isArray(r.newArticlesNeeded) ? r.newArticlesNeeded : [],
      existingArticleUpdates: Array.isArray(r.existingArticleUpdates)
        ? r.existingArticleUpdates
        : [],
    }));
}

/**
 * Count codes that have been coverage-mapped (`mappedAt > 0`) but never
 * processed for suggestions (`suggestionsGeneratedAt` unset). Drives the
 * visibility + actionable count of the "Generate suggestions" backfill card.
 */
export async function countMappedWithoutSuggestions(slug: string): Promise<number> {
  await connection();
  const pb = await userClient();
  const list = await pb.collection<CodeRecord>('codes').getList(1, 1, {
    filter: `specialtySlug = "${slug}" && mappedAt > 0 && (suggestionsGeneratedAt = 0 || suggestionsGeneratedAt = null)`,
    skipTotal: false,
  });
  return list.totalItems;
}

export type MappedCodeForSuggestions = {
  code: string;
  category: string | null;
  description: string | null;
  isInAMBOSS?: boolean;
  coverageLevel: string | null;
  depthOfCoverage?: number;
  notes: string | null;
  gaps: string | null;
  articlesWhereCoverageIs: CoveredSection[];
};

/**
 * Read coverage-mapped codes still missing suggestions, with the stored
 * coverage the suggestion-only pass needs as input. Admin-scoped (workflow).
 */
export async function listMappedCodesWithoutSuggestionsAsAdmin(
  slug: string,
): Promise<MappedCodeForSuggestions[]> {
  const pb = await createAdminClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: `specialtySlug = "${slug}" && mappedAt > 0 && (suggestionsGeneratedAt = 0 || suggestionsGeneratedAt = null)`,
  });
  return rows.map((r) => ({
    code: r.code,
    category: r.category ?? null,
    description: r.description ?? null,
    isInAMBOSS: r.isInAMBOSS,
    coverageLevel: r.coverageLevel ?? null,
    depthOfCoverage: r.depthOfCoverage,
    notes: r.notes ?? null,
    gaps: r.gaps ?? null,
    articlesWhereCoverageIs: Array.isArray(r.articlesWhereCoverageIs)
      ? r.articlesWhereCoverageIs
      : [],
  }));
}

export async function getCodeAsAdmin(
  slug: string,
  code: string,
): Promise<CodeRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<CodeRecord>('codes')
      .getFirstListItem(`specialtySlug = "${slug}" && code = "${code}"`);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null;
    throw e;
  }
}

// --- Writes (admin-scoped: workflow + seed) --------------------------------

export type WriteCodeMappingArgs = {
  slug: string;
  code: string;
  isInAMBOSS?: boolean;
  coverageLevel?: string;
  depthOfCoverage?: number;
  notes?: string;
  gaps?: string;
  improvements?: string;
  articlesWhereCoverageIs?: CoveredSection[];
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
  // --- Guideline coverage track (source includes 'guidelines') -------------
  isInGuidelines?: boolean;
  guidelineCoverageLevel?: string;
  guidelineDepthOfCoverage?: number;
  guidelineNotes?: string;
  guidelineGaps?: string;
  guidelinesWhereCoverageIs?: GuidelineCoverage[];
  // --- Overall coverage track + provenance ---------------------------------
  overallCoverageLevel?: string;
  overallDepthOfCoverage?: number;
  mappingSourceUsed?: string;
  // --- Question mapping track (curriculum-mapping) -------------------------
  /** Matched AMBOSS Qbank questions; `questionCount` is derived by
   *  `buildMappingCounts` on write. */
  questionsWhereCoverageIs?: QuestionRef[];
  /** Stamp the suggestion-processed marker (combined full-mode write). Left
   *  unset by coverage-only writes so the backfill stage can find the code. */
  suggestionsGeneratedAt?: number;
};

export async function writeCodeMappingAsAdmin(args: WriteCodeMappingArgs): Promise<void> {
  const { slug, code, ...mapping } = args;
  const pb = await createAdminClient();
  const row = await pb
    .collection<CodeRecord>('codes')
    .getFirstListItem(`specialtySlug = "${slug}" && code = "${code}"`);
  const mappedAt = Date.now();
  await pb.collection('codes').update(row.id, {
    ...mapping,
    ...buildMappingCounts(mapping),
    mappedAt,
    // A (re)mapping rewrites this code's consolidation input — stale its bucket.
    consolidationInputChangedAt: mappedAt,
  });

  // Drop in-flight markers for this code.
  const flights = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}" && code = "${code}"` });
  await Promise.all(flights.map((f) => pb.collection('mappingsInFlight').delete(f.id)));
}

export type WriteCodeSuggestionsArgs = {
  slug: string;
  code: string;
  improvements?: string;
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
};

/**
 * Partial write for the "Generate suggestions" backfill stage: writes ONLY
 * the suggestion fields (+ their derived counts) and stamps
 * `suggestionsGeneratedAt` + `consolidationInputChangedAt`. Coverage fields,
 * coverage counts, and `mappedAt` are preserved — this never recomputes or
 * touches the previously-performed coverage mapping.
 */
export async function writeCodeSuggestionsAsAdmin(
  args: WriteCodeSuggestionsArgs,
): Promise<void> {
  const { slug, code, ...suggestions } = args;
  const pb = await createAdminClient();
  const row = await pb
    .collection<CodeRecord>('codes')
    .getFirstListItem(`specialtySlug = "${slug}" && code = "${code}"`);
  // Recompute suggestion counts; keep the stored coverage counts by passing
  // them through as fallbacks (no coverage arrays supplied here).
  const counts = deriveCodeTableCounts({
    existingArticleUpdates: suggestions.existingArticleUpdates,
    newArticlesNeeded: suggestions.newArticlesNeeded,
    coverageArticleCount: row.coverageArticleCount,
    coverageSectionCount: row.coverageSectionCount,
  });
  const now = Date.now();
  await pb.collection('codes').update(row.id, {
    improvements: suggestions.improvements ?? null,
    existingArticleUpdates: suggestions.existingArticleUpdates ?? [],
    newArticlesNeeded: suggestions.newArticlesNeeded ?? [],
    existingArticleUpdateCount: counts.existingArticleUpdateCount,
    newArticleSuggestionCount: counts.newArticleSuggestionCount,
    suggestionsGeneratedAt: now,
    // Suggestions are consolidation input — stale the bucket so a later
    // consolidation run picks them up.
    consolidationInputChangedAt: now,
  });

  // Drop in-flight markers for this code.
  const flights = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}" && code = "${code}"` });
  await Promise.all(flights.map((f) => pb.collection('mappingsInFlight').delete(f.id)));
}

export async function clearAllMappingsForSpecialtyAsAdmin(slug: string): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const now = Date.now();
  for (const r of rows) {
    if (!r.mappedAt) continue;
    await pb.collection('codes').update(r.id, {
      mappedAt: 0,
      isInAMBOSS: null,
      coverageLevel: null,
      depthOfCoverage: null,
      notes: null,
      gaps: null,
      improvements: null,
      articlesWhereCoverageIs: null,
      existingArticleUpdates: null,
      newArticlesNeeded: null,
      coverageArticleCount: 0,
      coverageSectionCount: 0,
      existingArticleUpdateCount: 0,
      newArticleSuggestionCount: 0,
      suggestionsGeneratedAt: 0,
      // Guideline + overall coverage tracks.
      isInGuidelines: null,
      guidelineCoverageLevel: null,
      guidelineDepthOfCoverage: null,
      guidelineNotes: null,
      guidelineGaps: null,
      guidelinesWhereCoverageIs: null,
      guidelineCount: 0,
      guidelineRecommendationCount: 0,
      overallCoverageLevel: null,
      overallDepthOfCoverage: null,
      mappingSourceUsed: null,
      // Question mapping track (curriculum-mapping).
      questionsWhereCoverageIs: null,
      questionCount: 0,
      // Unmapping removes the code from consolidation input — stale its bucket.
      consolidationInputChangedAt: now,
    });
  }
  const flights = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(flights.map((f) => pb.collection('mappingsInFlight').delete(f.id)));
}

/**
 * Clear ONLY the generated suggestion fields (+ counts + the
 * `suggestionsGeneratedAt` marker) for every mapped code in a specialty,
 * reverting them to "needs suggestions". Coverage and `mappedAt` are
 * preserved. Backs the `map_suggestions` stage reset.
 */
export async function clearSuggestionsForSpecialtyAsAdmin(slug: string): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}" && mappedAt > 0` });
  const now = Date.now();
  for (const r of rows) {
    const hasSuggestions =
      (Array.isArray(r.existingArticleUpdates) && r.existingArticleUpdates.length > 0) ||
      (Array.isArray(r.newArticlesNeeded) && r.newArticlesNeeded.length > 0) ||
      !!r.improvements ||
      !!r.suggestionsGeneratedAt;
    if (!hasSuggestions) continue;
    await pb.collection('codes').update(r.id, {
      improvements: null,
      existingArticleUpdates: [],
      newArticlesNeeded: [],
      existingArticleUpdateCount: 0,
      newArticleSuggestionCount: 0,
      suggestionsGeneratedAt: 0,
      consolidationInputChangedAt: now,
    });
  }
}

export async function clearMappingAsAdmin(slug: string, code: string): Promise<void> {
  const pb = await createAdminClient();
  let row: CodeRecord;
  try {
    row = await pb
      .collection<CodeRecord>('codes')
      .getFirstListItem(`specialtySlug = "${slug}" && code = "${code}"`);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
  await pb.collection('codes').update(row.id, {
    mappedAt: 0,
    isInAMBOSS: null,
    coverageLevel: null,
    depthOfCoverage: null,
    notes: null,
    gaps: null,
    improvements: null,
    articlesWhereCoverageIs: null,
    existingArticleUpdates: null,
    newArticlesNeeded: null,
    coverageArticleCount: 0,
    coverageSectionCount: 0,
    existingArticleUpdateCount: 0,
    newArticleSuggestionCount: 0,
    suggestionsGeneratedAt: 0,
    // Guideline + overall coverage tracks.
    isInGuidelines: null,
    guidelineCoverageLevel: null,
    guidelineDepthOfCoverage: null,
    guidelineNotes: null,
    guidelineGaps: null,
    guidelinesWhereCoverageIs: null,
    guidelineCount: 0,
    guidelineRecommendationCount: 0,
    overallCoverageLevel: null,
    overallDepthOfCoverage: null,
    mappingSourceUsed: null,
    // Question mapping track (curriculum-mapping).
    questionsWhereCoverageIs: null,
    questionCount: 0,
    // Unmapping removes the code from consolidation input — stale its bucket.
    consolidationInputChangedAt: Date.now(),
  });
}

export async function bulkInsertCodesAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    // `mappedAt` is the unmapped sentinel — left at 0 here so newly inserted
    // codes don't trip the "mapping has run" predicate. `isInAMBOSS` is a PB
    // bool (NOT NULL, default false) and cannot represent "unset", so we read
    // it conditionally on `mappedAt > 0` everywhere.
    await pb.collection('codes').create({
      specialtySlug: slug,
      coverageArticleCount: 0,
      coverageSectionCount: 0,
      existingArticleUpdateCount: 0,
      newArticleSuggestionCount: 0,
      ...r,
    });
  }
}

/**
 * Merge/upsert mapping rows from an uploaded file (PR 3 — file import).
 *
 * Matches are keyed on the composite `specialtySlug + code`. For an existing
 * code we overwrite ONLY the metadata columns the file carries
 * (`source`, `description`, `category`, `consolidationCategory`) and only when
 * the file's cell is non-blank — mapping results (`mappedAt`, coverage,
 * suggestion arrays, derived counts) are never touched, so a re-import of the
 * source ontology preserves any mapping work already done. New codes are
 * inserted via `bulkInsertCodesAsAdmin` defaults (unmapped). In-file duplicate
 * codes are last-one-wins (the caller surfaces them in the preview).
 */
export async function upsertCodesAsAdmin(
  slug: string,
  rows: ParsedCodeRow[],
): Promise<{ created: number; updated: number }> {
  const pb = await createAdminClient();
  const existing = await pb.collection<CodeRecord>('codes').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    fields: 'id,code,consolidationCategory,description',
  });
  const byCode = new Map(existing.map((r) => [r.code, r]));

  // Last-one-wins for duplicate codes within the file.
  const deduped = new Map<string, ParsedCodeRow>();
  for (const row of rows) deduped.set(row.code, row);

  let created = 0;
  let updated = 0;
  for (const row of deduped.values()) {
    const metadata: Record<string, string> = {};
    if (row.source !== undefined) metadata.source = row.source;
    if (row.description !== undefined) metadata.description = row.description;
    if (row.category !== undefined) metadata.category = row.category;
    if (row.consolidationCategory !== undefined)
      metadata.consolidationCategory = row.consolidationCategory;

    const prev = byCode.get(row.code);
    if (prev) {
      // Stamp staleness when the import rewrites a consolidation-input column
      // (consolidationCategory or description); touch the old bucket when the
      // bucket assignment itself changes.
      const movedBucket =
        metadata.consolidationCategory !== undefined &&
        valuesDiffer(metadata.consolidationCategory, prev.consolidationCategory);
      const changedConsolidationInput =
        movedBucket ||
        (metadata.description !== undefined &&
          valuesDiffer(metadata.description, prev.description));
      if (Object.keys(metadata).length > 0) {
        const patch: Record<string, unknown> = { ...metadata };
        if (changedConsolidationInput) patch.consolidationInputChangedAt = Date.now();
        await pb.collection('codes').update(prev.id, patch);
        if (movedBucket) {
          await touchBucketInputChangedAsAdmin(slug, prev.consolidationCategory);
        }
      }
      updated++;
    } else {
      await pb.collection('codes').create({
        specialtySlug: slug,
        coverageArticleCount: 0,
        coverageSectionCount: 0,
        existingArticleUpdateCount: 0,
        newArticleSuggestionCount: 0,
        code: row.code,
        ...metadata,
      });
      created++;
    }
  }
  return { created, updated };
}

export async function deleteCodesForSpecialtyAsAdmin(slug: string): Promise<void> {
  const pb = await createAdminClient();
  const codes = await pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(codes.map((c) => pb.collection('codes').delete(c.id)));
  const flights = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(flights.map((f) => pb.collection('mappingsInFlight').delete(f.id)));
}

export async function markCodesInFlightAsAdmin(
  slug: string,
  codes: string[],
  runId: string,
): Promise<void> {
  const pb = await createAdminClient();
  const startedAt = Date.now();
  for (const code of codes) {
    await pb.collection('mappingsInFlight').create({
      specialtySlug: slug,
      code,
      runId,
      startedAt,
    });
  }
}

export async function clearInFlightForRunAsAdmin(runId: string): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `runId = "${runId}"` });
  await Promise.all(rows.map((r) => pb.collection('mappingsInFlight').delete(r.id)));
}

/**
 * Clear every in-flight marker for a specialty, regardless of run. Backs the
 * universal "Cancel mapping" button: deleting the markers makes the sheet's
 * "Mapping…" pulses disappear at once instead of waiting for the cancelled
 * workflow to reach its next status poll and clear them itself.
 */
export async function clearInFlightForSpecialtyAsAdmin(slug: string): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('mappingsInFlight').delete(r.id)));
}
