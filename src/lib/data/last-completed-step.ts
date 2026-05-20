import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { createServerClient } from '@/lib/pb/server';
import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  ConsolidatedArticleRecord,
  ConsolidatedSectionRecord,
  PipelineRunRecord,
  SectionReviewRecord,
  SpecialtyRecord,
} from '@/lib/pb/types';
import {
  normalizePipelineStageStates,
  type PipelineStageStates,
} from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

// Badge color is constrained to the DS palette already used by
// `PHASE_COLOR` in `src/lib/phase.ts`; keep the same union here so card
// consumers don't need a parallel type.
export type LastStepColor = 'gray' | 'blue' | 'purple' | 'yellow' | 'green' | 'red';
export type LastStep = { rank: number; label: string; color: LastStepColor };

// Workflow chain in canonical order. The last-completed-step badge
// shows the label at the *highest* rank that is true. Index in this
// array == rank; index 0 is the "not started" sentinel.
const RANK_TABLE: ReadonlyArray<{ label: string; color: LastStepColor }> = [
  { label: 'Not started', color: 'gray' },
  { label: 'Codes extracted', color: 'blue' },
  { label: 'Milestones extracted', color: 'blue' },
  { label: 'Mapping done', color: 'purple' },
  { label: 'Consolidations done', color: 'yellow' },
  { label: 'Article consolidation done', color: 'yellow' },
  { label: 'Section consolidation done', color: 'yellow' },
  { label: 'Literature search done', color: 'yellow' },
  { label: 'New articles reviewed', color: 'green' },
  { label: 'Article updates reviewed', color: 'green' },
  { label: 'Backlog published', color: 'green' },
];

/** Per-specialty signal bag fed into `resolveLastStep`. */
type Signals = {
  hasRun: boolean;
  consolidatedArticleCount: number;
  consolidatedSectionCount: number;
  decidedArticleCount: number;
  decidedSectionCount: number;
  articleApprovalsHaveBacklog: boolean;
  sectionApprovalsHaveBacklog: boolean;
  currentBacklogKeys: Set<string>;
  publishedBacklogKeys: Set<string>;
  overrides: Record<string, boolean>;
  skipped: Record<string, boolean>;
  stageStates: PipelineStageStates;
};

function stateDone(states: PipelineStageStates, stageName: StageName): boolean {
  const state = states[stageName];
  return state === 'complete' || state === 'skipped';
}

function resolveLastStep(s: Signals): LastStep {
  const r1_codes = stateDone(s.stageStates, 'extract_codes');
  const r2_milestones = stateDone(s.stageStates, 'extract_milestones');
  const r3_mapping = stateDone(s.stageStates, 'map_codes');
  const r4_consolidations = stateDone(s.stageStates, 'consolidate_primary');
  const r5_consArticles = stateDone(s.stageStates, 'consolidate_articles');
  const r6_consSections = stateDone(s.stageStates, 'consolidate_sections');
  const r7_litSearch = stateDone(s.stageStates, 'literature_search');
  const r8_articlesReviewed =
    s.consolidatedArticleCount > 0 &&
    s.decidedArticleCount === s.consolidatedArticleCount &&
    s.articleApprovalsHaveBacklog;
  const r9_sectionsReviewed =
    s.consolidatedSectionCount > 0 &&
    s.decidedSectionCount === s.consolidatedSectionCount &&
    s.sectionApprovalsHaveBacklog;
  const r10_backlogPublished =
    s.currentBacklogKeys.size > 0 &&
    Array.from(s.currentBacklogKeys).every((key) => s.publishedBacklogKeys.has(key));

  const flags = [
    false, // rank 0 ("Not started") is the fallback
    r1_codes,
    r2_milestones,
    r3_mapping,
    r4_consolidations,
    r5_consArticles,
    r6_consSections,
    r7_litSearch,
    r8_articlesReviewed,
    r9_sectionsReviewed,
    r10_backlogPublished,
  ];

  let highest = 0;
  for (let i = flags.length - 1; i >= 1; i--) {
    if (flags[i]) {
      highest = i;
      break;
    }
  }
  // If nothing fired but a pipeline run exists, still show "Not started"
  // (rank 0) — the run alone isn't a completed step.
  if (highest === 0 && !s.hasRun) {
    return { rank: 0, ...RANK_TABLE[0] };
  }
  return { rank: highest, ...RANK_TABLE[highest] };
}

function reviewCompletionSignals(input: {
  slug: string;
  articles: Pick<
    ConsolidatedArticleRecord,
    'articleKey' | 'articleTitle' | 'articleId' | 'category'
  >[];
  sections: Pick<
    ConsolidatedSectionRecord,
    'sectionKey' | 'articleTitle' | 'articleId' | 'sectionName' | 'sectionId' | 'category'
  >[];
  articleReviews: ArticleReviewRecord[];
  sectionReviews: SectionReviewRecord[];
  backlog: ArticleBacklogRecord[];
}): Pick<
  Signals,
  | 'decidedArticleCount'
  | 'decidedSectionCount'
  | 'articleApprovalsHaveBacklog'
  | 'sectionApprovalsHaveBacklog'
  | 'currentBacklogKeys'
  | 'publishedBacklogKeys'
