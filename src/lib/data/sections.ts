import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { computeSectionKey } from '@/lib/data/article-keys';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type { ConsolidatedSectionRecord, SectionReviewRecord } from '@/lib/pb/types';
import type { ConsolidatedSection } from '@/lib/types';

/**
 * Inject `sectionKey` into a consolidatedSections row before insert.
 * Mirrors `withArticleKey` over in `articles.ts` — see that comment for
 * rationale.
 */
function withSectionKey(
  slug: string,
  r: Record<string, unknown>,
): Record<string, unknown> {
  const articleTitle = typeof r.articleTitle === 'string' ? r.articleTitle : undefined;
  const articleId = typeof r.articleId === 'string' ? r.articleId : undefined;
  const sectionName = typeof r.sectionName === 'string' ? r.sectionName : undefined;
  const sectionId = typeof r.sectionId === 'string' ? r.sectionId : undefined;
  const category = typeof r.category === 'string' ? r.category : undefined;
  const key = computeSectionKey({
    specialtySlug: slug,
    articleTitle,
    articleId,
    sectionName,
    sectionId,
    category,
  });
  return key ? { ...r, sectionKey: key } : r;
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
 * Returns the consolidatedSections row's parent article id (the CMS
 * articleId, not a PB id) if it exists, else null. Used by the section
 * review→backlog promotion path to key the resulting backlog row on the
 * parent article.
 */
export async function getConsolidatedSectionParentArticleId(
  sectionRecordId: string,
): Promise<string | null> {
  const pb = await userClient();
  try {
    const rec = await pb
      .collection<ConsolidatedSectionRecord>('consolidatedSections')
      .getOne(sectionRecordId);
    return rec.articleId ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether any other section under the same parent article currently
 * has an approved review. Used by `resetSectionReview` to decide
 * whether to tear down the update-type backlog row when an approval is
 * cleared.
 */
export async function hasOtherApprovedSectionsForParent(
  slug: string,
  parentArticleId: string,
  excludeSectionId: string,
): Promise<boolean> {
  const pb = await userClient();
  const sections = await pb
    .collection<ConsolidatedSectionRecord>('consolidatedSections')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  const siblingIds = new Set(
    sections
      .filter((s) => s.articleId === parentArticleId && s.id !== excludeSectionId)
      .map((s) => s.id),
  );
  if (siblingIds.size === 0) return false;
  // sectionReviews don't carry articleId, so join via sectionRecordId.
  const reviews = await pb
    .collection<SectionReviewRecord>('sectionReviews')
    .getFullList({ filter: `specialtySlug = "${slug}" && status = "approved"` });
  for (const r of reviews) {
    if (siblingIds.has(r.sectionRecordId)) {
      return true;
    }
  }
  return false;
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

/**
 * Delete consolidated-section rows whose category is in `categories`.
 * Mirrors deleteConsolidatedArticlesForCategoriesAsAdmin — fetches by
 * `specialtySlug` and filters categories client-side to avoid PB's
 * filter-parser 400 on category strings with `;`/`:`/`,`.
 */
export async function deleteConsolidatedSectionsForCategoriesAsAdmin(
  slug: string,
  categories: string[],
): Promise<number> {
  if (categories.length === 0) return 0;
  const pb = await createAdminClient();
  const set = new Set(categories.map((category) => category.trim()));
  const filter = pb.filter('specialtySlug = {:slug}', { slug });
  const rows = await pb
    .collection<ConsolidatedSectionRecord>('consolidatedSections')
    .getFullList({ filter });
  const toDelete = rows.filter(
    (r) => r.category !== undefined && set.has(r.category.trim()),
  );
  await Promise.all(
    toDelete.map((r) => pb.collection('consolidatedSections').delete(r.id)),
  );
  return toDelete.length;
}

export async function bulkInsertConsolidatedSectionsAsAdmin(
  slug: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const pb = await createAdminClient();
  for (const r of rows) {
    await pb
      .collection('consolidatedSections')
      .create({ specialtySlug: slug, ...withSectionKey(slug, r) });
  }
}
