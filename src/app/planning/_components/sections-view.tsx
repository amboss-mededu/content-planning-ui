'use client';

import { Badge, Button, Inline, Stack, Text } from '@amboss/design-system';
import { useMemo, useState } from 'react';
import type { ReviewCommentRecord, SectionReviewRecord } from '@/lib/pb/types';
import { useApprovalState } from '@/lib/pb/use-approval-state';
import {
  ArticleManagerModalV2,
  type ReviewerMap,
  type ReviewMap,
} from './article-manager-modal-v2';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, EmbeddedCode, TitleOriginLookup } from './code-utils';
import { ConsolidationViewSwitcher } from './consolidation-view-switcher';
import { type Column, DataTable } from './data-table';

/**
 * Unified row shape for the Article Updates tab. ConsolidatedSection records
 * are projected into this shape upstream so the table can render code chips
 * and a derived `updateType` without re-deriving on every render.
 */
export type SectionRow = {
  /** PB record id of the underlying consolidatedSections row. Use for
   *  routing only — review/comment joins go through `sectionKey`. */
  id?: string;
  /** Stable, content-derived identifier — see
   *  `src/lib/data/article-keys.ts`. */
  sectionKey?: string;
  articleTitle?: string;
  articleId?: string;
  sectionName?: string;
  sectionId?: string;
  updateType: 'new' | 'update' | null;
  category?: string;
  codes: EmbeddedCode[];
  numCodes: number;
  overallImportance?: number;
  overallCoverage?: number;
  justification?: string;
  /** Previous section names emitted by the LLM for this section.
   *  Surfaced in the review modal. */
  previousSectionNames?: string[];
};

// Row-state tints. Approval beats banding beats nothing.
const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';
const ZEBRA_TINT = 'rgba(0, 0, 0, 0.025)';

const UPDATE_TYPE_FILTER_OPTIONS = [
  { value: 'new', label: 'new' },
  { value: 'update', label: 'update' },
  { value: 'none', label: '—' },
];

function updateTypeBadge(r: SectionRow) {
  if (r.updateType === 'new') return <Badge text="new" color="blue" />;
  if (r.updateType === 'update') return <Badge text="update" color="purple" />;
  return <Badge text="—" color="gray" />;
}

