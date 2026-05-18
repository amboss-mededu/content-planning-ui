import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { createServerClient } from '@/lib/pb/server';
import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  CodeRecord,
  ConsolidatedArticleRecord,
  ConsolidatedSectionRecord,
  PipelineRunRecord,
  PipelineStageRecord,
  SectionReviewRecord,
  SpecialtyRecord,
} from '@/lib/pb/types';

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
  { label: '2nd consolidation (articles)', color: 'yellow' },
  { label: '2nd consolidation (sections)', color: 'yellow' },
  { label: 'Literature search done', color: 'yellow' },
  { label: 'New articles reviewed', color: 'green' },
  { label: 'Article updates reviewed', color: 'green' },
  { label: 'Backlog published', color: 'green' },
];

/** Per-specialty signal bag fed into `resolveLastStep`. */
type Signals = {
  hasRun: boolean;
  stageCompleted: Partial<Record<string, boolean>>;
  milestonesText: boolean;
  mappedCodeCount: number;
  totalCodeCount: number;
  consolidatedArticleCount: number;
  consolidatedSectionCount: number;
  approvedArticleCount: number;
  approvedSectionCount: number;
  approvedArticleIds: string[];
  publishedBacklogIds: Set<string>;
  overrides: Record<string, boolean>;
  skipped: Record<string, boolean>;
};

function bool(value: unknown): boolean {
  return value === true;
}

