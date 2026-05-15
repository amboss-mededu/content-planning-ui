import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ArticleSuggestionRecord,
  CodeCategoryRecord,
  CodeRecord,
} from '@/lib/pb/types';
import type { CodeCategory } from '@/lib/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

function toCodeCategory(row: CodeCategoryRecord): CodeCategory {
  // Strip PB system fields + specialtySlug join column so the type matches
  // the legacy CodeCategory shape. JSON-typed columns
  // (includedArticleCodes, etc.) come back already-parsed from PB.
  const {
    id: _id,
    created: _created,
    updated: _updated,
    collectionId: _ci,
    collectionName: _cn,
    specialtySlug: _slug,
    includedArticleCodes,
    excludedArticleCodes,
    includedSectionCodes,
    excludedSectionCodes,
    totallyIgnoredCodes,
    ...rest
  } = row;
  return {
    ...rest,
    includedArticleCodes: castStringArray(includedArticleCodes),
    excludedArticleCodes: castStringArray(excludedArticleCodes),
    includedSectionCodes: castStringArray(includedSectionCodes),
    excludedSectionCodes: castStringArray(excludedSectionCodes),
    totallyIgnoredCodes: castStringArray(totallyIgnoredCodes),
  };
}

function castStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

export async function listCategories(slug: string): Promise<CodeCategory[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<CodeCategoryRecord>('codeCategories')
    .getFullList({ filter: `specialtySlug = "${slug}"`, sort: 'codeCategory' });
  return rows.map(toCodeCategory);
}

export async function patchCategoryAsAdmin(
  id: string,
  fields: {
    codeCategory?: string;
    description?: string;
    areAllCodesRun?: boolean;
    isConsolidated?: boolean;
    codesToIgnore?: string;
  },
): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('codeCategories').update(id, fields);
}

export async function bulkInsertCategoriesAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb.collection('codeCategories').create({ specialtySlug: slug, ...r });
  }
}

export async function deleteCategoriesForSpecialtyAsAdmin(slug: string): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeCategoryRecord>('codeCategories')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('codeCategories').delete(r.id)));
}

// --- Orchestration view ----------------------------------------------------

/**
 * Row shape for the consolidation-orchestration table.
 *
 * Rows are unique `consolidationCategory` values present in the extracted
 * codes table — this view answers "for each consolidation bucket the
 * pipeline produced, how many of its codes are properly carried through?"
 * (vs. the source-ontology category, which is the upstream input grouping.)
 *
 * Per-code status (included / excluded / ignored) is derived from the
 * source-ontology `codeCategories` records, since those are the rows that
 * own the includedArticleCodes / excludedArticleCodes / totallyIgnoredCodes
 * arrays. Aggregating those statuses by consolidationCategory is what makes
 * this a useful QC view.
 *
 * # Orphan = codes in the bucket whose code-string is in none of the four
 * arrays of any source codeCategories record — pipeline never saw them.
 */
export type CategoryOrchestration = {
  consolidationCategory: string;
  /** Set when the row represents codes with no consolidationCategory value
   *  (pre-consolidation or never bucketed). Used to disambiguate the
   *  display label from a real bucket coincidentally named "(unbucketed)". */
  isUnbucketed: boolean;
  source?: string;
  numCodes: number;
  numIncludedCodes: number;
  numExcludedCodes: number;
  numTotallyIgnoredCodes: number;
  numOrphanCodes: number;
  /** True iff at least one code in the bucket has a status from a source
   *  `codeCategories` record. False = no category-side data to QC against;
   *  consolidation columns are 0 across the board and the bucket is wholly
   *  orphan from the consolidation-records perspective. */
  hasAnyStatusInfo: boolean;
  /** Codes in this bucket whose `mappedAt > 0` — the mapping pipeline has
   *  reached a yes/no verdict on AMBOSS coverage for them. Drives the
   *  mapping-progress + status columns. */
  numMappedCodes: number;
  /** True when at least one `newArticleSuggestions` row references a code
   *  that belongs to this bucket — the strongest available per-bucket
   *  signal that consolidation has actually produced output here. */
  hasConsolidatedOutput: boolean;
};

const UNBUCKETED_LABEL = '(unbucketed)';

function modal(values: Array<string | undefined | null>): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

type CodeStatus = 'included' | 'excluded' | 'ignored';

