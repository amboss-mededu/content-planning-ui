/**
 * Articles-secondary consolidation step (scaffold, no LLM yet).
 *
 * Reads every per-category row in `newArticleSuggestions` (output of
 * primary) and dedupes them across the specialty by title, producing
 * `consolidatedArticles` rows that the review page consumes.
 *
 * Real implementation: an LLM pass that merges semantically-equivalent
 * titles, picks a canonical title, and writes one row per merged group.
 * Stub: case-folded exact-title dedupe + union of contributing codes +
 * average importance.
 */

import {
  bulkInsertConsolidatedArticlesAsAdmin,
  deleteConsolidatedArticlesForCategoriesAsAdmin,
  deleteConsolidatedArticlesForSpecialtyAsAdmin,
  listNewArticleSuggestionsAsAdmin,
} from '@/lib/data/articles';
import type { ArticleSuggestionRecord } from '@/lib/pb/types';
import {
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
} from '../lib/db-writes';
import { logEvent } from '../lib/events';
import { revalidateSpecialtyCache } from '../lib/revalidate';

export type ConsolidateArticlesSecondaryInput = {
  runId: string;
  specialtySlug: string;
  /** When set, secondary only re-aggregates these categories' staging
   *  rows and only replaces consolidated rows whose category is in this
   *  set. Other categories' consolidated rows stay intact. Null/undefined
   *  preserves the existing specialty-wide wipe-and-replace, used by
   *  the run-all path. */
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

export type ConsolidateArticlesSecondaryStats = {
  merged: number;
};

export async function consolidateArticlesSecondaryWorkflow(
  input: ConsolidateArticlesSecondaryInput,
): Promise<ConsolidateArticlesSecondaryStats> {
  console.log('[pipeline] consolidateArticlesSecondaryWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
  });

  try {
    await markStageRunning(input.runId, 'consolidate_articles');

    const allStaging = await listNewArticleSuggestionsAsAdmin(input.specialtySlug);
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
        stage: 'consolidate_articles',
        level: 'info',
        message:
          'No new-article staging rows for this specialty. Run primary consolidation first.',
      });
      await markStageCompleted(input.runId, 'consolidate_articles', undefined, {
        merged: 0,
        llmStub: true,
      });
      await updatePipelineRunStatus(input.runId, 'completed');
      await revalidateSpecialtyCache(input.specialtySlug);
      return { merged: 0 };
    }

    // Dedupe across categories. Group key is the lowercased title; we
    // remember the first-seen category so the merged row still carries
    // one (the review page groups by category).
    const groups = new Map<
      string,
      {
        articleTitle: string;
        categories: Set<string>;
        codes: Set<string>;
        importances: number[];
      }
    >();
    for (const row of staging as ArticleSuggestionRecord[]) {
      const title = (row.articleTitle ?? '').trim();
      if (!title) continue;
      const key = title.toLowerCase();
      const existing = groups.get(key);
      const codes = extractCodeList(row.codes);
      const importance =
        typeof row.overallImportance === 'number' ? row.overallImportance : null;
      if (existing) {
        if (row.specialtyName) existing.categories.add(row.specialtyName);
        for (const c of codes) existing.codes.add(c);
        if (importance !== null) existing.importances.push(importance);
      } else {
        groups.set(key, {
          articleTitle: title,
          categories: new Set(),
          codes: new Set(codes),
          importances: importance !== null ? [importance] : [],
        });
      }
      // Preserve category from the suggestion record on first insert.
      const g = groups.get(key);
      const rec = row as unknown as Record<string, unknown>;
      const recordCategory = typeof rec.category === 'string' ? rec.category : null;
      if (g && recordCategory) g.categories.add(recordCategory);
    }

    // Wipe-and-replace: secondary owns the final table, so a re-run
    // replaces every row. When the call is scoped to specific categories
    // (per-category re-run), restrict the wipe to those buckets only —
    // otherwise a single-category re-run takes the entire specialty's
    // consolidated output down with it.
    if (categorySet) {
      await deleteConsolidatedArticlesForCategoriesAsAdmin(
        input.specialtySlug,
        Array.from(categorySet),
      );
    } else {
      await deleteConsolidatedArticlesForSpecialtyAsAdmin(input.specialtySlug);
    }

    const finalRows = Array.from(groups.values()).map((g) => {
      const categories = Array.from(g.categories);
      return {
        articleTitle: g.articleTitle,
        // When the same title appears in multiple categories the rail can
        // surface it under any of them; pick the first deterministically.
        category: categories[0] ?? undefined,
        numCodes: g.codes.size,
        codes: Array.from(g.codes),
        overallImportance: avg(g.importances),
        justification:
          'Generated by passthrough title-dedupe across primary staging rows — real LLM merge not yet wired (see consolidation/prompts.ts).',
      };
    });

    if (finalRows.length > 0) {
      await bulkInsertConsolidatedArticlesAsAdmin(input.specialtySlug, finalRows);
    }

    await logEvent({
      runId: input.runId,
      stage: 'consolidate_articles',
      level: 'info',
      message: `Merged ${staging.length} primary candidates → ${finalRows.length} consolidated articles.`,
    });

    await markStageCompleted(input.runId, 'consolidate_articles', undefined, {
      stagingCandidates: staging.length,
      merged: finalRows.length,
      llmStub: true,
    });
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
    return { merged: finalRows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] consolidateArticlesSecondaryWorkflow failed', msg);
    await markStageFailed(input.runId, 'consolidate_articles', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
