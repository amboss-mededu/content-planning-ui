import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { listArticleBacklog } from '@/lib/data/article-backlog';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { listArticleReviews } from '@/lib/data/article-reviews';
import { listConsolidatedArticles } from '@/lib/data/articles';
import { listUnmappedCodeCount } from '@/lib/data/codes';
import { getCurrentPipelineRun } from '@/lib/data/pipeline';
import { listSectionReviews } from '@/lib/data/section-reviews';
import { listConsolidatedSections } from '@/lib/data/sections';
import { createServerClient } from '@/lib/pb/server';
import type { SpecialtyRecord } from '@/lib/pb/types';
import { derivePhase } from '@/lib/phase';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

async function readSpecialtyForTabs(slug: string): Promise<{
  milestones: string | null;
  tabOverrides: Record<string, boolean>;
}> {
  await connection();
  const pb = await userClient();
  try {
    const row = await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
    return {
      milestones: row.milestones ?? null,
      tabOverrides: (row.tabOverrides ?? {}) as Record<string, boolean>,
    };
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      return { milestones: null, tabOverrides: {} };
    }
    throw e;
  }
}

/** Tab segments used as keys in the returned map (`''` is Overview). */
export const TAB_SEGMENTS = [
  '',
  'pipeline',
  'milestones',
  'categories',
  'mapping',
  'articles',
  'sections',
  'backlog',
] as const;

export type TabSegment = (typeof TAB_SEGMENTS)[number];

/**
 * Compute the "step complete" status for each tab in the planning
 * sub-nav. Auto-derived from existing data per tab, OR-merged with the
 * editor's manual per-tab override stored on `specialties.tabOverrides`.
 *
 * Returns a map keyed by tab segment. Tabs without an auto-derive rule
 * (Overview, Categories) rely entirely on the override map.
 */
export async function getTabsComplete(
  slug: string,
): Promise<Record<TabSegment, boolean>> {
  const [
    specialty,
    run,
    unmappedCount,
    consolidatedArticles,
    articleReviews,
    consolidatedSections,
    sectionReviews,
    backlog,
  ] = await Promise.all([
    readSpecialtyForTabs(slug),
    getCurrentPipelineRun(slug),
    listUnmappedCodeCount(slug),
    listConsolidatedArticles(slug),
    listArticleReviews(slug),
    listConsolidatedSections(slug),
    listSectionReviews(slug),
    listArticleBacklog(slug),
  ]);

  const hasRun = run !== null;
  const pipelineDone = derivePhase(run) === 'completed';
  const milestonesDone =
    typeof specialty.milestones === 'string' && specialty.milestones.length > 0;
  // Guard: before any pipeline has produced codes, unmappedCount is
  // trivially 0; require a run to have happened before treating Mapping
  // as auto-complete.
  const mappingDone = hasRun && unmappedCount === 0;

  let decidedArticles = 0;
  let articleApprovalsHaveBacklog = true;
  for (const a of consolidatedArticles) {
    const key =
      a.articleKey ||
      computeArticleKey({
        specialtySlug: slug,
        articleTitle: a.articleTitle,
        articleId: a.articleId,
        category: a.category,
      });
    if (!key) continue;
    const review = articleReviews[key];
    if (review) {
      decidedArticles += 1;
      if (review.status === 'approved' && backlog[key]?.type !== 'new') {
        articleApprovalsHaveBacklog = false;
      }
    }
  }
  const articlesDone =
    consolidatedArticles.length > 0 &&
    decidedArticles === consolidatedArticles.length &&
    articleApprovalsHaveBacklog;

  let decidedSections = 0;
  let sectionApprovalsHaveBacklog = true;
  for (const s of consolidatedSections) {
    const key =
      s.sectionKey ||
      computeSectionKey({
        specialtySlug: slug,
        articleTitle: s.articleTitle,
        articleId: s.articleId,
        sectionName: s.sectionName,
        sectionId: s.sectionId,
        category: s.category,
      });
    if (!key) continue;
    const review = sectionReviews[key];
    if (review) {
      decidedSections += 1;
      if (
        review.status === 'approved' &&
        (!s.articleId || backlog[`upd::${s.articleId}`]?.type !== 'update')
      ) {
        sectionApprovalsHaveBacklog = false;
      }
    }
  }
  const sectionsDone =
    consolidatedSections.length > 0 &&
    decidedSections === consolidatedSections.length &&
    sectionApprovalsHaveBacklog;

  const backlogDone =
    Object.keys(backlog).length > 0 &&
    Object.values(backlog).every((row) => row.status === 'published');

  // Categories are produced during code extraction and finalized once
  // every code is mapped — so the Categories tab auto-completes on the
  // same signal as Mapping.
  const auto: Record<TabSegment, boolean> = {
    '': false,
    pipeline: pipelineDone,
    milestones: milestonesDone,
    categories: mappingDone,
    mapping: mappingDone,
    articles: articlesDone,
    sections: sectionsDone,
    backlog: backlogDone,
  };

  const overrides = specialty.tabOverrides;
  const merged = {} as Record<TabSegment, boolean>;
  for (const segment of TAB_SEGMENTS) {
    merged[segment] = auto[segment] || overrides[segment] === true;
  }
  return merged;
}
