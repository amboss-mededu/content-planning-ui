/**
 * Lookups for the AMBOSS article/section catalog (PocketBase-backed).
 *
 * The mapping workflow validates every cited ID against these sets.
 * Refreshed via scripts/refresh-amboss-library.ts (ports to PB in PR 8).
 */

import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { AmbossArticleRecord, AmbossSectionRecord } from '@/lib/pb/types';

export type AmbossLibraryStats = {
  articles: number;
  sections: number;
  lastSyncedAt: Date | null;
};

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export async function listAmbossArticleIds(): Promise<Set<string>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<AmbossArticleRecord>('ambossArticles')
    .getFullList({ fields: 'articleId' });
  return new Set(rows.map((r) => r.articleId));
}

export async function listAmbossArticleTitlesAsAdmin(): Promise<string[]> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<AmbossArticleRecord>('ambossArticles')
    .getFullList({ fields: 'title' });
  return Array.from(new Set(rows.map((r) => r.title).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export async function listAmbossSectionIds(): Promise<Set<string>> {
  await connection();
  const pb = await userClient();
  const rows = await pb
    .collection<AmbossSectionRecord>('ambossSections')
    .getFullList({ fields: 'sectionId' });
  return new Set(rows.map((r) => r.sectionId));
}

export async function getAmbossLibraryStats(): Promise<AmbossLibraryStats> {
  await connection();
  const pb = await userClient();
  const [articlesList, sectionsList] = await Promise.all([
    pb
      .collection<AmbossArticleRecord>('ambossArticles')
      .getList(1, 1, { sort: '-updatedAt', fields: 'updatedAt' }),
    pb
      .collection<AmbossSectionRecord>('ambossSections')
      .getList(1, 1, { sort: '-updatedAt', fields: 'updatedAt' }),
  ]);
  const articleMax = articlesList.items[0]?.updatedAt ?? 0;
  const sectionMax = sectionsList.items[0]?.updatedAt ?? 0;
  const lastSyncedAt = Math.max(articleMax, sectionMax);

  return {
    articles: articlesList.totalItems,
    sections: sectionsList.totalItems,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
  };
}
