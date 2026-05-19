/**
 * Sections-secondary consolidation step (scaffold, no LLM yet).
 *
 * Reads every per-category row in `articleUpdateSuggestions` (output of
 * primary) and dedupes them across the specialty into the final
 * `consolidatedSections` collection that the review page consumes.
 *
 * Stub dedupe key: `(articleId || articleTitle) + (sectionId ||
 * sectionName)`. When the real LLM prompt lands it will collapse
 * semantically-equivalent sections within the same article and pick a
 * canonical name; the runner shape stays the same.
 */

import { listArticleUpdateSuggestionsAsAdmin } from '@/lib/data/articles';
import {
  bulkInsertConsolidatedSectionsAsAdmin,
  deleteConsolidatedSectionsForCategoriesAsAdmin,
  deleteConsolidatedSectionsForSpecialtyAsAdmin,
} from '@/lib/data/sections';
import type { ArticleSuggestionRecord } from '@/lib/pb/types';
import {
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
} from '../lib/db-writes';
import { logEvent } from '../lib/events';
import { revalidateSpecialtyCache } from '../lib/revalidate';

export type ConsolidateSectionsSecondaryInput = {
  runId: string;
  specialtySlug: string;
  /** When set, secondary only re-aggregates these categories' staging
   *  rows and only replaces consolidated rows whose category is in this
   *  set. See ConsolidateArticlesSecondaryInput for the rationale. */
  categories?: string[] | null;
};

function extractCodeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c : null))
    .filter((c): c is string => c !== null);
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export type ConsolidateSectionsSecondaryStats = {
  merged: number;
};

export async function consolidateSectionsSecondaryWorkflow(
  input: ConsolidateSectionsSecondaryInput,
): Promise<ConsolidateSectionsSecondaryStats> {
  console.log('[pipeline] consolidateSectionsSecondaryWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
  });

  try {
    await markStageRunning(input.runId, 'consolidate_sections');

    const allStaging = await listArticleUpdateSuggestionsAsAdmin(input.specialtySlug);
    const categorySet =
      input.categories && input.categories.length > 0 ? new Set(input.categories) : null;
    const staging = categorySet
      ? allStaging.filter((r) => {
          const cat = (r as unknown as { category?: string }).category;
          return cat !== undefined && categorySet.has(cat);
        })
      : allStaging;

    if (staging.length === 0) {
      await logEvent({
        runId: input.runId,
        stage: 'consolidate_sections',
        level: 'info',
        message:
          'No section-update staging rows for this specialty. Run primary consolidation first.',
      });
      await markStageCompleted(input.runId, 'consolidate_sections', undefined, {
        merged: 0,
        llmStub: true,
      });
      await updatePipelineRunStatus(input.runId, 'completed');
      await revalidateSpecialtyCache(input.specialtySlug);
      return { merged: 0 };
    }

    type Bucket = {
      articleTitle?: string;
      articleId?: string;
      sectionName?: string;
      sectionId?: string;
      exists?: boolean;
      category?: string;
      codes: Set<string>;
      importances: number[];
    };
    const groups = new Map<string, Bucket>();

    for (const row of staging as ArticleSuggestionRecord[]) {
      const record = row as unknown as Record<string, unknown>;
      const articleTitle =
        typeof record.articleTitle === 'string' ? record.articleTitle.trim() : undefined;
      const articleId =
        typeof record.articleId === 'string' ? record.articleId : undefined;
      const sectionName =
        typeof record.sectionName === 'string' ? record.sectionName.trim() : undefined;
      const sectionId =
        typeof record.sectionId === 'string' ? record.sectionId : undefined;
      const exists =
        typeof record.exists === 'boolean'
          ? record.exists
          : record.sectionUpdate === true
            ? true
            : record.newSection === true
              ? false
              : undefined;
      const category = typeof record.category === 'string' ? record.category : undefined;
      const importance =
        typeof record.overallImportance === 'number' ? record.overallImportance : null;
      const codes = extractCodeList(record.codes);

      const articleKey = articleId || articleTitle?.toLowerCase() || '';
      const sectionKey = sectionId || sectionName?.toLowerCase() || '__article__';
      const key = `${articleKey}::${sectionKey}`;

      const existing = groups.get(key);
      if (existing) {
        for (const c of codes) existing.codes.add(c);
        if (importance !== null) existing.importances.push(importance);
        if (!existing.category && category) existing.category = category;
      } else {
        groups.set(key, {
          articleTitle,
          articleId,
          sectionName,
          sectionId,
          exists,
          category,
          codes: new Set(codes),
          importances: importance !== null ? [importance] : [],
        });
      }
    }

    // Per-category re-run: scope the wipe to the same buckets the
    // staging filter selected, so other categories' consolidated rows
    // survive a single-category re-run.
    if (categorySet) {
      await deleteConsolidatedSectionsForCategoriesAsAdmin(
        input.specialtySlug,
        Array.from(categorySet),
      );
    } else {
      await deleteConsolidatedSectionsForSpecialtyAsAdmin(input.specialtySlug);
    }

    const finalRows = Array.from(groups.values()).map((g) => ({
      articleTitle: g.articleTitle,
      articleId: g.articleId,
      sectionName: g.sectionName,
      sectionId: g.sectionId,
      exists: g.exists,
      newSection: g.exists === false || undefined,
      sectionUpdate: g.exists === true || undefined,
      category: g.category,
      numCodes: g.codes.size,
      codes: Array.from(g.codes),
      overallImportance: avg(g.importances),
      justification:
        'Generated by passthrough article/section-key dedupe — real LLM merge not yet wired (see consolidation/prompts.ts).',
    }));

    if (finalRows.length > 0) {
      await bulkInsertConsolidatedSectionsAsAdmin(input.specialtySlug, finalRows);
    }

    await logEvent({
      runId: input.runId,
      stage: 'consolidate_sections',
      level: 'info',
      message: `Merged ${staging.length} primary section-update candidates → ${finalRows.length} consolidated sections.`,
    });

    await markStageCompleted(input.runId, 'consolidate_sections', undefined, {
      stagingCandidates: staging.length,
      merged: finalRows.length,
      llmStub: true,
    });
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
    return { merged: finalRows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] consolidateSectionsSecondaryWorkflow failed', msg);
    await markStageFailed(input.runId, 'consolidate_sections', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