function resolveLastStep(s: Signals): LastStep {
  const o = s.overrides;
  const k = s.skipped;
  // Each rank corresponds to one slot in the chain — true if the
  // auto-derive signal fires OR the editor manually overrode it OR
  // the editor explicitly skipped it. Skipped stages count as
  // "completed" for chain advancement; only their badge label differs.
  const r1_codes =
    bool(s.stageCompleted.extract_codes) ||
    bool(o.extract_codes) ||
    bool(k.extract_codes);
  const r2_milestones =
    bool(s.stageCompleted.extract_milestones) ||
    s.milestonesText ||
    bool(o.extract_milestones) ||
    bool(k.extract_milestones);
  // "Mapping done" only auto-fires once every code is mapped. Partial
  // progress shouldn't claim the whole stage is complete — that misled
  // the dashboard into showing "Mapping done" after a single code landed.
  // Editors can still force-complete via the override blob if some codes
  // legitimately can't be mapped.
  const r3_mapping =
    bool(s.stageCompleted.map_codes) ||
    (s.totalCodeCount > 0 && s.mappedCodeCount === s.totalCodeCount) ||
    bool(o.map_codes) ||
    bool(k.map_codes);
  const r4_consolidations =
    bool(s.stageCompleted.consolidate_primary) ||
    s.consolidatedArticleCount + s.consolidatedSectionCount >= 1 ||
    bool(o.consolidate_primary) ||
    bool(k.consolidate_primary);
  const r5_consArticles =
    bool(s.stageCompleted.consolidate_articles) ||
    bool(o.consolidate_articles) ||
    bool(k.consolidate_articles);
  const r6_consSections =
    bool(s.stageCompleted.consolidate_sections) ||
    bool(o.consolidate_sections) ||
    bool(k.consolidate_sections);
  const r7_litSearch =
    bool(s.stageCompleted.literature_search) ||
    bool(o.literature_search) ||
    bool(k.literature_search);
  const r8_articlesReviewed =
    s.consolidatedArticleCount > 0 &&
    s.approvedArticleCount === s.consolidatedArticleCount;
  const r9_sectionsReviewed =
    s.consolidatedSectionCount > 0 &&
    s.approvedSectionCount === s.consolidatedSectionCount;
  const r10_backlogPublished =
    s.approvedArticleIds.length > 0 &&
    s.approvedArticleIds.every((id) => s.publishedBacklogIds.has(id));

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

/**
 * Compute the highest-ranked completed step for a single specialty.
 * Parallel-fetches all the per-specialty signals + the override blob,
 * then walks the rank table.
 */
export async function getLastCompletedStep(slug: string): Promise<LastStep> {
  await connection();
  const pb = await userClient();

  const [
    specialty,
    runs,
    codeRows,
    articles,
    sections,
    reviews,
    sectionReviews,
    backlog,
  ] = await Promise.all([
    readSpecialty(pb, slug),
    pb
      .collection<PipelineRunRecord>('pipelineRuns')
      .getFullList({ filter: `specialtySlug = "${slug}"`, sort: '-startedAt' }),
    pb
      .collection<CodeRecord>('codes')
      .getFullList({ filter: `specialtySlug = "${slug}"`, fields: 'id,mappedAt' }),
    pb
      .collection<ConsolidatedArticleRecord>('consolidatedArticles')
      .getFullList({ filter: `specialtySlug = "${slug}"`, fields: 'id' }),
    pb
      .collection<ConsolidatedSectionRecord>('consolidatedSections')
      .getFullList({ filter: `specialtySlug = "${slug}"`, fields: 'id' }),
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
  const stageRows = latestRun
    ? await pb
        .collection<PipelineStageRecord>('pipelineStages')
        .getFullList({ filter: `runId = "${latestRun.id}"`, fields: 'stage,status' })
    : [];

  const stageCompleted: Partial<Record<string, boolean>> = {};
  for (const row of stageRows) {
    if (row.status === 'completed') stageCompleted[row.stage] = true;
  }

  const approvedArticleIds = reviews
    .filter((r) => r.status === 'approved')
    .map((r) => r.articleRecordId);

  return resolveLastStep({
    hasRun: latestRun !== null,
    stageCompleted,
    milestonesText:
      typeof specialty?.milestones === 'string' && specialty.milestones.length > 0,
    mappedCodeCount: codeRows.filter((c) => (c.mappedAt ?? 0) > 0).length,
    totalCodeCount: codeRows.length,
    consolidatedArticleCount: articles.length,
    consolidatedSectionCount: sections.length,
    approvedArticleCount: approvedArticleIds.length,
    approvedSectionCount: sectionReviews.filter((s) => s.status === 'approved').length,
    approvedArticleIds,
    publishedBacklogIds: new Set(
      backlog.filter((b) => b.status === 'published').map((b) => b.articleRecordId),
    ),
    overrides: (specialty?.pipelineStageOverrides ?? {}) as Record<string, boolean>,
    skipped: (specialty?.pipelineStageSkipped ?? {}) as Record<string, boolean>,
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

  const [specialties, runs, codes, articles, sections, reviews, sectionReviews, backlog] =
    await Promise.all([
      pb.collection<SpecialtyRecord>('specialties').getFullList(),
      pb
        .collection<PipelineRunRecord>('pipelineRuns')
        .getFullList({ sort: '-startedAt' }),
      pb
        .collection<CodeRecord>('codes')
        .getFullList({ fields: 'specialtySlug,mappedAt' }),
      pb
        .collection<ConsolidatedArticleRecord>('consolidatedArticles')
        .getFullList({ fields: 'id,specialtySlug' }),
      pb
        .collection<ConsolidatedSectionRecord>('consolidatedSections')
        .getFullList({ fields: 'id,specialtySlug' }),
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

  // Stages for the *latest* run of each specialty. One filter call per
  // run is acceptable here — this list is the homepage grid; one-extra
  // query per specialty is still bounded by the specialty count.
  // `requestKey: null` opts each fan-out call out of the PB SDK's
  // auto-cancellation, which otherwise nukes every concurrent same-method
  // request on `pipelineStages` except the last.
  const stagesByRunId = new Map<string, PipelineStageRecord[]>();
  await Promise.all(
    Array.from(latestRunBySlug.values()).map(async (run) => {
      const list = await pb
        .collection<PipelineStageRecord>('pipelineStages')
        .getFullList({
          filter: `runId = "${run.id}"`,
          fields: 'stage,status',
          requestKey: null,
        });
      stagesByRunId.set(run.id, list);
    }),
  );

  const mappedCount = new Map<string, number>();
  const totalCount = new Map<string, number>();
  for (const c of codes) {
    totalCount.set(c.specialtySlug, (totalCount.get(c.specialtySlug) ?? 0) + 1);
    if ((c.mappedAt ?? 0) > 0) {
      mappedCount.set(c.specialtySlug, (mappedCount.get(c.specialtySlug) ?? 0) + 1);
    }
  }

  const articleCount = new Map<string, number>();
  for (const a of articles) {
    articleCount.set(a.specialtySlug, (articleCount.get(a.specialtySlug) ?? 0) + 1);
  }
  const sectionCount = new Map<string, number>();
  for (const s of sections) {
    sectionCount.set(s.specialtySlug, (sectionCount.get(s.specialtySlug) ?? 0) + 1);
  }

  const approvedArticleIdsBySlug = new Map<string, string[]>();
  const approvedArticleCount = new Map<string, number>();
  for (const r of reviews) {
    if (r.status === 'approved') {
      approvedArticleCount.set(
        r.specialtySlug,
        (approvedArticleCount.get(r.specialtySlug) ?? 0) + 1,
      );
      const arr = approvedArticleIdsBySlug.get(r.specialtySlug) ?? [];
      arr.push(r.articleRecordId);
      approvedArticleIdsBySlug.set(r.specialtySlug, arr);
    }
  }
  const approvedSectionCount = new Map<string, number>();
  for (const r of sectionReviews) {
    if (r.status === 'approved') {
      approvedSectionCount.set(
        r.specialtySlug,
        (approvedSectionCount.get(r.specialtySlug) ?? 0) + 1,
      );
    }
  }
  const publishedBacklogBySlug = new Map<string, Set<string>>();
  for (const b of backlog) {
    if (b.status === 'published') {
      const set = publishedBacklogBySlug.get(b.specialtySlug) ?? new Set<string>();
      set.add(b.articleRecordId);
      publishedBacklogBySlug.set(b.specialtySlug, set);
    }
  }

  const out: Record<string, LastStep> = {};
  for (const sp of specialties) {
    const slug = sp.slug;
    const latestRun = latestRunBySlug.get(slug) ?? null;
    const stageRows = latestRun ? (stagesByRunId.get(latestRun.id) ?? []) : [];
    const stageCompleted: Partial<Record<string, boolean>> = {};
    for (const row of stageRows) {
      if (row.status === 'completed') stageCompleted[row.stage] = true;
    }
    out[slug] = resolveLastStep({
      hasRun: latestRun !== null,
      stageCompleted,
      milestonesText: typeof sp.milestones === 'string' && sp.milestones.length > 0,
      mappedCodeCount: mappedCount.get(slug) ?? 0,
      totalCodeCount: totalCount.get(slug) ?? 0,
      consolidatedArticleCount: articleCount.get(slug) ?? 0,
      consolidatedSectionCount: sectionCount.get(slug) ?? 0,
      approvedArticleCount: approvedArticleCount.get(slug) ?? 0,
      approvedSectionCount: approvedSectionCount.get(slug) ?? 0,
      approvedArticleIds: approvedArticleIdsBySlug.get(slug) ?? [],
      publishedBacklogIds: publishedBacklogBySlug.get(slug) ?? new Set<string>(),
      overrides: (sp.pipelineStageOverrides ?? {}) as Record<string, boolean>,
      skipped: (sp.pipelineStageSkipped ?? {}) as Record<string, boolean>,
    });
  }
  return out;
}
