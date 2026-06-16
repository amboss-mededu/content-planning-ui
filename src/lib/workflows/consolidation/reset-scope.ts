import 'server-only';

import { deleteWritingRunsForArticleAsAdmin } from '@/lib/data/article-writing';
import { createAdminClient } from '@/lib/pb/server';
import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  ArticleSuggestionRecord,
  CodeCategoryRecord,
  CodeRecord,
  ConsolidatedArticleRecord,
  ConsolidatedSectionRecord,
  ConsolidationCategoryReviewRecord,
  ReviewCommentRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';
import {
  hasDecisionChange,
  resetCodeCategoryDecisionArrays,
} from './reset-scope-helpers';

export type ResetConsolidationScopeStats = {
  targetCategories: string[] | null;
  targetCodes: number;
  stagingRowsDeleted: number;
  consolidatedArticlesDeleted: number;
  consolidatedSectionsDeleted: number;
  sourceCategoryRowsUpdated: number;
  articleReviewsDeleted: number;
  sectionReviewsDeleted: number;
  categoryReviewsDeleted: number;
  backlogRowsDeleted: number;
  articleSourcesDeleted: number;
  writingRunsDeleted: number;
  draftsDeleted: number;
  reviewCommentsDeleted: number;
};

async function deleteRows(
  collection: string,
  rows: Array<{ id: string }>,
): Promise<number> {
  const pb = await createAdminClient();
  await Promise.all(rows.map((row) => pb.collection(collection).delete(row.id)));
  return rows.length;
}

function inScope(
  row: { category?: string | null },
  targetCategorySet: Set<string> | null,
): boolean {
  if (!targetCategorySet) return true;
  return typeof row.category === 'string' && targetCategorySet.has(row.category.trim());
}

/**
 * Clear the producer output for a consolidation scope so a re-run can
 * regenerate it.
 *
 * Two modes:
 *
 * - **preserve (default)** — deletes only the producer rows
 *   (`newArticleSuggestions`, `articleUpdateSuggestions`,
 *   `consolidatedArticles`, `consolidatedSections`) and resets the
 *   `codeCategories` decision arrays. Reviews, backlog, article sources,
 *   review comments, and writing runs/drafts are left untouched: they are
 *   keyed by stable `articleKey`/`sectionKey` and re-attach when the re-run
 *   reproduces the same keys. This is the normal per-bucket re-run.
 *
 * - **dropDownstream: true** — the destructive "Start over": additionally
 *   deletes the reviews/backlog/sources/comments/writing runs/drafts in
 *   scope, while still preserving approved non-target sibling sections (and
 *   their parent article's downstream work) so a single-bucket wipe never
 *   takes out an approved sibling in another bucket.
 */
