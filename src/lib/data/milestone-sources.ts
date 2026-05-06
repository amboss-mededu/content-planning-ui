/**
 * Reader for the `milestone_sources` registry, PocketBase-backed.
 * Parallels code-sources.ts.
 */

import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type { SourceRecord } from '@/lib/pb/types';

export type MilestoneSourceRow = { slug: string; name: string; createdAt: number };

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function listMilestoneSources(): Promise<MilestoneSourceRow[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<SourceRecord>('milestoneSources')
    .getFullList({ sort: 'name' });
  return rows.map((r) => ({ slug: r.slug, name: r.name, createdAt: r.createdAt }));
}

export async function createMilestoneSource(slug: string, name: string): Promise<string> {
  const pb = await userClient();
  try {
    const existing = await pb
      .collection<SourceRecord>('milestoneSources')
      .getFirstListItem(`slug = "${slug}"`);
    return existing.id;
  } catch (e) {
    if (!(e instanceof ClientResponseError) || e.status !== 404) throw e;
  }
  const created = await pb
    .collection('milestoneSources')
    .create({ slug, name, createdAt: Date.now() });
  return created.id;
}

export async function removeMilestoneSource(slug: string): Promise<void> {
  const pb = await userClient();
  try {
    const existing = await pb
      .collection<SourceRecord>('milestoneSources')
      .getFirstListItem(`slug = "${slug}"`);
    await pb.collection('milestoneSources').delete(existing.id);
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return;
    throw e;
  }
}
