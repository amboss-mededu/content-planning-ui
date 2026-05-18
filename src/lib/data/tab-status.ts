import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { ClientResponseError } from 'pocketbase';
import { listArticleBacklog } from '@/lib/data/article-backlog';
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

  let approvedArticles = 0;
  const approvedArticleIds: string[] = [];
  for (const a of consolidatedArticles) {
    const id = a.id;
    if (!id) continue;
    if (articleReviews[id]?.status === 'approved') {
      approvedArticles += 1;
      approvedArticleIds.push(id);
    }
  }
  const articlesDone =
    consolidatedArticles.length > 0 && approvedArticles === consolidatedArticles.length;

  let approvedSections = 0;
  for (const s of consolidatedSections) {
    const id = s.id;
    if (!id) continue;
    if (sectionReviews[id]?.status === 'approved') approvedSections += 1;
  }
  const sectionsDone =
    consolidatedSections.length > 0 && approvedSections === consolidatedSections.length;

  const backlogDone =
    approvedArticleIds.length > 0 &&
    approvedArticleIds.every((id) => backlog[id]?.status === 'published');

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
