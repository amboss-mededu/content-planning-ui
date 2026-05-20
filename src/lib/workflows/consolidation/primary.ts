/**
 * Per-category primary consolidation step.
 *
 * Reads each mapped code in the target category, aggregates the
 * `newArticlesNeeded` and `existingArticleUpdates` blobs the mapping step
 * already wrote, and lands them in the per-category staging tables:
 *   - `newArticleSuggestions`        ← new-article candidates
 *   - `articleUpdateSuggestions`     ← section-update candidates
 *
 * Per-category re-run hygiene: before inserting, the runner clears any
 * staging rows tagged with the same category so consecutive clicks of
 * "Start consolidation" don't pile up duplicates.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { listAmbossArticleTitlesAsAdmin } from '@/lib/data/amboss-library';
import {
  bulkInsertArticleUpdateSuggestionsAsAdmin,
  bulkInsertNewArticleSuggestionsAsAdmin,
} from '@/lib/data/articles';
import { listMappedCodesWithSuggestionsAsAdmin } from '@/lib/data/codes';
import { getSpecialtyRecordAsAdmin } from '@/lib/data/specialties';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleSuggestionRecord, CodeCategoryRecord } from '@/lib/pb/types';
import {
  getPipelineRunStatus,
  markStageCompleted,
  markStageFailed,
  markStageRunning,
  updatePipelineRunStatus,
} from '../lib/db-writes';
import { logEvent } from '../lib/events';
import type { ModelSpec, ProviderApiKeys } from '../lib/llm';
import { resolveModel } from '../lib/llm';
import { estimateCostUsd } from '../lib/pricing';
import { revalidateSpecialtyCache } from '../lib/revalidate';
import {
  aggregateNewArticles,
  aggregateSectionUpdates,
  type MappedCodeWithSuggestions,
} from './aggregate';
import { groupByConsolidationCategory } from './buckets';
import { buildCategoryConsolidationPrompt, CONSOLIDATION_SYSTEM_PROMPT } from './prompts';

export type ConsolidatePrimaryInput = {
  runId: string;
  specialtySlug: string;
  /** Optional bucket filter. Null/undefined → every bucket that has
   *  at least one mapped code. */
  consolidationCategories?: string[] | null;
  /** Optional source-category compatibility filter. Rows matching either
   *  the bucket filter or this source-category filter are read, then still
   *  grouped/written by consolidationCategory. */
  sourceCategories?: string[] | null;
  model?: ModelSpec;
  apiKeys?: ProviderApiKeys;
};

export type ConsolidatePrimaryStats = {
  /** Consolidation buckets actually visited (each had at least one mapped code). */
  consolidationCategoriesProcessed: string[];
  /** Rows written to `newArticleSuggestions`. */
  stagingArticles: number;
  /** Rows written to `articleUpdateSuggestions`. */
  stagingSections: number;
};

function shouldAbort(status: string | null): boolean {
  return status === 'cancelled' || status === 'failed' || status === null;
}

const nullableString = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);
const nullableBoolean = z.preprocess((value) => {
  if (value === null || value === '') return undefined;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return value;
}, z.boolean().optional());
const nullableNumber = z.preprocess((value) => {
  if (value === null || value === '') return undefined;
  return value;
}, z.coerce.number().optional());

const ConsolidatedCodeSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedArticleTitle: nullableString,
  previouslySuggestedArticleOrSectionTitle: nullableString,
  coverageScore: nullableNumber,
  importance: nullableNumber,
  index: z.union([z.number(), z.string()]).optional(),
});

const IgnoredArticleSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedArticleTitle: nullableString,
  justification: nullableString,
  index: z.union([z.number(), z.string()]).optional(),
});

const IgnoredSectionSchema = z.object({
  code: z.string(),
  description: nullableString,
  previouslySuggestedSectionTitle: nullableString,
  exists: nullableBoolean,
  articleId: nullableString,
  justification: nullableString,
  index: z.union([z.number(), z.string()]).optional(),
});

