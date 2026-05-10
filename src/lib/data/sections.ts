import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ConsolidatedSectionRecord } from '@/lib/pb/types';
import type { ConsolidatedSection } from '@/lib/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function listConsolidatedSections(
  slug: string,
): Promise<ConsolidatedSection[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<ConsolidatedSectionRecord>('consolidatedSections')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  // Keep `id` (PB record id) — the review pass keys reviews on it.
  return rows.map((row) => {
    const {
      created: _created,
      updated: _updated,
      collectionId: _ci,
      collectionName: _cn,
      specialtySlug: _slug,
      ...rest
    } = row;
    return rest as ConsolidatedSection;
  });
}

export async function deleteConsolidatedSectionsForSpecialtyAsAdmin(
  slug: string,
): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection('consolidatedSections')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(rows.map((r) => pb.collection('consolidatedSections').delete(r.id)));
}

export async function bulkInsertConsolidatedSectionsAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb.collection('consolidatedSections').create({ specialtySlug: slug, ...r });
  }
}
