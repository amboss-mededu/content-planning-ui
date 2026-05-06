/**
 * Reader for the `code_sources` registry, PocketBase-backed. The
 * start-run form's source dropdown and the stage-card's "Inputs"
 * rendering both derive labels from this list.
 *
 * Mutations live behind /api/sources/code (POST + DELETE).
 */

import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type { SourceRecord } from '@/lib/pb/types';

export type CodeSourceRow = { slug: string; name: string; createdAt: number };

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function listCodeSources(): Promise<CodeSourceRow[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<SourceRecord>('codeSources')
    .getFullList({ sort: 'name' });
  return rows.map((r) => ({ slug: r.slug, name: r.name, createdAt: r.createdAt }));
}

export async function createCodeSource(slug: string, name: string): Promise<string> {
  const pb = await userClient();
  try {
    const existing = await pb
      .collection<SourceRecord>('codeSources')
      .getFirstListItem(`slug = "${slug}"`);
    return existing.id;
  } catch (e) {
    if (!(e instanceof ClientResponseError) || e.status !== 404) throw e;
  }
  const created = await pb
    .collection('codeSources')
    .create({ slug, name, createdAt: Date.now() });
  return created.id;
}

export async function removeCodeSource(slug: string): Promise<void> {
  const pb = await userClient();
  try {
    const existing = await pb
      .collection<SourceRecord>('codeSources')
      .getFirstListItem(`slug = "${slug}"`);
    await pb.collection('codeSources').delete(existing.id);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
}