const ConsolidationOutputSchema = z.object({
  specialty: nullableString,
  category: z.string(),
  articles: z.array(
    z.object({
      articleTitle: z.string(),
      articleType: nullableString,
      exists: nullableBoolean,
      articleId: nullableString,
      codes: z.array(ConsolidatedCodeSchema),
      previousArticleTitleSuggestions: z.array(z.string()).optional().default([]),
      overallCoverage: nullableNumber,
      overallImportance: nullableNumber,
      justification: nullableString,
    }),
  ),
  includedArticleIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  ignoredArticles: z.array(IgnoredArticleSchema).optional().default([]),
  ignoredArticleIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  sections: z.array(
    z.object({
      articleTitle: z.string(),
      articleId: nullableString,
      articleType: nullableString,
      sectionUpdates: z.array(
        z.object({
          sectionName: z.string(),
          codes: z.array(ConsolidatedCodeSchema),
          previousArticleAndSectionTitleSuggestions: z
            .array(z.string())
            .optional()
            .default([]),
          exists: nullableBoolean,
          sectionId: nullableString,
          overallCoverage: nullableNumber,
          overallImportance: nullableNumber,
          justification: nullableString,
        }),
      ),
    }),
  ),
  includedSectionIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  ignoredSections: z.array(IgnoredSectionSchema).optional().default([]),
  ignoredSectionIndexes: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .default([]),
  totallyIgnoredIndexes: z
    .array(
      z.object({
        code: z.string(),
        index: z.union([z.number(), z.string()]).optional(),
        justification: nullableString,
      }),
    )
    .optional()
    .default([]),
});

type ConsolidationOutput = z.infer<typeof ConsolidationOutputSchema>;

type ConsolidationRows = {
  newArticles: Array<Record<string, unknown>>;
  sectionUpdates: Array<Record<string, unknown>>;
  decisions?: Pick<
    ConsolidationOutput,
    | 'ignoredArticles'
    | 'ignoredSections'
    | 'totallyIgnoredIndexes'
    | 'includedArticleIndexes'
    | 'ignoredArticleIndexes'
    | 'includedSectionIndexes'
    | 'ignoredSectionIndexes'
  >;
};

function codeList(
  codes: Array<z.infer<typeof ConsolidatedCodeSchema>>,
  allowed: Set<string>,
) {
  const seen = new Set<string>();
  return codes.filter((code) => {
    if (!allowed.has(code.code) || seen.has(code.code)) return false;
    seen.add(code.code);
    return true;
  });
}

function ignoredCodes(rows: Array<{ code: string }>, allowed: Set<string>): string[] {
  return Array.from(
    new Set(rows.map((row) => row.code).filter((code) => allowed.has(code))),
  );
}