/** Per-section column set (used by the "Section view" toggle). */
function buildColumns(categoryLookup: CategoryLookup): Column<SectionRow>[] {
  return [
    {
      key: 'articleTitle',
      label: 'Article Title',
      description: 'Existing AMBOSS article this section belongs to',
      render: (r) => r.articleTitle ?? '—',
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.articleTitle ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'articleId',
      label: 'Article ID',
      description: 'AMBOSS article ID',
      render: (r) => r.articleId ?? '—',
      width: 140,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.articleId ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'sectionName',
      label: 'Section Title',
      description: 'Suggested section title',
      render: (r) => r.sectionName ?? '—',
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.sectionName ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'updateType',
      label: 'Update Type',
      description: 'Whether this is a new section or an update to an existing one',
      render: updateTypeBadge,
      width: 130,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.updateType ?? 'none',
      type: 'string',
      filterable: true,
      filterValue: (r) => r.updateType ?? 'none',
      filterOptions: UPDATE_TYPE_FILTER_OPTIONS,
    },
    {
      key: 'category',
      label: 'Category',
      description: 'Source code category that anchors this section',
      render: (r) => r.category ?? '—',
      width: 160,
      verticalAlign: 'top',
      align: 'left',
      accessor: (r) => r.category ?? null,
      type: 'string',
      filterable: true,
    },
    {
      key: 'codes',
      label: 'Codes',
      description:
        'Codes included in this section. Click a chip for the per-code mapping info: description, previously suggested article, coverage score, importance.',
      render: (r) => <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />,
      verticalAlign: 'top',
      align: 'left',
      accessor: (r) => r.codes.map((c) => c.description ?? c.code).join(' '),
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'numCodes',
      label: '# Codes',
      description: 'Count of unique codes in this section',
      render: (r) => r.numCodes,
      width: 90,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.numCodes,
      type: 'number',
      filterable: true,
    },
    {
      key: 'importance',
      label: 'Importance',
      description: 'Editorial importance score (higher = higher priority)',
      render: (r) => r.overallImportance ?? '—',
      width: 110,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.overallImportance ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'coverage',
      label: 'Coverage',
      description:
        'Existing AMBOSS coverage score for this section (higher = better covered)',
      render: (r) => r.overallCoverage ?? '—',
      width: 110,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.overallCoverage ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'justification',
      label: 'Justification',
      description: 'Why this section should be created or updated',
      render: (r) => (
        <Text color="secondary" size="s">
          {r.justification ?? ''}
        </Text>
      ),
      verticalAlign: 'top',
      accessor: (r) => r.justification ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
  ];
}

/**
 * One row per parent article, aggregating its section update suggestions.
 * Built by `buildArticleGroups` on whatever section subset is currently
 * filtered, so the grouped view stays in sync with the toolbar filters.
 */
type ArticleGroupRow = {
  /** Display key — falls back to "(no article)" so groupless sections
   *  still aggregate into a single visible row. */
  articleTitle: string;
  articleId?: string;
  sections: SectionRow[];
  sectionCount: number;
  newCount: number;
  updateCount: number;
  /** Unique union of codes across the group's sections, keyed by `code`. */
  codes: EmbeddedCode[];
  numCodes: number;
  approvedCount: number;
  rejectedCount: number;
  unreviewedCount: number;
};

function buildArticleGroups(
  sections: SectionRow[],
  reviews: ReviewMap,
): ArticleGroupRow[] {
  // Group by `articleId || articleTitle` so two CMS articles that
  // happen to share a display title stay as separate groups in the
  // aggregate view. Keying by title alone collapsed them into one row
  // and tripped React's duplicate-key check on the table.
  const byKey = new Map<string, ArticleGroupRow>();
  for (const s of sections) {
    const key = s.articleId || s.articleTitle || '(no article)';
    let g = byKey.get(key);
    if (!g) {
      g = {
        articleTitle: s.articleTitle ?? '(no article)',
        articleId: s.articleId,
        sections: [],
        sectionCount: 0,
        newCount: 0,
        updateCount: 0,
        codes: [],
        numCodes: 0,
        approvedCount: 0,
        rejectedCount: 0,
        unreviewedCount: 0,
      };
      byKey.set(key, g);
    }
    g.sections.push(s);
    g.sectionCount++;
    if (s.updateType === 'new') g.newCount++;
    else if (s.updateType === 'update') g.updateCount++;
    if (s.sectionKey) {
      const r = reviews[s.sectionKey];
      if (r === 'approved') g.approvedCount++;
      else if (r === 'rejected') g.rejectedCount++;
      else g.unreviewedCount++;
    } else {
      g.unreviewedCount++;
    }
  }
  // Codes union (dedupe by `code`) computed once per group at the end.
  for (const g of byKey.values()) {
    const seen = new Set<string>();
    for (const s of g.sections) {
      for (const c of s.codes) {
        if (seen.has(c.code)) continue;
        seen.add(c.code);
        g.codes.push(c);
      }
    }
    g.numCodes = g.codes.length;
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.articleTitle === '(no article)' && b.articleTitle !== '(no article)') return 1;
    if (a.articleTitle !== '(no article)' && b.articleTitle === '(no article)') return -1;
    return a.articleTitle.localeCompare(b.articleTitle);
  });
}

function buildGroupColumns(categoryLookup: CategoryLookup): Column<ArticleGroupRow>[] {
  return [
    {
      key: 'articleTitle',
      label: 'Article Title',
      description: 'Existing AMBOSS article being updated',
      render: (r) => r.articleTitle,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.articleTitle,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'articleId',
      label: 'Article ID',
      description: 'AMBOSS article ID',
      render: (r) => r.articleId ?? '—',
      width: 140,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.articleId ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'sectionCount',
      label: '# Sections',
      description:
        'Number of section update suggestions on this article. Subtext breaks down new vs. update.',
      render: (r) => (
        <Stack space="xxs" alignItems="center">
          <Text size="s">{r.sectionCount}</Text>
          {(r.newCount > 0 || r.updateCount > 0) && (
            <Text size="xs" color="secondary">
              {r.newCount > 0 ? `${r.newCount} new` : null}
              {r.newCount > 0 && r.updateCount > 0 ? ' · ' : ''}
              {r.updateCount > 0 ? `${r.updateCount} update` : null}
            </Text>
          )}
        </Stack>
      ),
      width: 130,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.sectionCount,
      type: 'number',
      filterable: true,
    },
    {
      key: 'codes',
      label: 'Codes',
      description:
        'Union of all codes across this article’s suggested sections (deduped). Per-section info — hidden by default in the per-article view.',
      render: (r) => <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />,
      verticalAlign: 'top',
      align: 'left',
      accessor: (r) => r.codes.map((c) => c.description ?? c.code).join(' '),
      type: 'string',
      filterable: true,
      filterMode: 'contains',
      defaultHidden: true,
    },
    {
      key: 'numCodes',
      label: '# Codes',
      description:
        'Unique codes across all sections in this article. Per-section info — hidden by default in the per-article view.',
      render: (r) => r.numCodes,
      width: 90,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.numCodes,
      type: 'number',
      filterable: true,
      defaultHidden: true,
    },
    {
      key: 'review',
      label: 'Reviewed',
      description:
        'Per-state counts of sections in this article. Each badge is omitted when its count is 0, so a fully-unreviewed article shows just the yellow chip.',
      render: (r) => (
        <Stack space="xxs" alignItems="center">
          {r.unreviewedCount > 0 && (
            <Badge color="yellow" text={`${r.unreviewedCount} unreviewed`} />
          )}
          {r.approvedCount > 0 && (
            <Badge color="green" text={`${r.approvedCount} approved`} />
          )}
          {r.rejectedCount > 0 && (
            <Badge color="red" text={`${r.rejectedCount} rejected`} />
          )}
        </Stack>
      ),
      width: 140,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.unreviewedCount,
      type: 'number',
      filterable: true,
    },
  ];
}

