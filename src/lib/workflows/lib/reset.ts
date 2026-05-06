/**
 * Stage-reset helpers. Resetting a stage clears its output artifacts AND
 * cascades through every downstream stage. Used by /api/workflows/reset-stage
 * and /api/workflows/cancel.
 *
 * These run in the Next.js request context (API route handlers), so the
 * cookie-authed PocketBase helpers are used. Editor-data deletes
 * (codes / sections / articles / milestones) go through the existing
 * admin-side helpers since the relevant collections currently use the same
 * permission rules either way.
 */

import {
  deleteArticleUpdateSuggestionsForSpecialtyAsAdmin,
  deleteConsolidatedArticlesForSpecialtyAsAdmin,
  deleteNewArticleSuggestionsForSpecialtyAsAdmin,
} from '@/lib/data/articles';
import {
  clearAllMappingsForSpecialtyAsAdmin,
  deleteCodesForSpecialtyAsAdmin,
} from '@/lib/data/codes';
import {
  cancelStaleRunsForSpecialty,
  resetStage as resetStagePb,
} from '@/lib/data/pipeline';
import { deleteConsolidatedSectionsForSpecialtyAsAdmin } from '@/lib/data/sections';
import { updateMilestonesAsAdmin } from '@/lib/data/specialties';
import type { StageName } from './db-writes';

const DOWNSTREAM: Record<StageName, StageName[]> = {
  extract_codes: [
    'map_codes',
    'consolidate_primary',
    'consolidate_articles',
    'consolidate_sections',
  ],
  extract_milestones: [],
  map_codes: ['consolidate_primary', 'consolidate_articles', 'consolidate_sections'],
  consolidate_primary: ['consolidate_articles', 'consolidate_sections'],
  consolidate_articles: ['consolidate_sections'],
  consolidate_sections: [],
};

export function stagesToReset(stage: StageName): StageName[] {
  return [stage, ...DOWNSTREAM[stage]];
}

async function clearEditorDataForStage(stage: StageName, specialtySlug: string) {
  switch (stage) {
    case 'extract_codes':
      await deleteCodesForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'extract_milestones':
      await updateMilestonesAsAdmin({
        slug: specialtySlug,
        milestones: undefined,
      });
      break;
    case 'map_codes':
      await clearAllMappingsForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'consolidate_primary':
      await deleteNewArticleSuggestionsForSpecialtyAsAdmin(specialtySlug);
      await deleteArticleUpdateSuggestionsForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'consolidate_articles':
      await deleteConsolidatedArticlesForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'consolidate_sections':
      await deleteConsolidatedSectionsForSpecialtyAsAdmin(specialtySlug);
      break;
  }
}

/**
 * Reset the given stage and every downstream stage for the run. Also marks
 * every non-terminal pipeline run for the specialty as `cancelled` so the UI
 * stops treating any stale run as active.
 */
export async function resetStageCascade(input: {
  runId: string;
  specialtySlug: string;
  stage: StageName;
}): Promise<StageName[]> {
  const toReset = stagesToReset(input.stage);
  for (const s of toReset) {
    await clearEditorDataForStage(s, input.specialtySlug);
    await resetStagePb({ runId: input.runId, stage: s });
  }
  await cancelStaleRunsForSpecialty(input.specialtySlug);
  return toReset;
}

/**
 * Cancel every non-terminal pipeline run for a specialty without touching
 * stage data, mappings, or extracted codes. Use this when the dashboard is
 * stuck in "Run in progress" because of a zombie run but the user wants to
 * keep the data they have. Returns the count of runs cancelled.
 */
export async function clearStaleRunsForSpecialty(specialtySlug: string): Promise<number> {
  const result = await cancelStaleRunsForSpecialty(specialtySlug);
  return result.cancelled;
}