async function consolidateCategoryWithLlm({
  runId,
  specialtyName,
  language,
  region,
  category,
  codes,
  articleTitles,
  model,
  apiKeys,
}: {
  runId: string;
  specialtyName: string;
  language: string;
  region: string;
  category: string;
  codes: MappedCodeWithSuggestions[];
  articleTitles: string[];
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<ConsolidationRows> {
  const resolved = resolveModel(model, apiKeys);
  const allowed = new Set(codes.map((code) => code.code));
  const prompt = buildCategoryConsolidationPrompt({
    specialty: specialtyName,
    category,
    language,
    region,
    articleTitles,
    codes,
  });

  await logEvent({
    runId,
    stage: 'consolidate_primary',
    level: 'info',
    message: `Calling ${resolved.modelId} for "${category}" primary consolidation.`,
    metrics: {
      model: resolved.modelId,
      provider: resolved.provider,
      reasoning: model.reasoning,
    },
  });

  const started = Date.now();
  const result = await generateText({
    model: resolved.sdkModel,
    system: CONSOLIDATION_SYSTEM_PROMPT,
    prompt,
    output: Output.object({ schema: ConsolidationOutputSchema }),
    providerOptions: resolved.providerOptions,
    temperature: 1,
  });
  const durationMs = Date.now() - started;
  const usage = {
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    reasoningTokens: result.usage?.reasoningTokens,
    cachedInputTokens: result.usage?.cachedInputTokens,
  };
  await logEvent({
    runId,
    stage: 'consolidate_primary',
    level: 'info',
    message: `LLM primary consolidation done for "${category}" in ${durationMs}ms.`,
    metrics: {
      durationMs,
      ...usage,
      costUsd: estimateCostUsd(resolved.modelId, usage),
      model: resolved.modelId,
      provider: resolved.provider,
      reasoning: model.reasoning,
      completion: result.output,
    },
  });

  const output = result.output;
  if (output.category !== category) {
    throw new Error(
      `Consolidation output category mismatch: expected "${category}", got "${output.category}"`,
    );
  }

  const newArticles = output.articles
    .map((row) => {
      const codesForRow = codeList(row.codes, allowed);
      return {
        articleTitle: row.articleTitle,
        articleType: row.articleType,
        articleId: row.articleId,
        category,
        specialtyName,
        exists: row.exists,
        numCodes: codesForRow.length,
        codes: codesForRow,
        previousArticleTitleSuggestions: row.previousArticleTitleSuggestions,
        overallCoverage: row.overallCoverage,
        overallImportance: row.overallImportance,
        justification: row.justification ?? 'Generated by LLM consolidation.',
      };
    })
    .filter((row) => row.articleTitle.trim() && row.numCodes > 0);

  const sectionUpdates = output.sections.flatMap((section) =>
    section.sectionUpdates
      .map((update) => {
        const codesForRow = codeList(update.codes, allowed);
        const exists = update.exists === true;
        return {
          articleTitle: section.articleTitle,
          articleType: section.articleType,
          articleId: section.articleId,
          sectionName: update.sectionName,
          sectionId: update.sectionId,
          exists: update.exists,
          newSection: update.exists === false,
          sectionUpdate: exists,
          category,
          specialtyName,
          unique_title: `${section.articleTitle} - ${update.sectionName}`,
          uniqueId: [section.articleId, update.sectionId].filter(Boolean).join(':'),
          numCodes: codesForRow.length,
          codes: codesForRow,
          previousSectionNames: update.previousArticleAndSectionTitleSuggestions,
          overallCoverage: update.overallCoverage,
          overallImportance: update.overallImportance,
          justification: update.justification ?? 'Generated by LLM consolidation.',
        };
      })
      .filter((row) => row.sectionName.trim() && row.numCodes > 0),
  );

  return {
    newArticles,
    sectionUpdates,
    decisions: {
      ignoredArticles: output.ignoredArticles,
      ignoredSections: output.ignoredSections,
      totallyIgnoredIndexes: output.totallyIgnoredIndexes,
      includedArticleIndexes: output.includedArticleIndexes,
      ignoredArticleIndexes: output.ignoredArticleIndexes,
      includedSectionIndexes: output.includedSectionIndexes,
      ignoredSectionIndexes: output.ignoredSectionIndexes,
    },
  };
}

/**
 * Delete every staging row in `collection` whose `category` matches one
 * of the listed values. Used to keep primary idempotent across re-runs.
 */
async function clearStagingForCategories(
  collection: 'newArticleSuggestions' | 'articleUpdateSuggestions',
  slug: string,
  categories: string[],
): Promise<number> {
  if (categories.length === 0) return 0;
  const pb = await createAdminClient();
  // Filter only by `specialtySlug` server-side and match `category`
  // client-side. PocketBase's filter parser rejects 400 on category
  // values that mix `;`, `:`, and `,` (e.g. `"I.B Clinical Sciences:
  // Anesthesia Procedures, Methods, and Techniques; I.B.5 …"`) even
  // when passed through `pb.filter()` parameterization — those values
  // still surface as separators in the server-side parse. The extra
  // in-memory pass is bounded by a single specialty's staging rows.
  const set = new Set(categories.map((category) => category.trim()));
  const filter = pb.filter('specialtySlug = {:slug}', { slug });
  const rows = await pb
    .collection<ArticleSuggestionRecord>(collection)
    .getFullList({ filter });
  const toDelete = rows.filter(
    (r) => r.category !== undefined && set.has(r.category.trim()),
  );
  await Promise.all(toDelete.map((r) => pb.collection(collection).delete(r.id)));
  return toDelete.length;
}

async function updateCategoryDecisions({
  slug,
  category,
  allowedCodes,
  newArticles,
  sectionUpdates,
  decisions,
}: {
  slug: string;
  category: string;
  allowedCodes: Set<string>;
  newArticles: Array<Record<string, unknown>>;
  sectionUpdates: Array<Record<string, unknown>>;
  decisions?: ConsolidationRows['decisions'];
}): Promise<void> {
  const pb = await createAdminClient();
  const rows = await pb
    .collection<CodeCategoryRecord>('codeCategories')
    .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) });
  const row = rows.find((r) => r.codeCategory?.trim() === category.trim());
  if (!row) return;

  const codesFromRows = (inputRows: Array<Record<string, unknown>>): string[] => {
    const out = new Set<string>();
    for (const inputRow of inputRows) {
      const rawCodes = inputRow.codes;
      if (!Array.isArray(rawCodes)) continue;
      for (const raw of rawCodes) {
        const code =
          typeof raw === 'string'
            ? raw
            : raw && typeof raw === 'object' && 'code' in raw
              ? String((raw as { code?: unknown }).code ?? '')
              : '';
        if (code && allowedCodes.has(code)) out.add(code);
      }
    }
    return Array.from(out).sort();
  };

  const includedArticleCodes = codesFromRows(newArticles);
  const includedSectionCodes = codesFromRows(sectionUpdates);
  const excludedArticleCodes = ignoredCodes(
    decisions?.ignoredArticles ?? [],
    allowedCodes,
  );
  const excludedSectionCodes = ignoredCodes(
    decisions?.ignoredSections ?? [],
    allowedCodes,
  );
  const totallyIgnoredCodes = ignoredCodes(
    (decisions?.totallyIgnoredIndexes ?? []).map((row) => ({ code: row.code })),
    allowedCodes,
  );

  await pb.collection('codeCategories').update(row.id, {
    isConsolidated: true,
    includedArticleCodes,
    numIncludedArticleCodes: includedArticleCodes.length,
    excludedArticleCodes,
    numExcludedArticleCodes: excludedArticleCodes.length,
    includedSectionCodes,
    numIncludedSectionCodes: includedSectionCodes.length,
    excludedSectionCodes,
    numExcludedSectionCodes: excludedSectionCodes.length,
    totallyIgnoredCodes,
    numTotallyIgnoredCodes: totallyIgnoredCodes.length,
    numIncludedCodes: new Set([
      ...includedArticleCodes,
      ...includedSectionCodes,
      ...excludedArticleCodes,
      ...excludedSectionCodes,
      ...totallyIgnoredCodes,
    ]).size,
  });
}

