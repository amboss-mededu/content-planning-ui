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

import { deleteArticleBacklogForSpecialtyAsAdmin } from '@/lib/data/article-backlog';
import { deleteArticleLitSearchRunsForSpecialtyAsAdmin } from '@/lib/data/article-lit-search-runs';
import { deleteArticleReviewsForSpecialtyAsAdmin } from '@/lib/data/article-reviews';
import { deleteArticleSourcesForSpecialtyAsAdmin } from '@/lib/data/article-sources';
import { deleteWritingRunsForSpecialtyAsAdmin } from '@/lib/data/article-writing';
import {
  deleteArticleUpdateSuggestionsForSpecialtyAsAdmin,
  deleteConsolidatedArticlesForSpecialtyAsAdmin,
  deleteNewArticleSuggestionsForSpecialtyAsAdmin,
} from '@/lib/data/articles';
import { deleteCategoriesForSpecialtyAsAdmin } from '@/lib/data/categories';
import {
  clearAllMappingsForSpecialtyAsAdmin,
  deleteCodesForSpecialtyAsAdmin,
} from '@/lib/data/codes';
import { deleteConsolidationCategoryReviewsForSpecialtyAsAdmin } from '@/lib/data/consolidation-category-reviews';
import {
  cancelStaleRunsForSpecialty,
  resetStage as resetStagePb,
} from '@/lib/data/pipeline';
import { deleteSectionReviewsForSpecialtyAsAdmin } from '@/lib/data/section-reviews';
import { deleteConsolidatedSectionsForSpecialtyAsAdmin } from '@/lib/data/sections';
import {
  setPipelineStageStateAsAdmin,
  updateMilestonesAsAdmin,
} from '@/lib/data/specialties';
import type { StageName } from './db-writes';

const DOWNSTREAM: Record<StageName, StageName[]> = {
  extract_codes: [
    'map_codes',
    'consolidate_primary',
    'consolidate_articles',
    'consolidate_sections',
    'literature_search',
  ],
  extract_milestones: [],
  map_codes: [
    'consolidate_primary',
    'consolidate_articles',
    'consolidate_sections',
    'literature_search',
  ],
  consolidate_primary: [
    'consolidate_articles',
    'consolidate_sections',
    'literature_search',
  ],
  consolidate_articles: ['consolidate_sections', 'literature_search'],
  consolidate_sections: [],
  // Literature search has no downstream stages today — backlog updates
  // beyond `sources-searched` are manual.
  literature_search: [],
};

export function stagesToReset(stage: StageName): StageName[] {
  return [stage, ...DOWNSTREAM[stage]];
}

async function clearEditorDataForStage(stage: StageName, specialtySlug: string) {
  switch (stage) {
    case 'extract_codes':
      // Codes + the category sheet derived from them (`codeCategories`).
      await deleteCodesForSpecialtyAsAdmin(specialtySlug);
      await deleteCategoriesForSpecialtyAsAdmin(specialtySlug);
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
      // Suggestions + everything editorial that derives from them: the
      // article/section approvals, the consolidation-category review flags,
      // and the backlog rows those approvals created.
      await deleteNewArticleSuggestionsForSpecialtyAsAdmin(specialtySlug);
      await deleteArticleUpdateSuggestionsForSpecialtyAsAdmin(specialtySlug);
      await deleteArticleReviewsForSpecialtyAsAdmin(specialtySlug);
      await deleteSectionReviewsForSpecialtyAsAdmin(specialtySlug);
      await deleteConsolidationCategoryReviewsForSpecialtyAsAdmin(specialtySlug);
      await deleteArticleBacklogForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'consolidate_articles':
      await deleteConsolidatedArticlesForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'consolidate_sections':
      await deleteConsolidatedSectionsForSpecialtyAsAdmin(specialtySlug);
      break;
    case 'literature_search':
      // Deepest article-pipeline artifacts: gathered sources, lit-search run
      // history, and any drafts written from them.
      await deleteArticleSourcesForSpecialtyAsAdmin(specialtySlug);
      await deleteArticleLitSearchRunsForSpecialtyAsAdmin(specialtySlug);
      await deleteWritingRunsForSpecialtyAsAdmin(specialtySlug);
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
  // Cancel non-terminal runs *first* so any fire-and-forget workflow sees
  // `cancelled` on its next status poll and stops writing mappedAt over
  // rows we're about to clear.
  await cancelStaleRunsForSpecialty(input.specialtySlug);
  for (const s of toReset) {
    await clearEditorDataForStage(s, input.specialtySlug);
    await resetStagePb({ runId: input.runId, stage: s });
    // Clear the editor-controlled card state so a stage that had been flipped
    // to `complete` (manually, or auto on run-finish) returns to `not_started`
    // and the badge reflects the reset.
    await setPipelineStageStateAsAdmin(input.specialtySlug, s, 'not_started');
  }
  // Belt-and-suspenders: for map_codes, a code that finished its agent call
  // before cancellation propagated could still have stamped mappedAt
  // between cancelStaleRuns and the per-code status re-check. Sweep once
  // more — clearAllMappingsForSpecialtyAsAdmin is idempotent on already-
  // unmapped rows.
  if (toReset.includes('map_codes')) {
    await clearAllMappingsForSpecialtyAsAdmin(input.specialtySlug);
  }
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
