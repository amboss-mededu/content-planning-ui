import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type { OntologyCodeRecord } from '@/lib/pb/types';
import type { OntologySource } from '@/lib/types';

const COLLECTION_BY_SOURCE: Record<OntologySource, string> = {
  ICD10: 'icd10Codes',
  HCUP: 'hcupCodes',
  ABIM: 'abimCodes',
  Orpha: 'orphaCodes',
};

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function listSourceOntology(slug: string, source: OntologySource) {
  await connection();
  const pb = await userClient();
  const collection = COLLECTION_BY_SOURCE[source];
  const rows = await pb
    .collection<OntologyCodeRecord>(collection)
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  return { source, rows } as const;
}
