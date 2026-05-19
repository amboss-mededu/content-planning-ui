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
import { revalidateSpecialtyCache } from '../lib/revalidate';
import {
  aggregateNewArticles,
  aggregateSectionUpdates,
  type MappedCodeWithSuggestions,
} from './aggregate';

const UNCATEGORIZED = '(uncategorized)';

export type ConsolidatePrimaryInput = {
  runId: string;
  specialtySlug: string;
  /** Optional category filter. Null/undefined → every category that has
   *  at least one mapped code. */
  categories?: string[] | null;
};

function shouldAbort(status: string | null): boolean {
  return status === 'cancelled' || status === 'failed' || status === null;
}

/**
 * Group mapped codes by category, falling back to UNCATEGORIZED when a
 * code has no category attached.
 */
function groupByCategory(
  codes: MappedCodeWithSuggestions[],
): Map<string, MappedCodeWithSuggestions[]> {
  const m = new Map<string, MappedCodeWithSuggestions[]>();
  for (const c of codes) {
    const cat = c.category ?? UNCATEGORIZED;
    const bucket = m.get(cat) ?? [];
    bucket.push(c);
    m.set(cat, bucket);
  }
  return m;
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
  const set = new Set(categories);
  const filter = pb.filter('specialtySlug = {:slug}', { slug });
  const rows = await pb
    .collection<ArticleSuggestionRecord>(collection)
    .getFullList({ filter });
  const toDelete = rows.filter((r) => r.category !== undefined && set.has(r.category));
  await Promise.all(toDelete.map((r) => pb.collection(collection).delete(r.id)));
  return toDelete.length;
}

export async function consolidatePrimaryWorkflow(
  input: ConsolidatePrimaryInput,
): Promise<void> {
  console.log('[pipeline] consolidatePrimaryWorkflow start', {
    runId: input.runId,
    specialtySlug: input.specialtySlug,
    categories: input.categories ?? null,
  });

  try {
    await markStageRunning(input.runId, 'consolidate_primary');

    const codes = await listMappedCodesWithSuggestionsAsAdmin(
      input.specialtySlug,
      input.categories,
    );
    const groups = groupByCategory(codes);
    const categoriesProcessed = Array.from(groups.keys());

    await logEvent({
      runId: input.runId,
      stage: 'consolidate_primary',
      level: 'info',
      message: `Aggregating mapping suggestions for ${categoriesProcessed.length} categor${categoriesProcessed.length === 1 ? 'y' : 'ies'} (${codes.length} mapped codes). LLM consolidation prompt not yet wired — using passthrough aggregation.`,
    });

    if (categoriesProcessed.length > 0) {
      // Idempotent per-category clear so consecutive triggers from the
      // review page replace rather than append.
      const clearedArticles = await clearStagingForCategories(
        'newArticleSuggestions',
        input.specialtySlug,
        categoriesProcessed,
      );
      const clearedSections = await clearStagingForCategories(
        'articleUpdateSuggestions',
        input.specialtySlug,
        categoriesProcessed,
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
        return;
      }

      const newArticles = aggregateNewArticles(catCodes, category);
      const sectionUpdates = aggregateSectionUpdates(catCodes, category);

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
      categories: categoriesProcessed.length,
      codes: codes.length,
      newArticleSuggestions: totalArticles,
      articleUpdateSuggestions: totalSections,
      llmStub: true,
    });
    await updatePipelineRunStatus(input.runId, 'completed');
    await revalidateSpecialtyCache(input.specialtySlug);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] consolidatePrimaryWorkflow failed', msg);
    await markStageFailed(input.runId, 'consolidate_primary', msg);
    await updatePipelineRunStatus(input.runId, 'failed', msg);
    await revalidateSpecialtyCache(input.specialtySlug);
    throw e;
  }
}
