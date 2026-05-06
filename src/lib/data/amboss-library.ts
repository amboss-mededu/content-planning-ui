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
import { createServerClient } from '@/lib/pb/server';
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
  const [articles, sections] = await Promise.all([
    pb
      .collection<AmbossArticleRecord>('ambossArticles')
      .getFullList({ fields: 'updatedAt' }),
    pb
      .collection<AmbossSectionRecord>('ambossSections')
      .getFullList({ fields: 'updatedAt' }),
  ]);
  let lastSyncedAt = 0;
  for (const r of articles) if (r.updatedAt > lastSyncedAt) lastSyncedAt = r.updatedAt;
  for (const r of sections) if (r.updatedAt > lastSyncedAt) lastSyncedAt = r.updatedAt;
  return {
    articles: articles.length,
    sections: sections.length,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
  };
}