export async function resetConsolidationScope(input: {
  specialtySlug: string;
  consolidationCategories?: string[] | null;
  dropDownstream?: boolean;
}): Promise<ResetConsolidationScopeStats> {
  const pb = await createAdminClient();
  const dropDownstream = input.dropDownstream === true;
  const targetCategories = input.consolidationCategories?.length
    ? Array.from(
        new Set(input.consolidationCategories.map((category) => category.trim())),
      )
    : null;
  const targetCategorySet = targetCategories ? new Set(targetCategories) : null;
  const filter = pb.filter('specialtySlug = {:slug}', { slug: input.specialtySlug });

  // Producer rows + the codeCategories decision arrays are always reset; a
  // re-run reproduces them. The downstream editorial collections are only
  // read (and deleted) on the destructive path.
  const [
    codes,
    sourceCategories,
    stagingArticles,
    stagingSections,
    consolidatedArticles,
    consolidatedSections,
  ] = await Promise.all([
    pb.collection<CodeRecord>('codes').getFullList({ filter }),
    pb.collection<CodeCategoryRecord>('codeCategories').getFullList({ filter }),
    pb.collection<ArticleSuggestionRecord>('newArticleSuggestions').getFullList({
      filter,
    }),
    pb.collection<ArticleSuggestionRecord>('articleUpdateSuggestions').getFullList({
      filter,
    }),
    pb.collection<ConsolidatedArticleRecord>('consolidatedArticles').getFullList({
      filter,
    }),
    pb.collection<ConsolidatedSectionRecord>('consolidatedSections').getFullList({
      filter,
    }),
  ]);

  const targetCodes = new Set(
    codes
      .filter((code) =>
        targetCategorySet
          ? code.consolidationCategory
            ? targetCategorySet.has(code.consolidationCategory.trim())
            : false
          : true,
      )
      .map((code) => code.code),
  );
  if (!targetCategorySet) {
    for (const row of sourceCategories) {
      for (const value of [
        row.includedArticleCodes,
        row.excludedArticleCodes,
        row.includedSectionCodes,
        row.excludedSectionCodes,
        row.totallyIgnoredCodes,
      ]) {
        if (!Array.isArray(value)) continue;
        for (const code of value) {
          if (typeof code === 'string') targetCodes.add(code);
        }
      }
    }
  }

  const targetArticles = consolidatedArticles.filter((row) =>
    inScope(row, targetCategorySet),
  );
  const targetSections = consolidatedSections.filter((row) =>
    inScope(row, targetCategorySet),
  );

  // Reset the source-category decision arrays (always — they are producer
  // state, not editorial).
  let sourceCategoryRowsUpdated = 0;
  if (targetCodes.size > 0 || !targetCategorySet) {
    for (const row of sourceCategories) {
      const patch = resetCodeCategoryDecisionArrays(row, targetCodes);
      const changed = hasDecisionChange(row, patch);
      const shouldClearFlag =
        (!targetCategorySet || changed) && row.isConsolidated !== false;
      if (!changed && !shouldClearFlag) continue;
      await pb.collection('codeCategories').update(row.id, patch);
      sourceCategoryRowsUpdated += 1;
    }
  }

  // Producer-row deletions (always).
  const stagingArticleRows = stagingArticles.filter((row) =>
    inScope(row, targetCategorySet),
  );
  const stagingSectionRows = stagingSections.filter((row) =>
    inScope(row, targetCategorySet),
  );
  const [
    stagingArticlesDeleted,
    stagingSectionsDeleted,
    consolidatedArticlesDeleted,
    consolidatedSectionsDeleted,
  ] = await Promise.all([
    deleteRows('newArticleSuggestions', stagingArticleRows),
    deleteRows('articleUpdateSuggestions', stagingSectionRows),
    deleteRows('consolidatedArticles', targetArticles),
    deleteRows('consolidatedSections', targetSections),
  ]);

  // Downstream editorial deletions — destructive path only.
  let articleReviewsDeleted = 0;
  let sectionReviewsDeleted = 0;
  let categoryReviewsDeleted = 0;
  let backlogRowsDeleted = 0;
  let articleSourcesDeleted = 0;
  let writingRunsDeleted = 0;
  let draftsDeleted = 0;
  let reviewCommentsDeleted = 0;

  if (dropDownstream) {
    const [articleReviews, sectionReviews, categoryReviews, backlog, comments] =
      await Promise.all([
        pb.collection<ArticleReviewRecord>('articleReviews').getFullList({ filter }),
        pb.collection<SectionReviewRecord>('sectionReviews').getFullList({ filter }),
        pb
          .collection<ConsolidationCategoryReviewRecord>('consolidationCategoryReviews')
          .getFullList({ filter }),
        pb.collection<ArticleBacklogRecord>('articleBacklog').getFullList({ filter }),
        pb.collection<ReviewCommentRecord>('reviewComments').getFullList({ filter }),
      ]);

    const targetArticleKeys = new Set(
      targetArticles.map((row) => row.articleKey).filter((key): key is string => !!key),
    );
    const targetSectionKeys = new Set(
      targetSections.map((row) => row.sectionKey).filter((key): key is string => !!key),
    );

    // Preserve approved non-target sibling sections (and their parent
    // article's downstream work) so a single-bucket wipe never deletes an
    // approved sibling that lives in another bucket.
    const approvedSectionKeys = new Set(
      sectionReviews
        .filter((row) => row.status === 'approved' && row.sectionKey)
        .map((row) => row.sectionKey),
    );
    const targetParentArticleIds = new Set(
      targetSections
        .map((row) => row.articleId)
        .filter((articleId): articleId is string => !!articleId),
    );
    const resetParentArticleIds = new Set<string>();
    for (const parentArticleId of targetParentArticleIds) {
      const approvedNonTargetSibling = consolidatedSections.some(
        (section) =>
          section.articleId === parentArticleId &&
          !inScope(section, targetCategorySet) &&
          !!section.sectionKey &&
          approvedSectionKeys.has(section.sectionKey),
      );
      if (!approvedNonTargetSibling) resetParentArticleIds.add(parentArticleId);
    }
    const updateArticleKeys = new Set(
      Array.from(resetParentArticleIds).map((articleId) => `upd::${articleId}`),
    );

    const backlogKeysToDelete = new Set([...targetArticleKeys, ...updateArticleKeys]);
    const artifactArticleKeys = new Set(backlogKeysToDelete);
    const articleRecordIdsToClear = new Set<string>();
    for (const row of backlog) {
      if (!backlogKeysToDelete.has(row.articleKey)) continue;
      if (row.articleRecordId) articleRecordIdsToClear.add(row.articleRecordId);
    }
    for (const parentArticleId of resetParentArticleIds) {
      articleRecordIdsToClear.add(parentArticleId);
    }

    const articleReviewRows = articleReviews.filter(
      (row) => row.articleKey && targetArticleKeys.has(row.articleKey),
    );
    const sectionReviewRows = sectionReviews.filter(
      (row) => row.sectionKey && targetSectionKeys.has(row.sectionKey),
    );
    const categoryReviewRows = categoryReviews.filter((row) =>
      inScope(row, targetCategorySet),
    );
    const backlogRows = backlog.filter((row) => backlogKeysToDelete.has(row.articleKey));
    const commentRows = comments.filter((row) => {
      if (row.recordKind === 'article') {
        return (
          artifactArticleKeys.has(row.recordKey) ||
          Array.from(resetParentArticleIds).some(
            (articleId) => row.recordKey === `pa:${articleId}`,
          )
        );
      }
      return row.recordKind === 'section' && targetSectionKeys.has(row.recordKey);
    });

    [
      articleReviewsDeleted,
      sectionReviewsDeleted,
      categoryReviewsDeleted,
      backlogRowsDeleted,
      reviewCommentsDeleted,
    ] = await Promise.all([
      deleteRows('articleReviews', articleReviewRows),
      deleteRows('sectionReviews', sectionReviewRows),
      deleteRows('consolidationCategoryReviews', categoryReviewRows),
      deleteRows('articleBacklog', backlogRows),
      deleteRows('reviewComments', commentRows),
    ]);

    for (const articleKey of artifactArticleKeys) {
      const rows = await pb.collection('articleSources').getFullList({
        filter: pb.filter('specialtySlug = {:slug} && articleKey = {:articleKey}', {
          slug: input.specialtySlug,
          articleKey,
        }),
      });
      articleSourcesDeleted += await deleteRows('articleSources', rows);
    }

    for (const articleRecordId of articleRecordIdsToClear) {
      const deleted = await deleteWritingRunsForArticleAsAdmin(
        input.specialtySlug,
        articleRecordId,
      );
      writingRunsDeleted += deleted.runs;
      draftsDeleted += deleted.drafts;
    }
  }

  return {
    targetCategories,
    targetCodes: targetCodes.size,
    stagingRowsDeleted: stagingArticlesDeleted + stagingSectionsDeleted,
    consolidatedArticlesDeleted,
    consolidatedSectionsDeleted,
    sourceCategoryRowsUpdated,
    articleReviewsDeleted,
    sectionReviewsDeleted,
    categoryReviewsDeleted,
    backlogRowsDeleted,
    articleSourcesDeleted,
    writingRunsDeleted,
    draftsDeleted,
    reviewCommentsDeleted,
  };
}