export async function consolidatePrimaryWorkflow(
  input: ConsolidatePrimaryInput,
): Promise<ConsolidatePrimaryStats> {
  console.log('[pipeline] consolidatePrimaryWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    consolidationCategories: input.consolidationCategories ?? null,
  });

  try {
    await markStageRunning(input.runId, 'consolidate_primary');

    const [codes, specialty, articleTitles] = await Promise.all([
      listMappedCodesWithSuggestionsAsAdmin(
        input.specialtySlug,
        input.consolidationCategories,
        input.sourceCategories,
      ),
      getSpecialtyRecordAsAdmin(input.specialtySlug),
      listAmbossArticleTitlesAsAdmin(),
    ]);
    const groups = groupByConsolidationCategory(codes);
    const consolidationCategoriesProcessed = Array.from(groups.keys());

    await logEvent({
      runId: input.runId,
      stage: 'consolidate_primary',
      level: 'info',
      message: `Running category consolidation for ${consolidationCategoriesProcessed.length} consolidation categor${consolidationCategoriesProcessed.length === 1 ? 'y' : 'ies'} (${codes.length} mapped codes).`,
    });

    if (consolidationCategoriesProcessed.length > 0) {
      // Idempotent per-category clear so consecutive triggers from the
      // review page replace rather than append.
      const clearedArticles = await clearStagingForCategories(
        'newArticleSuggestions',
        input.specialtySlug,
        consolidationCategoriesProcessed,
      );
      const clearedSections = await clearStagingForCategories(
        'articleUpdateSuggestions',
        input.specialtySlug,
        consolidationCategoriesProcessed,
      );
      if (clearedArticles + clearedSections > 0) {
        await logEvent({
          runId: input.runId,
          stage: 'consolidate_primary',
          level: 'info',
          message: `Cleared ${clearedArticles} stale new-article + ${clearedSections} stale section-update staging rows.`,
        });
      }
    }

    let totalArticles = 0;
    let totalSections = 0;
    for (const [category, catCodes] of groups.entries()) {
      // Cooperative cancellation between categories.
      const status = await getPipelineRunStatus(input.runId);
      if (shouldAbort(status)) {
        await logEvent({
          runId: input.runId,
          stage: 'consolidate_primary',
          level: 'info',
          message: `Cancelled mid-run before category "${category}" (observed status=${status ?? 'missing'}).`,
        }).catch(() => {});
        return {
          consolidationCategoriesProcessed,
          stagingArticles: totalArticles,
          stagingSections: totalSections,
        };
      }

      const consolidated =
        input.model && input.apiKeys
          ? await consolidateCategoryWithLlm({
              runId: input.runId,
              category,
              codes: catCodes,
              specialtyName: specialty?.name ?? input.specialtySlug,
              language: specialty?.language ?? 'english',
              region: specialty?.region ?? 'us',
              articleTitles,
              model: input.model,
              apiKeys: input.apiKeys,
            })
          : {
              newArticles: aggregateNewArticles(catCodes, category),
              sectionUpdates: aggregateSectionUpdates(catCodes, category),
              decisions: undefined,
            };
      const newArticles = consolidated.newArticles;
      const sectionUpdates = consolidated.sectionUpdates;

      if (newArticles.length > 0) {
        await bulkInsertNewArticleSuggestionsAsAdmin(input.specialtySlug, newArticles);
      }
      if (sectionUpdates.length > 0) {
        await bulkInsertArticleUpdateSuggestionsAsAdmin(
          input.specialtySlug,
          sectionUpdates,
        );
      }
      await updateCategoryDecisions({
        slug: input.specialtySlug,
        category,
        allowedCodes: new Set(catCodes.map((code) => code.code)),
        newArticles,
        sectionUpdates,
        decisions: consolidated.decisions,
      });
      totalArticles += newArticles.length;
      totalSections += sectionUpdates.length;

      await logEvent({
        runId: input.runId,
        stage: 'consolidate_primary',
        level: 'info',
        message: `"${category}": ${catCodes.length} codes → ${newArticles.length} new-article candidates + ${sectionUpdates.length} section-update candidates.`,
      });
    }

    await markStageCompleted(input.runId, 'consolidate_primary', undefined, {
      categories: consolidationCategoriesProcessed.length,
      codes: codes.length,
      newArticleSuggestions: totalArticles,
      articleUpdateSuggestions: totalSections,
      llmStub: !input.model,
      model: input.model?.model,
    });
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
    return {
      consolidationCategoriesProcessed,
      stagingArticles: totalArticles,
      stagingSections: totalSections,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] consolidatePrimaryWorkflow failed', msg);
    await markStageFailed(input.runId, 'consolidate_primary', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
