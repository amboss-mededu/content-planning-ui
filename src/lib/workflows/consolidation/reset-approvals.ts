import 'server-only';

import {
  deleteArticleBacklogForSpecialtyAsAdmin,
  listArticleBacklog,
} from '@/lib/data/article-backlog';
import { deleteArticleReviewsForSpecialtyAsAdmin } from '@/lib/data/article-reviews';
import { deleteArticleSourcesByArticleKeyAsAdmin } from '@/lib/data/article-sources';
import { deleteWritingRunsForArticleAsAdmin } from '@/lib/data/article-writing';
import {
  deleteArticleUpdateSuggestionsForSpecialtyAsAdmin,
  deleteNewArticleSuggestionsForSpecialtyAsAdmin,
} from '@/lib/data/articles';
import { deleteConsolidationCategoryReviewsForSpecialtyAsAdmin } from '@/lib/data/consolidation-category-reviews';
import { deleteSectionReviewsForSpecialtyAsAdmin } from '@/lib/data/section-reviews';

/**
 * Specialty-level "reset approvals" — wipes downstream state so the
 * specialty is back to the pre-approval baseline:
 *  - `articleReviews`, `sectionReviews`
 *  - `articleBacklog` (and its assigned articles' `articleSources` +
 *    `articleWritingRuns` / drafts)
 *  - `consolidationCategoryReviews` (historical rows only — UI stopped
 *    writing in pt 2)
 *  - `newArticleSuggestions`, `articleUpdateSuggestions` (the 2nd
 *    consolidation — defensive wipe, may already be empty)
 *
 * Explicitly does NOT touch:
 *  - `codes` (mapping output)
 *  - `consolidatedArticles`, `consolidatedSections` (1st consolidation
 *    candidates that the editor reviews)
 *
 * Returns counts for observability.
 */
export async function resetApprovalsForSpecialty(slug: string): Promise<{
  backlogRows: number;
  sourcesDeleted: number;
  writingRunsDeleted: number;
  draftsDeleted: number;
}> {
  // Backlog rows reference articles by stable key + PB id; both are needed
  // to chase down sources and writing artifacts before we drop the rows
  // themselves.
  const backlog = await listArticleBacklog(slug);
  const backlogRows = Object.values(backlog);

  let sourcesDeleted = 0;
  let writingRunsDeleted = 0;
  let draftsDeleted = 0;
  for (const row of backlogRows) {
    if (row.articleKey) {
      sourcesDeleted += await deleteArticleSourcesByArticleKeyAsAdmin(
        slug,
        row.articleKey,
      );
    }
    if (row.articleRecordId) {
      const { runs, drafts } = await deleteWritingRunsForArticleAsAdmin(
        slug,
        row.articleRecordId,
      );
      writingRunsDeleted += runs;
      draftsDeleted += drafts;
    }
  }

  await Promise.all([
    deleteArticleReviewsForSpecialtyAsAdmin(slug),
    deleteSectionReviewsForSpecialtyAsAdmin(slug),
    deleteArticleBacklogForSpecialtyAsAdmin(slug),
    deleteConsolidationCategoryReviewsForSpecialtyAsAdmin(slug),
    deleteNewArticleSuggestionsForSpecialtyAsAdmin(slug),
    deleteArticleUpdateSuggestionsForSpecialtyAsAdmin(slug),
  ]);

  return {
    backlogRows: backlogRows.length,
    sourcesDeleted,
    writingRunsDeleted,
    draftsDeleted,
  };
}
