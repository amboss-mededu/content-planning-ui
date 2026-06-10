/**
 * Sections-secondary consolidation step.
 *
 * Reads every per-category row in `articleUpdateSuggestions` (output of
 * primary) and dedupes them across the specialty into the final
 * `consolidatedSections` collection that the review page consumes.
 *
 * The category primary stage performs the LLM consolidation. This stage
 * promotes scoped section-update staging rows to final rows and preserves
 * the LLM-authored section names, update flags, previous-title lineage,
 * and justifications.
 */

import { listArticleUpdateSuggestionsAsAdmin } from '@/lib/data/articles';
import {
  bulkInsertConsolidatedSectionsAsAdmin,
  deleteConsolidatedSectionsForCategoriesAsAdmin,
  deleteConsolidatedSectionsForSpecialtyAsAdmin,
} from '@/lib/data/sections';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
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

export type ConsolidateSectionsSecondaryInput = {
  runId: string;
  specialtySlug: string;
  /** When set, secondary only re-aggregates these categories' staging
   *  rows and only replaces consolidated rows whose category is in this
   *  set. See ConsolidateArticlesSecondaryInput for the rationale. */
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

export type ConsolidateSectionsSecondaryStats = {
  merged: number;
};

export async function consolidateSectionsSecondaryWorkflow(
  input: ConsolidateSectionsSecondaryInput,
): Promise<ConsolidateSectionsSecondaryStats> {
  log('pipeline').info('consolidateSectionsSecondaryWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
  });

  try {
    await markStageRunning(input.runId, 'consolidate_sections');

    const [allStaging, codeToCategory] = await Promise.all([
      listArticleUpdateSuggestionsAsAdmin(input.specialtySlug),
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
    // primary output is empty. Otherwise stale final rows survive a rerun
    // that legitimately produces `merged: 0`.
    if (categorySet) {
      await deleteConsolidatedSectionsForCategoriesAsAdmin(
        input.specialtySlug,
        Array.from(categorySet),
      );
    } else {
      await deleteConsolidatedSectionsForSpecialtyAsAdmin(input.specialtySlug);
    }

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
      if (!input.skipRunStatusUpdate) {
        await updatePipelineRunStatus(input.runId, 'completed');
      }
      await revalidateSpecialtyCache(input.specialtySlug);
      return { merged: 0 };
    }

    type Bucket = {
      articleTitle?: string;
      articleId?: string;
      sectionName?: string;
      sectionId?: string;
      exists?: boolean;
      articleType?: string;
      specialtyName?: string;
      category?: string;
      codes: Map<string, unknown>;
      previousSectionNames: Set<string>;
      coverages: number[];
      importances: number[];
      justifications: string[];
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
      const codeCategories = categoriesForCodes(record.codes, codeToCategory);
      const coverage =
        typeof record.overallCoverage === 'number' ? record.overallCoverage : null;
      const importance =
        typeof record.overallImportance === 'number' ? record.overallImportance : null;
      const codes = extractCodeEntries(record.codes);
      const previousSectionNames = Array.isArray(record.previousSectionNames)
        ? record.previousSectionNames.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const addCodes = (target: Map<string, unknown>) => {
        for (const c of codes) {
          const code = typeof c === 'string' ? c : (c as { code?: string }).code;
          if (code) target.set(code, c);
        }
      };

      const articleKey = articleId || articleTitle?.toLowerCase() || '';
      const sectionKey = sectionId || sectionName?.toLowerCase() || '__article__';
      const key = `${articleKey}::${sectionKey}`;

      const existing = groups.get(key);
      if (existing) {
        addCodes(existing.codes);
        if (coverage !== null) existing.coverages.push(coverage);
        if (importance !== null) existing.importances.push(importance);
        if (typeof record.justification === 'string') {
          existing.justifications.push(record.justification);
        }
        for (const previous of previousSectionNames) {
          existing.previousSectionNames.add(previous);
        }
        if (!existing.category && category) existing.category = category;
        if (!existing.category) existing.category = Array.from(codeCategories)[0];
      } else {
        const codeMap = new Map<string, unknown>();
        addCodes(codeMap);
        groups.set(key, {
          articleTitle,
          articleId,
          sectionName,
          sectionId,
          exists,
          articleType:
            typeof record.articleType === 'string' ? record.articleType : undefined,
          specialtyName:
            typeof record.specialtyName === 'string' ? record.specialtyName : undefined,
          category: category ?? Array.from(codeCategories)[0],
          codes: codeMap,
          previousSectionNames: new Set(previousSectionNames),
          coverages: coverage !== null ? [coverage] : [],
          importances: importance !== null ? [importance] : [],
          justifications:
            typeof record.justification === 'string' ? [record.justification] : [],
        });
      }
    }

    const finalRows = Array.from(groups.values()).map((g) => ({
      articleTitle: g.articleTitle,
      articleType: g.articleType,
      articleId: g.articleId,
      sectionName: g.sectionName,
      sectionId: g.sectionId,
      exists: g.exists,
      newSection: g.exists === false || undefined,
      sectionUpdate: g.exists === true || undefined,
      specialtyName: g.specialtyName,
      category: g.category,
      numCodes: g.codes.size,
      codes: Array.from(g.codes.values()),
      previousSectionNames: Array.from(g.previousSectionNames),
      overallCoverage: avg(g.coverages),
      overallImportance: avg(g.importances),
      justification: g.justifications.join('\n\n') || undefined,
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
      llmStub: false,
    });
    if (!input.skipRunStatusUpdate) {
      await updatePipelineRunStatus(input.runId, 'completed');
    }
    await revalidateSpecialtyCache(input.specialtySlug);
    return { merged: finalRows.length };
  } catch (e) {
    const msg = errorMessage(e);
    log('pipeline').error('consolidateSectionsSecondaryWorkflow failed', msg);
    await markStageFailed(input.runId, 'consolidate_sections', msg);
    if (!input.skipRunStatusUpdate) {
      await updatePipelineRunStatus(input.runId, 'failed', msg);
    }
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
