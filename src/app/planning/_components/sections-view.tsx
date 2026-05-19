'use client';

import {
  Badge,
  Button,
  Inline,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ReviewCommentRecord } from '@/lib/pb/types';
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

const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

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
    if (s.id) {
      const r = reviews[s.id];
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
  initialCommentsBySection: Record<string, ReviewCommentRecord[]>;
  initialCommentsByParentArticle: Record<string, ReviewCommentRecord[]>;
  initialNotesBySection: Record<string, string>;
  viewerEmail?: string;
}) {
  const columns = useMemo(() => buildColumns(categoryLookup), [categoryLookup]);
  const groupColumns = useMemo(() => buildGroupColumns(categoryLookup), [categoryLookup]);
  const params = useSearchParams();
  const [article, setArticle] = useState<string>(() => params.get('article') ?? '');
  // Whether the table renders one row per parent article (default — the
  // editor-friendly view) or one row per section. The `?grouping=section`
  // URL flips back to the per-section layout.
  const [grouping, setGrouping] = useState<'section' | 'article'>(() =>
    params.get('grouping') === 'section' ? 'section' : 'article',
  );
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Sections the open review modal walks. Set when the user clicks
  // one of the Start review / Review all buttons or a table row.
  const [reviewSections, setReviewSections] = useState<SectionRow[]>([]);
  // Section id to seek to on open (set by row click in section view).
  const [reviewStartAtId, setReviewStartAtId] = useState<string | undefined>();
  // When the modal is opened from the per-article grouped view, land
  // it in the modal's built-in 'article' view mode so the editor sees
  // the article-level overview first.
  const [reviewInitialViewMode, setReviewInitialViewMode] = useState<
    'section' | 'article' | undefined
  >();
  // Visible row set after DataTable's column-level filters + sort,
  // intersected with the toolbar `article` filter above. Drives the
  // review modal so editors can scope to whatever's currently visible.
  const [visibleRows, setVisibleRows] = useState<SectionRow[]>([]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (article) p.set('article', article);
    if (grouping === 'section') p.set('grouping', 'section');
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [article, grouping]);

  // Article options come from the full row set. Counts are per-article
  // totals across the visible review state.
  const articleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const t = r.articleTitle;
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, n]) => ({ value: title, label: `${title} (${n})` }));
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (article) out = out.filter((r) => r.articleTitle === article);
    return out;
  }, [rows, article]);

  // Aggregate the *filtered* sections so the article view honours the
  // toolbar filters — e.g. filtering to "new" shows only articles that
  // have at least one new-section suggestion, aggregated over just
  // those new sections.
  const groupRows = useMemo(
    () => buildArticleGroups(filtered, reviews),
    [filtered, reviews],
  );

  const reviewCounts = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    const unreviewedArticles = new Set<string>();
    for (const r of rows) {
      if (!r.id) continue;
      const s = reviews[r.id];
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

  const getRowStyle = (r: SectionRow) => {
    if (!r.id) return undefined;
    const s = reviews[r.id];
    if (s === 'approved') return { background: APPROVED_TINT };
    if (s === 'rejected') return { background: REJECTED_TINT };
    return undefined;
  };

  return (
    <Stack space="m">
      <ConsolidationViewSwitcher slug={slug} />
      <Inline space="s" vAlignItems="bottom">
        <SegmentedControl
          label="Grouping"
          isLabelHidden
          value={grouping}
          onChange={(v) => setGrouping(v === 'article' ? 'article' : 'section')}
          options={[
            { name: 'grouping', value: 'article', label: 'By article' },
            { name: 'grouping', value: 'section', label: 'By section' },
          ]}
        />
        {grouping === 'section' && (
          <div className="filter-cell">
            <Select
              name="article"
              label="Article"
              value={article}
              options={[{ value: '', label: 'All articles' }, ...articleOptions]}
              onChange={(e) => setArticle(e.target.value)}
            />
          </div>
        )}
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
      {grouping === 'section' ? (
        <DataTable
          rows={filtered}
          columns={columns}
          getRowKey={(_r, i) => `${i}`}
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
        />
      ) : (
        <DataTable
          rows={groupRows}
          columns={groupColumns}
          getRowKey={(g) => g.articleId || g.articleTitle}
          // Keep the toolbar's visibleRows aligned with the underlying
          // section set the Start review buttons walk — the aggregate
          // table's filters only affect the visible groups, but reviews
          // always run against sections, so we surface the section list.
          onVisibleRowsChange={(visibleGroups) =>
            setVisibleRows(visibleGroups.flatMap((g) => g.sections))
          }
          onRowClick={(g) => {
            setReviewSections(g.sections);
            setReviewStartAtId(undefined);
            setReviewInitialViewMode('article');
            setReviewOpen(true);
          }}
          countAddendum={() => 'articles'}
          leadingNote={`Sections across these articles: ${reviewCounts.approved} approved · ${reviewCounts.rejected} rejected · ${reviewCounts.unreviewed} unreviewed across ${reviewCounts.unreviewedArticleCount} article${reviewCounts.unreviewedArticleCount === 1 ? '' : 's'}`}
          storageKey={`sections-table:${slug}:article`}
        />
      )}
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
            onReviewsChange: setReviews,
            onReviewersChange: setReviewers,
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </Stack>
  );
}