> {
  const articleReviewsByKey = new Map(
    input.articleReviews.filter((r) => r.articleKey).map((r) => [r.articleKey, r]),
  );
  const sectionReviewsByKey = new Map(
    input.sectionReviews.filter((r) => r.sectionKey).map((r) => [r.sectionKey, r]),
  );
  const backlogByKey = new Map(
    input.backlog.filter((r) => r.articleKey).map((r) => [r.articleKey, r]),
  );

  let decidedArticleCount = 0;
  let articleApprovalsHaveBacklog = true;
  for (const article of input.articles) {
    const key =
      article.articleKey ||
      computeArticleKey({
        specialtySlug: input.slug,
        articleTitle: article.articleTitle,
        articleId: article.articleId,
        category: article.category,
      });
    if (!key) continue;
    const review = articleReviewsByKey.get(key);
    if (!review) continue;
    decidedArticleCount += 1;
    if (review.status === 'approved' && backlogByKey.get(key)?.type !== 'new') {
      articleApprovalsHaveBacklog = false;
    }
  }

  let decidedSectionCount = 0;
  let sectionApprovalsHaveBacklog = true;
  for (const section of input.sections) {
    const key =
      section.sectionKey ||
      computeSectionKey({
        specialtySlug: input.slug,
        articleTitle: section.articleTitle,
        articleId: section.articleId,
        sectionName: section.sectionName,
        sectionId: section.sectionId,
        category: section.category,
      });
    if (!key) continue;
    const review = sectionReviewsByKey.get(key);
    if (!review) continue;
    decidedSectionCount += 1;
    if (
      review.status === 'approved' &&
      (!section.articleId ||
        backlogByKey.get(`upd::${section.articleId}`)?.type !== 'update')
    ) {
      sectionApprovalsHaveBacklog = false;
    }
  }

  const currentBacklogKeys = new Set<string>();
  const publishedBacklogKeys = new Set<string>();
  for (const row of input.backlog) {
    if (!row.articleKey) continue;
    currentBacklogKeys.add(row.articleKey);
    if (row.status === 'published') publishedBacklogKeys.add(row.articleKey);
  }

  return {
    decidedArticleCount,
    decidedSectionCount,
    articleApprovalsHaveBacklog,
    sectionApprovalsHaveBacklog,
    currentBacklogKeys,
    publishedBacklogKeys,
  };
}

/**
 * Compute the highest-ranked completed step for a single specialty.
 * Parallel-fetches all the per-specialty signals + the override blob,
 * then walks the rank table.
 */
export async function getLastCompletedStep(slug: string): Promise<LastStep> {
  await connection();
  const pb = await userClient();

  const [specialty, runs, articles, sections, reviews, sectionReviews, backlog] =
    await Promise.all([
      readSpecialty(pb, slug),
      pb
        .collection<PipelineRunRecord>('pipelineRuns')
        .getFullList({ filter: `specialtySlug = "${slug}"`, sort: '-startedAt' }),
      pb.collection<ConsolidatedArticleRecord>('consolidatedArticles').getFullList({
        filter: `specialtySlug = "${slug}"`,
        fields: 'articleKey,articleTitle,articleId,category',
      }),
      pb.collection<ConsolidatedSectionRecord>('consolidatedSections').getFullList({
        filter: `specialtySlug = "${slug}"`,
        fields: 'sectionKey,articleTitle,articleId,sectionName,sectionId,category',
      }),
      pb
        .collection<ArticleReviewRecord>('articleReviews')
        .getFullList({ filter: `specialtySlug = "${slug}"` }),
      pb
        .collection<SectionReviewRecord>('sectionReviews')
        .getFullList({ filter: `specialtySlug = "${slug}"` }),
      pb
        .collection<ArticleBacklogRecord>('articleBacklog')
        .getFullList({ filter: `specialtySlug = "${slug}"` }),
    ]);

  const latestRun = runs[0] ?? null;
  const reviewSignals = reviewCompletionSignals({
    slug,
    articles,
    sections,
    articleReviews: reviews,
    sectionReviews,
    backlog,
  });

  return resolveLastStep({
    hasRun: latestRun !== null,
    consolidatedArticleCount: articles.length,
    consolidatedSectionCount: sections.length,
    ...reviewSignals,
    overrides: (specialty?.pipelineStageOverrides ?? {}) as Record<string, boolean>,
    skipped: (specialty?.pipelineStageSkipped ?? {}) as Record<string, boolean>,
    stageStates: normalizePipelineStageStates({
      states: specialty?.pipelineStageStates,
      overrides: specialty?.pipelineStageOverrides,
      skipped: specialty?.pipelineStageSkipped,
    }),
  });
}

