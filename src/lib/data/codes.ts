import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
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
  MappingInFlightRecord,
  NewArticle,
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
  | 'coverageLevel'
  | 'depthOfCoverage'
  | 'coverageArticleCount'
  | 'coverageSectionCount'
  | 'existingArticleUpdateCount'
  | 'newArticleSuggestionCount'
>;

type CodeTableRowSource = CodeTableRow &
  Pick<
    CodeRecord,
    'articlesWhereCoverageIs' | 'existingArticleUpdates' | 'newArticlesNeeded'
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
  'coverageLevel',
  'depthOfCoverage',
  'coverageArticleCount',
  'coverageSectionCount',
  'existingArticleUpdateCount',
  'newArticleSuggestionCount',
  'articlesWhereCoverageIs',
  'existingArticleUpdates',
  'newArticlesNeeded',
].join(',');

function buildMappingCounts(mapping: {
  articlesWhereCoverageIs?: CoveredSection[];
  existingArticleUpdates?: SectionUpdate[];
  newArticlesNeeded?: NewArticle[];
}): {
  coverageArticleCount: number;
  coverageSectionCount: number;
  existingArticleUpdateCount: number;
  newArticleSuggestionCount: number;
} {
  return deriveCodeTableCounts(mapping);
}

function toCodeTableRow(row: CodeTableRowSource): CodeTableRow {
  const { articlesWhereCoverageIs, existingArticleUpdates, newArticlesNeeded, ...rest } =
    row;
  return {
    ...rest,
    ...deriveCodeTableCounts({
      articlesWhereCoverageIs,
      existingArticleUpdates,
      newArticlesNeeded,
      coverageArticleCount: row.coverageArticleCount,
      coverageSectionCount: row.coverageSectionCount,
      existingArticleUpdateCount: row.existingArticleUpdateCount,
      newArticleSuggestionCount: row.newArticleSuggestionCount,
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

export async function patchCode(
  slug: string,
  code: string,
  fields: {
    description?: string;
    category?: string;
    consolidationCategory?: string;
  },
): Promise<void> {
  const pb = await userClient();
  const row = await pb
    .collection<CodeRecord>('codes')
    .getFirstListItem(`specialtySlug = "${slug}" && code = "${code}"`);
  await pb.collection('codes').update(row.id, fields);
}

/**
 * Workflow-side lean read of unmapped codes, optionally narrowed by
 * category or by exact code.
 */
export async function listUnmappedCodesAsAdmin(
  slug: string,
  filter?: { categories?: string[]; codes?: string[] } | null,
): Promise<Array<{ code: string; category: string | null; description: string | null }>> {
  const pb = await createAdminClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: `specialtySlug = "${slug}" && (mappedAt = 0 || mappedAt = null)`,
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
    });
  }
  const flights = await pb
    .collection<MappingInFlightRecord>('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(flights.map((f) => pb.collection('mappingsInFlight').delete(f.id)));
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
    fields: 'id,code',
  });
  const idByCode = new Map(existing.map((r) => [r.code, r.id]));

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

    const id = idByCode.get(row.code);
    if (id) {
      if (Object.keys(metadata).length > 0) {
        await pb.collection('codes').update(id, metadata);
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