export async function listCategoryOrchestration(
  slug: string,
): Promise<CategoryOrchestration[]> {
  await connection();
  const pb = await userClient();

  const [codes, categoryRows, newSuggestions] = await Promise.all([
    pb
      .collection<CodeRecord>('codes')
      .getFullList({ filter: `specialtySlug = "${slug}"` }),
    pb
      .collection<CodeCategoryRecord>('codeCategories')
      .getFullList({ filter: `specialtySlug = "${slug}"` }),
    pb
      .collection<ArticleSuggestionRecord>('newArticleSuggestions')
      .getFullList({ filter: `specialtySlug = "${slug}"` }),
  ]);

  // Set of every code-string that appears in any newArticleSuggestions
  // row's embedded `codes` JSON. Used below to flag each bucket as
  // "has consolidated output" iff at least one of its codes is cited
  // by an output article — the strongest per-bucket signal that
  // consolidation has actually run for this category.
  const codesWithConsolidatedOutput = new Set<string>();
  for (const s of newSuggestions) {
    const arr = s.codes;
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      if (
        c &&
        typeof c === 'object' &&
        typeof (c as { code?: unknown }).code === 'string'
      ) {
        codesWithConsolidatedOutput.add((c as { code: string }).code);
      }
    }
  }

  // Build a per-code status lookup from the source-category records.
  // Priority: included > excluded > ignored. A code that appears in
  // multiple arrays (e.g. both included-article and included-section, or
  // pathologically in conflicting buckets) gets the strongest status only.
  const statusByCode = new Map<string, CodeStatus>();
  for (const rec of categoryRows) {
    for (const c of castStringArray(rec.includedArticleCodes) ?? [])
      statusByCode.set(c, 'included');
    for (const c of castStringArray(rec.includedSectionCodes) ?? [])
      statusByCode.set(c, 'included');
  }
  for (const rec of categoryRows) {
    for (const c of castStringArray(rec.excludedArticleCodes) ?? [])
      if (!statusByCode.has(c)) statusByCode.set(c, 'excluded');
    for (const c of castStringArray(rec.excludedSectionCodes) ?? [])
      if (!statusByCode.has(c)) statusByCode.set(c, 'excluded');
  }
  for (const rec of categoryRows) {
    for (const c of castStringArray(rec.totallyIgnoredCodes) ?? [])
      if (!statusByCode.has(c)) statusByCode.set(c, 'ignored');
  }

  // Group codes by consolidationCategory. Codes with no consolidationCategory
  // share an "(unbucketed)" row. A Set keys by code-string so duplicates in
  // the codes collection don't inflate counts.
  type Bucket = {
    key: string;
    isUnbucketed: boolean;
    codes: Set<string>;
    mappedCodes: Set<string>;
    sources: string[];
  };
  const byBucket = new Map<string, Bucket>();
  for (const r of codes) {
    const raw = r.consolidationCategory;
    const isUnbucketed = !raw;
    const key = raw ?? UNBUCKETED_LABEL;
    const entry = byBucket.get(key) ?? {
      key,
      isUnbucketed,
      codes: new Set<string>(),
      mappedCodes: new Set<string>(),
      sources: [],
    };
    entry.codes.add(r.code);
    if ((r.mappedAt ?? 0) > 0) entry.mappedCodes.add(r.code);
    if (r.source) entry.sources.push(r.source);
    byBucket.set(key, entry);
  }

  const out: CategoryOrchestration[] = [];
  for (const bucket of byBucket.values()) {
    let included = 0;
    let excluded = 0;
    let ignored = 0;
    let orphan = 0;
    let anyStatus = false;
    for (const c of bucket.codes) {
      const s = statusByCode.get(c);
      if (s === 'included') {
        included++;
        anyStatus = true;
      } else if (s === 'excluded') {
        excluded++;
        anyStatus = true;
      } else if (s === 'ignored') {
        ignored++;
        anyStatus = true;
      } else {
        orphan++;
      }
    }

    let hasConsolidatedOutput = false;
    for (const c of bucket.codes) {
      if (codesWithConsolidatedOutput.has(c)) {
        hasConsolidatedOutput = true;
        break;
      }
    }

    out.push({
      consolidationCategory: bucket.key,
      isUnbucketed: bucket.isUnbucketed,
      source: modal(bucket.sources),
      numCodes: bucket.codes.size,
      numIncludedCodes: included,
      numExcludedCodes: excluded,
      numTotallyIgnoredCodes: ignored,
      numOrphanCodes: orphan,
      hasAnyStatusInfo: anyStatus,
      numMappedCodes: bucket.mappedCodes.size,
      hasConsolidatedOutput,
    });
  }

  // Push the "(unbucketed)" row to the bottom; otherwise alphabetical.
  out.sort((a, b) => {
    if (a.isUnbucketed && !b.isUnbucketed) return 1;
    if (!a.isUnbucketed && b.isUnbucketed) return -1;
    return a.consolidationCategory.localeCompare(b.consolidationCategory);
  });
  return out;
}