async function readSpecialty(
  pb: PocketBase,
  slug: string,
): Promise<SpecialtyRecord | null> {
  try {
    return await pb
      .collection<SpecialtyRecord>('specialties')
      .getFirstListItem(`slug = "${slug}"`);
  } catch {
    return null;
  }
}

/**
 * Bulk version for the home-page / dashboard grids. Single full-list
 * scan per relevant collection, indexed by specialty slug, then run
 * `resolveLastStep` per slug. Mirrors `listSpecialtyPhases` in
 * `src/lib/data/pipeline.ts` for fetch shape.
 */
export async function listSpecialtyLastSteps(): Promise<Record<string, LastStep>> {
  await connection();
  const pb = await userClient();

  const [specialties, runs, articles, sections, reviews, sectionReviews, backlog] =
    await Promise.all([
      pb.collection<SpecialtyRecord>('specialties').getFullList(),
      pb
        .collection<PipelineRunRecord>('pipelineRuns')
        .getFullList({ sort: '-startedAt' }),
      pb.collection<ConsolidatedArticleRecord>('consolidatedArticles').getFullList({
        fields: 'specialtySlug,articleKey,articleTitle,articleId,category',
      }),
      pb.collection<ConsolidatedSectionRecord>('consolidatedSections').getFullList({
        fields:
          'specialtySlug,sectionKey,articleTitle,articleId,sectionName,sectionId,category',
      }),
      pb.collection<ArticleReviewRecord>('articleReviews').getFullList(),
      pb.collection<SectionReviewRecord>('sectionReviews').getFullList(),
      pb.collection<ArticleBacklogRecord>('articleBacklog').getFullList(),
    ]);

  // Latest run per specialty (first occurrence wins because runs are
  // sorted by -startedAt).
  const latestRunBySlug = new Map<string, PipelineRunRecord>();
  for (const r of runs) {
    if (!latestRunBySlug.has(r.specialtySlug)) latestRunBySlug.set(r.specialtySlug, r);
  }

  const articleCount = new Map<string, number>();
  const articlesBySlug = new Map<string, ConsolidatedArticleRecord[]>();
  for (const a of articles) {
    articleCount.set(a.specialtySlug, (articleCount.get(a.specialtySlug) ?? 0) + 1);
    const list = articlesBySlug.get(a.specialtySlug) ?? [];
    list.push(a);
    articlesBySlug.set(a.specialtySlug, list);
  }
  const sectionCount = new Map<string, number>();
  const sectionsBySlug = new Map<string, ConsolidatedSectionRecord[]>();
  for (const s of sections) {
    sectionCount.set(s.specialtySlug, (sectionCount.get(s.specialtySlug) ?? 0) + 1);
    const list = sectionsBySlug.get(s.specialtySlug) ?? [];
    list.push(s);
    sectionsBySlug.set(s.specialtySlug, list);
  }

  const reviewsBySlug = new Map<string, ArticleReviewRecord[]>();
  for (const r of reviews) {
    const list = reviewsBySlug.get(r.specialtySlug) ?? [];
    list.push(r);
    reviewsBySlug.set(r.specialtySlug, list);
  }
  const sectionReviewsBySlug = new Map<string, SectionReviewRecord[]>();
  for (const r of sectionReviews) {
    const list = sectionReviewsBySlug.get(r.specialtySlug) ?? [];
    list.push(r);
    sectionReviewsBySlug.set(r.specialtySlug, list);
  }
  const backlogBySlug = new Map<string, ArticleBacklogRecord[]>();
  for (const b of backlog) {
    const list = backlogBySlug.get(b.specialtySlug) ?? [];
    list.push(b);
    backlogBySlug.set(b.specialtySlug, list);
  }

  const out: Record<string, LastStep> = {};
  for (const sp of specialties) {
    const slug = sp.slug;
    const latestRun = latestRunBySlug.get(slug) ?? null;
    const reviewSignals = reviewCompletionSignals({
      slug,
      articles: articlesBySlug.get(slug) ?? [],
      sections: sectionsBySlug.get(slug) ?? [],
      articleReviews: reviewsBySlug.get(slug) ?? [],
      sectionReviews: sectionReviewsBySlug.get(slug) ?? [],
      backlog: backlogBySlug.get(slug) ?? [],
    });
    out[slug] = resolveLastStep({
      hasRun: latestRun !== null,
      consolidatedArticleCount: articleCount.get(slug) ?? 0,
      consolidatedSectionCount: sectionCount.get(slug) ?? 0,
      ...reviewSignals,
      overrides: (sp.pipelineStageOverrides ?? {}) as Record<string, boolean>,
      skipped: (sp.pipelineStageSkipped ?? {}) as Record<string, boolean>,
      stageStates: normalizePipelineStageStates({
        states: sp.pipelineStageStates,
        overrides: sp.pipelineStageOverrides,
        skipped: sp.pipelineStageSkipped,
      }),
    });
  }
  return out;
}