export function SectionsView({
  slug,
  rows,
  categoryLookup,
  titleOriginLookup,
  initialReviews,
  initialReviewers,
  initialReviewRows,
  initialCommentsBySection,
  initialCommentsByParentArticle,
  initialNotesBySection,
  viewerEmail,
}: {
  slug: string;
  rows: SectionRow[];
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  initialReviews: ReviewMap;
  initialReviewers: ReviewerMap;
  initialReviewRows: SectionReviewRecord[];
  initialCommentsBySection: Record<string, ReviewCommentRecord[]>;
  initialCommentsByParentArticle: Record<string, ReviewCommentRecord[]>;
  initialNotesBySection: Record<string, string>;
  viewerEmail?: string;
}) {
  const columns = useMemo(() => buildColumns(categoryLookup), [categoryLookup]);
  const groupColumns = useMemo(() => buildGroupColumns(categoryLookup), [categoryLookup]);
  // Local toggle — no URL sync. Defaults to the article-grouped view
  // (editors usually navigate by parent article first).
  const [grouping, setGrouping] = useState<'section' | 'article'>('article');
  const approval = useApprovalState(slug, { sectionReviews: initialReviewRows });
  const reviews = useMemo<ReviewMap>(() => {
    const out: ReviewMap = {};
    for (const r of approval.sectionReviewRows) {
      if (r.sectionKey) out[r.sectionKey] = r.status;
    }
    return out;
  }, [approval.sectionReviewRows]);
  const reviewers = useMemo<ReviewerMap>(() => {
    const out: ReviewerMap = {};
    for (const r of approval.sectionReviewRows) {
      if (!r.sectionKey) continue;
      out[r.sectionKey] = {
        reviewerEmail: r.reviewerEmail,
        reviewedAt: r.reviewedAt,
      };
    }
    return out;
  }, [approval.sectionReviewRows]);
  // Snapshots are seeded into the hook; keep the props for the loader's
  // sake.
  void initialReviews;
  void initialReviewers;
  const [reviewOpen, setReviewOpen] = useState(false);
  // Sections the open review modal walks. Set when the user clicks
  // Start review / Review all or a row.
  const [reviewSections, setReviewSections] = useState<SectionRow[]>([]);
  const [reviewStartAtId, setReviewStartAtId] = useState<string | undefined>();
  // The grouped-by-article DataTable always opens the modal in 'article'
  // view mode so the editor sees the article-level overview first.
  const [reviewInitialViewMode, setReviewInitialViewMode] = useState<
    'section' | 'article' | undefined
  >();
  // Visible row set after the DataTable's filters + sort. Drives the
  // review modal so editors can scope to whatever's currently visible.
  const [visibleRows, setVisibleRows] = useState<SectionRow[]>([]);

  const filtered = useMemo(() => {
    // Stable-sort by parent article title so the per-article zebra
    // bands render as contiguous groups. Falls back to the original
    // index for sections within the same article.
    return [...rows]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const ta = a.r.articleTitle ?? '';
        const tb = b.r.articleTitle ?? '';
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return a.i - b.i;
      })
      .map(({ r }) => r);
  }, [rows]);

  // Aggregate the sorted sections into one row per parent article.
  const groupRows = useMemo(
    () => buildArticleGroups(filtered, reviews),
    [filtered, reviews],
  );

  // Band each section by parent-article title so consecutive sections
  // under one article share a tint and the band flips on every article
  // transition. Used only by the per-section table; the article-grouped
  // table doesn't need bands.
  const bandByRowId = useMemo(() => {
    const out = new Map<string, 0 | 1>();
    let band: 0 | 1 = 0;
    let lastTitle: string | null = null;
    for (const r of filtered) {
      if (!r.id) continue;
      const title = r.articleTitle ?? '';
      if (lastTitle !== null && title !== lastTitle) {
        band = band === 0 ? 1 : 0;
      }
      out.set(r.id, band);
      lastTitle = title;
    }
    return out;
  }, [filtered]);

  const getRowStyle = (r: SectionRow) => {
    if (!r.id) return undefined;
    const s = reviews[r.sectionKey ?? ''];
    if (s === 'approved') return { background: APPROVED_TINT };
    if (s === 'rejected') return { background: REJECTED_TINT };
    return bandByRowId.get(r.id) === 1 ? { background: ZEBRA_TINT } : undefined;
  };

  const reviewCounts = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    const unreviewedArticles = new Set<string>();
    for (const r of rows) {
      if (!r.sectionKey) continue;
      const s = reviews[r.sectionKey];
      if (s === 'approved') approved++;
      else if (s === 'rejected') rejected++;
      else if (r.articleTitle) unreviewedArticles.add(r.articleTitle);
    }
    return {
      approved,
      rejected,
      unreviewed: rows.length - approved - rejected,
      unreviewedArticleCount: unreviewedArticles.size,
    };
  }, [rows, reviews]);

  return (
    <Stack space="m">
      <Inline space="s" vAlignItems="center">
        <ConsolidationViewSwitcher slug={slug} />
        <Button
          variant="primary"
          onClick={() => {
            setReviewSections(visibleRows);
            setReviewStartAtId(undefined);
            setReviewInitialViewMode(undefined);
            setReviewOpen(true);
          }}
          disabled={visibleRows.length === 0}
        >
          {visibleRows.length === rows.length || rows.length === 0
            ? 'Start review'
            : `Review ${visibleRows.length.toLocaleString()} filtered`}
        </Button>
        {visibleRows.length !== rows.length && rows.length > 0 && (
          <Button
            variant="tertiary"
            onClick={() => {
              setReviewSections(rows);
              setReviewStartAtId(undefined);
              setReviewInitialViewMode(undefined);
              setReviewOpen(true);
            }}
          >
            Review all {rows.length.toLocaleString()}
          </Button>
        )}
      </Inline>
      {(() => {
        const viewToggle = (
          <Button
            variant="tertiary"
            size="s"
            onClick={() => setGrouping(grouping === 'section' ? 'article' : 'section')}
          >
            {grouping === 'section' ? 'Article view' : 'Section view'}
          </Button>
        );
        return grouping === 'section' ? (
          <DataTable
            rows={filtered}
            columns={columns}
            getRowKey={(r, i) => r.sectionKey ?? r.id ?? `row-${i}`}
            getRowStyle={getRowStyle}
            onVisibleRowsChange={setVisibleRows}
            onRowClick={(row) => {
              if (!row.id) return;
              setReviewSections(filtered);
              setReviewStartAtId(row.id);
              setReviewInitialViewMode('section');
              setReviewOpen(true);
            }}
            countAddendum={() => 'sections'}
            leadingNote={`${reviewCounts.approved} approved · ${reviewCounts.rejected} rejected · ${reviewCounts.unreviewed} unreviewed across ${reviewCounts.unreviewedArticleCount} article${reviewCounts.unreviewedArticleCount === 1 ? '' : 's'}`}
            storageKey={`sections-table:${slug}:section`}
            leftActions={viewToggle}
          />
        ) : (
          <DataTable
            rows={groupRows}
            columns={groupColumns}
            getRowKey={(g) => g.articleId || g.articleTitle}
            // Keep visibleRows aligned with the underlying section set the
            // Start review buttons walk — the aggregate table's filters
            // only affect the visible groups, but reviews always run
            // against sections, so we surface the section list.
            onVisibleRowsChange={(visibleGroups) =>
              setVisibleRows(visibleGroups.flatMap((g) => g.sections))
            }
            onRowClick={(g) => {
              // Pass the FULL filtered set so the modal's Next/Prev
              // article walk has something to step through; seek into
              // the clicked article via the first section's id. Greying
              // happened before because we only handed the modal one
              // article's worth of sections.
              setReviewSections(filtered);
              setReviewStartAtId(g.sections[0]?.id);
              setReviewInitialViewMode('article');
              setReviewOpen(true);
            }}
            countAddendum={() => 'articles'}
            leadingNote={`Sections: ${reviewCounts.approved} approved · ${reviewCounts.rejected} rejected · ${reviewCounts.unreviewed} unreviewed across ${reviewCounts.unreviewedArticleCount} article${reviewCounts.unreviewedArticleCount === 1 ? '' : 's'}`}
            storageKey={`sections-table:${slug}:article`}
            leftActions={viewToggle}
          />
        );
      })()}
      {reviewOpen && (
        <ArticleManagerModalV2
          opener={{
            type: 'update',
            stage: 'review-2nd',
            slug,
            sections: reviewSections,
            startAtId: reviewStartAtId,
            initialViewMode: reviewInitialViewMode,
            initialReviews: reviews,
            initialReviewers: reviewers,
            initialCommentsBySection,
            initialCommentsByParentArticle,
            initialNotesBySection,
            categoryLookup,
            titleOriginLookup,
            viewerEmail,
            onDecideSection: approval.decideSection,
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </Stack>
  );
}
