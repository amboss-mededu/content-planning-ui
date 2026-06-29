'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import {
  createStudyPlan,
  deleteStudyPlan,
  listStudyPlanCategoryOptions,
  type StudyPlanCategoryOption,
} from '@/lib/data/study-plans';

const PLAN_PATH = '/planning/curriculum-plans';

/** Category options for the "Create study plan" modal (loaded on open). */
export async function loadStudyPlanCategoriesAction(
  slug: string,
): Promise<StudyPlanCategoryOption[]> {
  return listStudyPlanCategoryOptions(slug);
}

export async function createStudyPlanAction(
  slug: string,
  name: string,
  categories: string[],
): Promise<{ id?: string; error?: string }> {
  const trimmedName = name.trim();
  const cats = (categories ?? []).map((c) => c.trim()).filter(Boolean);
  if (!trimmedName) return { error: 'Study plan name is required.' };
  if (cats.length === 0) return { error: 'Select at least one category.' };
  const user = await getCurrentUser();
  try {
    const created = await createStudyPlan({
      slug,
      name: trimmedName,
      categories: cats,
      createdBy: user?.email ?? '',
    });
    revalidatePath(`${PLAN_PATH}/${slug}`, 'layout');
    return { id: created.id };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Failed to create study plan.',
    };
  }
}

export async function deleteStudyPlanAction(
  slug: string,
  id: string,
): Promise<{ error?: string }> {
  try {
    await deleteStudyPlan(id);
    revalidatePath(`${PLAN_PATH}/${slug}`, 'layout');
    return {};
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Failed to delete study plan.',
    };
  }
}
