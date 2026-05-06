import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { CodeCategoryRecord } from '@/lib/pb/types';
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
