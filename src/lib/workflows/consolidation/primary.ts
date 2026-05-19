/**
 * Per-category primary consolidation step (scaffold, no LLM yet).
 *
 * Reads each mapped code in the target category, aggregates the
 * `newArticlesNeeded` and `existingArticleUpdates` blobs the mapping step
 * already wrote, and lands them in the per-category staging tables:
 *   - `newArticleSuggestions`        ← new-article candidates
 *   - `articleUpdateSuggestions`     ← section-update candidates
 *
 * When the real LLM consolidation prompt arrives (see prompts.ts), the
 * aggregation output becomes the LLM's *input* rather than its
 * substitute. The runner shape and the staging-table contract stay the
 * same, so secondary stages (which dedupe staging → consolidated*) don't
 * need to know whether primary's output came from passthrough or from
 * an LLM.
 *
 * Per-category re-run hygiene: before inserting, the runner clears any
 * staging rows tagged with the same category so consecutive clicks of
 * "Start consolidation" don't pile up duplicates.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import {
  bulkInsertArticleUpdateSuggestionsAsAdmin,
  bulkInsertNewArticleSuggestionsAsAdmin,
} from '@/lib/data/articles';
import { listMappedCodesWithSuggestionsAsAdmin } from '@/lib/data/codes';
import { createAdminClient } from '@/lib/pb/server';
import type { ArticleSuggestionRecord } from '@/lib/pb/types';
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
  type AggregatedNewArticleRow,
  type AggregatedSectionUpdateRow,
  aggregateNewArticles,
  aggregateSectionUpdates,
  type MappedCodeWithSuggestions,
} from './aggregate';
import { groupByConsolidationCategory } from './buckets';

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

const ConsolidationOutputSchema = z.object({
  newArticleSuggestions: z.array(
    z.object({
      articleTitle: z.string(),
      codes: z.array(z.string()),
      overallImportance: z.number().optional(),
      justification: z.string().optional(),
    }),
  ),
  articleUpdateSuggestions: z.array(
    z.object({
      articleTitle: z.string().optional(),
      articleId: z.string().optional(),
      sectionName: z.string().optional(),
      sectionId: z.string().optional(),
      exists: z.boolean().optional(),
      newSection: z.boolean().optional(),
      sectionUpdate: z.boolean().optional(),
      codes: z.array(z.string()),
      overallImportance: z.number().optional(),
      justification: z.string().optional(),
    }),
  ),
});

function validCodes(codes: string[], allowed: Set<string>): string[] {
  return Array.from(new Set(codes.filter((code) => allowed.has(code))));
}

async function consolidateCategoryWithLlm({
  runId,
  category,
  codes,
  model,
  apiKeys,
}: {
  runId: string;
  category: string;
  codes: MappedCodeWithSuggestions[];
  model: ModelSpec;
  apiKeys: ProviderApiKeys;
}): Promise<{
  newArticles: AggregatedNewArticleRow[];
  sectionUpdates: AggregatedSectionUpdateRow[];
}> {
  const resolved = resolveModel(model, apiKeys);
  const allowed = new Set(codes.map((code) => code.code));
  const prompt = JSON.stringify(
    {
      consolidationCategory: category,
      instructions:
        'Consolidate mapped-code suggestions into reviewable new-article and article-section update candidates. Merge duplicates and near-duplicates. Preserve only input code IDs in each output row. Return empty arrays only if no candidate is clinically appropriate.',
      codes: codes.map((code) => ({
        code: code.code,
        description: code.description,
        sourceCategory: code.category,
        newArticlesNeeded: code.newArticlesNeeded,
        existingArticleUpdates: code.existingArticleUpdates,
      })),
    },
    null,
    2,
  );

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
    system:
      'You are an expert medical education content planner. Consolidate board-code mapping outputs into concise AMBOSS content planning candidates. Return only schema-valid structured output.',
    prompt,
    output: Output.object({ schema: ConsolidationOutputSchema }),
    providerOptions: resolved.providerOptions,
    temperature: 0,
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

  return {
    newArticles: result.output.newArticleSuggestions
      .map((row) => ({
        articleTitle: row.articleTitle,
        category,
        numCodes: validCodes(row.codes, allowed).length,
        codes: validCodes(row.codes, allowed),
        overallImportance: row.overallImportance,
        justification: row.justification ?? 'Generated by LLM primary consolidation.',
      }))
      .filter((row) => row.articleTitle.trim() && row.codes.length > 0),
    sectionUpdates: result.output.articleUpdateSuggestions
      .map((row) => ({
        articleTitle: row.articleTitle,
        articleId: row.articleId,
        sectionName: row.sectionName,
        sectionId: row.sectionId,
        exists: row.exists,
        newSection: row.newSection,
        sectionUpdate: row.sectionUpdate,
        category,
        numCodes: validCodes(row.codes, allowed).length,
        codes: validCodes(row.codes, allowed),
        overallImportance: row.overallImportance,
        justification: row.justification ?? 'Generated by LLM primary consolidation.',
      }))
      .filter(
        (row) =>
          row.codes.length > 0 &&
          (row.articleTitle?.trim() || row.articleId || row.sectionName?.trim()),
      ),
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

    const codes = await listMappedCodesWithSuggestionsAsAdmin(
      input.specialtySlug,
      input.consolidationCategories,
      input.sourceCategories,
    );
    const groups = groupByConsolidationCategory(codes);
    const consolidationCategoriesProcessed = Array.from(groups.keys());

    await logEvent({
      runId: input.runId,
      stage: 'consolidate_primary',
      level: 'info',
      message: `Aggregating mapping suggestions for ${consolidationCategoriesProcessed.length} consolidation categor${consolidationCategoriesProcessed.length === 1 ? 'y' : 'ies'} (${codes.length} mapped codes). LLM consolidation prompt not yet wired — using passthrough aggregation.`,
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
              model: input.model,
              apiKeys: input.apiKeys,
            })
          : {
              newArticles: aggregateNewArticles(catCodes, category),
              sectionUpdates: aggregateSectionUpdates(catCodes, category),
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
