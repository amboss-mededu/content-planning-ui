/**
 * Articles-secondary consolidation step.
 *
 * Reads every per-category row in `newArticleSuggestions` (output of
 * primary) and dedupes them across the specialty by title, producing
 * `consolidatedArticles` rows that the review page consumes.
 *
 * The category primary stage now performs the LLM consolidation. This
 * secondary stage promotes scoped staging rows to final rows, preserving
 * LLM-authored metadata while deduping exact same-title rows.
 */

import {
  bulkInsertConsolidatedArticlesAsAdmin,
  deleteConsolidatedArticlesForCategoriesAsAdmin,
  deleteConsolidatedArticlesForSpecialtyAsAdmin,
  listNewArticleSuggestionsAsAdmin,
} from '@/lib/data/articles';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleSuggestionRecord, CodeRecord } from '@/lib/pb/types';
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
  /** When true, this workflow does NOT update `pipelineRuns.status` —
   *  the caller (typically the chained API route) owns the final
   *  success/failure flip. See ConsolidatePrimaryInput for the
   *  rationale. */
  skipRunStatusUpdate?: boolean;
};

function extractCodeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) =>
      typeof c === 'string'
        ? c
        : c && typeof c === 'object' && 'code' in c
          ? String((c as { code?: unknown }).code ?? '')
          : null,
    )
    .filter((c): c is string => c !== null && c.length > 0);
}

function extractCodeEntries(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map((c) => {
      const code =
        typeof c === 'string'
          ? c
          : c && typeof c === 'object' && 'code' in c
            ? String((c as { code?: unknown }).code ?? '')
            : '';
      if (!code || seen.has(code)) return null;
      seen.add(code);
      return c;
    })
    .filter((c): c is unknown => c !== null);
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

async function codeCategoryLookup(slug: string): Promise<Map<string, string>> {
  const pb = await createAdminClient();
  const rows = await pb.collection<CodeRecord>('codes').getFullList({
    filter: pb.filter('specialtySlug = {:slug}', { slug }),
  });
  const out = new Map<string, string>();
  for (const row of rows) {
    const category = row.consolidationCategory?.trim();
    if (category) out.set(row.code, category);
  }
  return out;
}

function categoriesForCodes(
  rawCodes: unknown,
  codeToCategory: Map<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const code of extractCodeList(rawCodes)) {
    const category = codeToCategory.get(code);
    if (category) out.add(category);
  }
  return out;
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

    const [allStaging, codeToCategory] = await Promise.all([
      listNewArticleSuggestionsAsAdmin(input.specialtySlug),
      codeCategoryLookup(input.specialtySlug),
    ]);
    const categorySet =
      input.categories && input.categories.length > 0
        ? new Set(input.categories.map((category) => category.trim()))
        : null;
    const staging = categorySet
      ? allStaging.filter((r) => {
          const cat = (r as unknown as { category?: string }).category;
          if (cat !== undefined && categorySet.has(cat.trim())) return true;
          const rowCategories = categoriesForCodes(r.codes, codeToCategory);
          return Array.from(rowCategories).some((category) => categorySet.has(category));
        })
      : allStaging;

    // Wipe-and-replace belongs to the secondary stage even when the new
    // primary output is empty. Otherwise a zero-output rerun would leave
    // stale final rows visible and make the bucket look consolidated.
    if (categorySet) {
      await deleteConsolidatedArticlesForCategoriesAsAdmin(
        input.specialtySlug,
        Array.from(categorySet),
      );
    } else {
      await deleteConsolidatedArticlesForSpecialtyAsAdmin(input.specialtySlug);
    }

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
      if (!input.skipRunStatusUpdate) {
        await updatePipelineRunStatus(input.runId, 'completed');
      }
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
        articleType?: string;
        articleId?: string;
        specialtyName?: string;
        categories: Set<string>;
        codes: Map<string, unknown>;
        previousArticleTitleSuggestions: Set<string>;
        coverages: number[];
        importances: number[];
        justifications: string[];
      }
    >();
    for (const row of staging as ArticleSuggestionRecord[]) {
      const title = (row.articleTitle ?? '').trim();
      if (!title) continue;
      const key = title.toLowerCase();
      const existing = groups.get(key);
      const codes = extractCodeEntries(row.codes);
      const importance =
        typeof row.overallImportance === 'number' ? row.overallImportance : null;
      const coverage =
        typeof row.overallCoverage === 'number' ? row.overallCoverage : null;
      const previousTitles = Array.isArray(row.previousArticleTitleSuggestions)
        ? row.previousArticleTitleSuggestions.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const addCodes = (target: Map<string, unknown>) => {
        for (const c of codes) {
          const code = typeof c === 'string' ? c : (c as { code?: string }).code;
          if (code) target.set(code, c);
        }
      };
      if (existing) {
        addCodes(existing.codes);
        for (const c of categoriesForCodes(row.codes, codeToCategory)) {
          existing.categories.add(c);
        }
        if (importance !== null) existing.importances.push(importance);
        if (coverage !== null) existing.coverages.push(coverage);
        if (row.justification) existing.justifications.push(row.justification);
        for (const previousTitle of previousTitles) {
          existing.previousArticleTitleSuggestions.add(previousTitle);
        }
      } else {
        const codeMap = new Map<string, unknown>();
        addCodes(codeMap);
        groups.set(key, {
          articleTitle: title,
          articleType: row.articleType,
          articleId: row.articleId,
          specialtyName: row.specialtyName,
          categories: new Set(),
          codes: codeMap,
          previousArticleTitleSuggestions: new Set(previousTitles),
          coverages: coverage !== null ? [coverage] : [],
          importances: importance !== null ? [importance] : [],
          justifications: row.justification ? [row.justification] : [],
        });
      }
      // Preserve category from the suggestion record on first insert.
      const g = groups.get(key);
      const rec = row as unknown as Record<string, unknown>;
      const recordCategory = typeof rec.category === 'string' ? rec.category : null;
      if (g && recordCategory) g.categories.add(recordCategory);
      if (g) {
        for (const c of categoriesForCodes(row.codes, codeToCategory)) {
          g.categories.add(c);
        }
      }
    }

    const finalRows = Array.from(groups.values()).map((g) => {
      const categories = Array.from(g.categories);
      return {
        articleTitle: g.articleTitle,
        articleType: g.articleType,
        articleId: g.articleId,
        specialtyName: g.specialtyName,
        // When the same title appears in multiple categories the rail can
        // surface it under any of them; pick the first deterministically.
        category: categories[0] ?? undefined,
        numCodes: g.codes.size,
        codes: Array.from(g.codes.values()),
        previousArticleTitleSuggestions: Array.from(g.previousArticleTitleSuggestions),
        overallCoverage: avg(g.coverages),
        overallImportance: avg(g.importances),
        justification: g.justifications.join('\n\n') || undefined,
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
      llmStub: false,
    });
    if (!input.skipRunStatusUpdate) {
      await updatePipelineRunStatus(input.runId, 'completed');
    }
    await revalidateSpecialtyCache(input.specialtySlug);
    return { merged: finalRows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] consolidateArticlesSecondaryWorkflow failed', msg);
    await markStageFailed(input.runId, 'consolidate_articles', msg);
    if (!input.skipRunStatusUpdate) {
      await updatePipelineRunStatus(input.runId, 'failed', msg);
    }
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
