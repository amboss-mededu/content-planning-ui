'use server';

import { getCurrentUser } from '@/lib/auth';
import {
  listCodes,
  setCurriculumReviewAsAdmin,
  setCurriculumReviewForCodesAsAdmin,
} from '@/lib/data/codes';

/**
 * Server actions backing the curriculum **Category Manager** modal
 * (`curriculum-category-manager-modal.tsx`). Approval writes go through here
 * (no model needed); map/remap stays a client `fetch` to
 * `/api/workflows/map-codes` because model selection lives in browser storage.
 */

const UNCATEGORIZED = 'Uncategorized';

export type ReviewStatus = '' | 'approved' | 'rejected';

export interface CategoryManagerCode {
  code: string;
  description: string;
  /** `mappedAt > 0` — the mapping workflow has written a verdict. */
  mapped: boolean;
  isInAMBOSS: boolean | null;
  reviewStatus: ReviewStatus;
}

export interface CategoryManagerGroup {
  /** Display label; `'Uncategorized'` for codes with no category. */
  category: string;
  isUncategorized: boolean;
  total: number;
  mapped: number;
  approved: number;
  pending: number;
  rejected: number;
  /** approved AND not yet mapped — the count "Map approved (N)" can run. */
  mappableNow: number;
  codes: CategoryManagerCode[];
}

export interface CategoryManagerData {
  groups: CategoryManagerGroup[];
}

function summarize(category: string, codes: CategoryManagerCode[]): CategoryManagerGroup {
  let mapped = 0;
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let mappableNow = 0;
  for (const c of codes) {
    if (c.mapped) mapped += 1;
    if (c.reviewStatus === 'approved') {
      approved += 1;
      if (!c.mapped) mappableNow += 1;
    } else if (c.reviewStatus === 'rejected') {
      rejected += 1;
    } else {
      pending += 1;
    }
  }
  return {
    category,
    isUncategorized: category === UNCATEGORIZED,
    total: codes.length,
    mapped,
    approved,
    pending,
    rejected,
    mappableNow,
    codes,
  };
}

/**
 * All of a curriculum plan's codes grouped by category (uncategorised last),
 * with per-category mapping/approval counts. Uncached server read, so it's
 * always fresh after an approve/map round-trip.
 */
export async function loadCurriculumCategoryManager(
  slug: string,
): Promise<CategoryManagerData> {
  const codes = await listCodes(slug);
  const groups = new Map<string, CategoryManagerCode[]>();
  for (const c of codes) {
    const cat = c.category?.trim() || UNCATEGORIZED;
    const entry: CategoryManagerCode = {
      code: c.code,
      description: c.description ?? '',
      mapped: (c.mappedAt ?? 0) > 0,
      isInAMBOSS: typeof c.isInAMBOSS === 'boolean' ? c.isInAMBOSS : null,
      reviewStatus: (c.curriculumReviewStatus ?? '') as ReviewStatus,
    };
    const bucket = groups.get(cat);
    if (bucket) bucket.push(entry);
    else groups.set(cat, [entry]);
  }
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });
  return { groups: sorted.map(([category, list]) => summarize(category, list)) };
}

/** Approve / reject / reset a single code's curriculum review status. */
export async function decideCode(
  slug: string,
  code: string,
  status: ReviewStatus,
): Promise<{ error?: string }> {
  try {
    const user = await getCurrentUser();
    await setCurriculumReviewAsAdmin(slug, code, status, user?.email ?? '');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update approval.' };
  }
}

/** Apply one decision to every listed code (category-level Approve/Reject all). */
export async function approveCodes(
  slug: string,
  codes: string[],
  status: ReviewStatus,
): Promise<{ updated?: number; error?: string }> {
  if (codes.length === 0) return { updated: 0 };
  try {
    const user = await getCurrentUser();
    const updated = await setCurriculumReviewForCodesAsAdmin(
      slug,
      codes,
      status,
      user?.email ?? '',
    );
    return { updated };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update approvals.' };
  }
}
