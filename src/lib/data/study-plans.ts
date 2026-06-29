/**
 * Reader/writer for the `studyPlans` collection — saved selections of
 * curriculum categories composed from a curriculum plan's Overview page.
 * Scoped to a curriculum plan via `specialtySlug` (same link `codes` use).
 *
 * Mutations are driven by the server actions in
 * `src/app/planning/curriculum-plans/[plan]/actions.ts`.
 */

import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type { CodeRecord, StudyPlanRecord } from '@/lib/pb/types';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

export type StudyPlanCategoryOption = { value: string; label: string };

/** All study plans for a curriculum plan, newest first. */
export async function listStudyPlans(slug: string): Promise<StudyPlanRecord[]> {
  await connection();
  const pb = await userClient();
  return pb.collection<StudyPlanRecord>('studyPlans').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    sort: '-created',
  });
}

/**
 * Distinct curriculum `category` strings for a plan, as Combobox options.
 * Lean read of just the `category` field (mirrors `listCodeStrings`) — the
 * category modal only needs the names, not whole code rows.
 */
export async function listStudyPlanCategoryOptions(
  slug: string,
): Promise<StudyPlanCategoryOption[]> {
  await connection();
  const pb = await userClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
    fields: 'category',
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const cat = r.category?.trim();
    if (cat) seen.add(cat);
  }
  return Array.from(seen)
    .sort((a, b) => a.localeCompare(b))
    .map((category) => ({ value: category, label: category }));
}

export async function createStudyPlan(input: {
  slug: string;
  name: string;
  categories: string[];
  createdBy?: string;
}): Promise<StudyPlanRecord> {
  const pb = await userClient();
  return pb.collection<StudyPlanRecord>('studyPlans').create({
    specialtySlug: input.slug,
    name: input.name,
    selectedCategories: input.categories,
    createdBy: input.createdBy ?? '',
  });
}

export async function deleteStudyPlan(id: string): Promise<void> {
  const pb = await userClient();
  await pb.collection('studyPlans').delete(id);
}
