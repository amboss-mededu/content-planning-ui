import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  CodeRecord,
  CoveredSection,
  MappingInFlightRecord,
  NewArticle,
  SectionUpdate,
} from '@/lib/pb/types';

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

export async function listUnmappedCodeCount(slug: string): Promise<number> {
  await connection();
  const pb = await userClient();
  // PB does not let us filter on undefined in JSON-style; we rely on the
  // workflow path that always sets isInAMBOSS to true/false on mapping
  // completion. Filter for "no isInAMBOSS field" via empty match.
  const list = await pb.collection<CodeRecord>('codes').getList(1, 1, {
    filter: `specialtySlug = "${slug}" && isInAMBOSS = null`,
    skipTotal: false,
  });
  return list.totalItems;
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
    filter: `specialtySlug = "${slug}" && isInAMBOSS = null`,
    sort: 'code',
  });
  return rows.map((r) => ({
    code: r.code,
    description: r.description ?? null,
    category: r.category ?? null,
  }));
}

export type CodeCategorySummary = {
  category: string;
  total: number;
  unmapped: number;
};

export async function listCodeCategories(slug: string): Promise<CodeCategorySummary[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const totals = new Map<string, { total: number; unmapped: number }>();
  for (const r of rows) {
    const cat = r.category ?? '(uncategorized)';
    const entry = totals.get(cat) ?? { total: 0, unmapped: 0 };
    entry.total += 1;
    if (r.isInAMBOSS === undefined || r.isInAMBOSS === null) entry.unmapped += 1;
    totals.set(cat, entry);
  }
  return Array.from(totals.entries())
    .map(([category, t]) => ({ category, total: t.total, unmapped: t.unmapped }))
    .sort((a, b) => a.category.localeCompare(b.category));
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
  const rows = await pb
    .collection<CodeRecord>('codes')
    .getFullList({ filter: `specialtySlug = "${slug}" && isInAMBOSS = null` });
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
  await pb.collection('codes').update(row.id, mapping);

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
    if (
      (r.isInAMBOSS === undefined || r.isInAMBOSS === null) &&
      (r.coverageLevel === undefined || r.coverageLevel === null)
    )
      continue;
    await pb.collection('codes').update(r.id, {
      isInAMBOSS: null,
      coverageLevel: null,
      depthOfCoverage: null,
      notes: null,
      gaps: null,
      improvements: null,
      articlesWhereCoverageIs: null,
      existingArticleUpdates: null,
      newArticlesNeeded: null,
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
    isInAMBOSS: null,
    coverageLevel: null,
    depthOfCoverage: null,
    notes: null,
    gaps: null,
    improvements: null,
    articlesWhereCoverageIs: null,
    existingArticleUpdates: null,
    newArticlesNeeded: null,
  });
}

export async function bulkInsertCodesAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb.collection('codes').create({ specialtySlug: slug, ...r });
  }
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
