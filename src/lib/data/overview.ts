import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type { CodeRecord } from '@/lib/pb/types';

export interface OverviewCounts {
  codes: number;
  mappedCodes: number;
  categories: number;
  consolidatedArticles: number;
  newArticles: number;
  consolidatedSections: number;
}

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

/**
 * Specialty overview counts, pulled from PocketBase. PB doesn't have a
 * cheap `count(*) where ...` for filtered queries — we paginate getList
 * with skipTotal off so the server includes a totalItems count for free.
 *
 * `mappedCodes` is the only stat that needs a row scan (codes whose
 * isInAMBOSS is set, regardless of true/false). For our scale (low
 * thousands of rows per specialty) this stays well under a second.
 */
export async function getOverviewCounts(slug: string): Promise<OverviewCounts> {
  await connection();
  const pb = await userClient();
  const filter = `specialtySlug = "${slug}"`;

  const [codeList, categoriesPage, consolidatedPage, newArticlesPage, sectionsPage] =
    await Promise.all([
      pb.collection<CodeRecord>('codes').getFullList({ filter }),
      pb.collection('codeCategories').getList(1, 1, { filter, skipTotal: false }),
      pb.collection('consolidatedArticles').getList(1, 1, { filter, skipTotal: false }),
      pb.collection('newArticleSuggestions').getList(1, 1, { filter, skipTotal: false }),
      pb.collection('consolidatedSections').getList(1, 1, { filter, skipTotal: false }),
    ]);

  const mappedCodes = codeList.reduce(
    (n, c) => (c.isInAMBOSS === undefined || c.isInAMBOSS === null ? n : n + 1),
    0,
  );

  return {
    codes: codeList.length,
    mappedCodes,
    categories: categoriesPage.totalItems,
    consolidatedArticles: consolidatedPage.totalItems,
    newArticles: newArticlesPage.totalItems,
    consolidatedSections: sectionsPage.totalItems,
  };
}
