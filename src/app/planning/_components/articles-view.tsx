'use client';

import { Button, Inline, Stack, Text } from '@amboss/design-system';
import { useMemo, useState } from 'react';
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
 * Unified row shape for the New Articles tab. Both 1st-pass
 * (`consolidatedArticles`) and 2nd-pass (`newArticleSuggestions`) records are
 * projected into this shape upstream so the table can render a single column
 * set across both lenses. Pass-specific fields are typed optional and
 * fall back to `—` where the underlying record doesn't carry them
 * (e.g. `category` and `numCodes` are 1st-pass-only; `existingAmbossCoverage`
 * is 2nd-pass-only).
 */
export type ArticleRow = {
  /** PB record id of the underlying consolidatedArticles row. Use for
   *  routing only — review/backlog joins go through `articleKey`. */
  id?: string;
  /** Stable, content-derived identifier — see
   *  `src/lib/data/article-keys.ts`. Empty when the row's title /
   *  articleId aren't enough to compute one (which makes the row
   *  un-reviewable). */
  articleKey?: string;
  articleTitle?: string;
  articleType?: string;
  category?: string;
  codes: EmbeddedCode[];
  numCodes: number;
  overallCoverage?: number;
  existingAmbossCoverage?: string;
  overallImportance?: number;
  justification?: string;
  /** Alternative / precursor titles emitted by the LLM. Surfaced in the
   *  review modal so the editor can see what was consolidated into the
   *  current title. */
  previousArticleTitleSuggestions?: string[];
  pass: 'first' | 'second';
};

/** Compact list of 1st-pass article titles consolidated into the
 *  current 2nd-pass row. Each title is annotated by origin via the
 *  shared titleOriginLookup so the editor can tell whether the
 *  precursor was an article in its own right or a section nested
 *  under one. */
function PreviousTitlesCell({
  titles,
  titleOriginLookup,
}: {
  titles: string[] | undefined;
  titleOriginLookup: TitleOriginLookup;
}) {
  if (!titles || titles.length === 0) return <Text size="xs">—</Text>;
  return (
    <Stack space="xxs">
      {/*
       * Dedupe titles before mapping — the LLM occasionally emits the
       * same precursor suggestion twice under different categories,
       * which would collide on the React key when we use the title.
       * The duplicate row carries no extra signal for the editor, so
       * dropping it is fine.
       */}
      {Array.from(new Set(titles)).map((t) => {
        const origin = titleOriginLookup[t];
        const tag =
          origin?.kind === 'section' || origin?.kind === 'both'
            ? `(in "${origin.inArticle}")`
            : origin?.kind === 'article'
              ? '(article)'
              : null;
        return (
          <Text key={t} size="xs">
            · {t}
            {tag ? ' ' : ''}
            {tag && (
              <Text as="span" size="xs" color="secondary">
                {tag}
              </Text>
            )}
          </Text>
        );
      })}
    </Stack>
  );
}

const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

function buildColumns(
  categoryLookup: CategoryLookup,
  titleOriginLookup: TitleOriginLookup,
): Column<ArticleRow>[] {
  return [
    {
      key: 'title',
      label: 'Title',
      description: 'Article title',
      render: (r) => r.articleTitle ?? '—',
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.articleTitle ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'type',
      label: 'Type',
      description: 'Article type (e.g. disease, procedure, drug)',
      render: (r) => r.articleType ?? '—',
      width: 140,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.articleType ?? null,
      type: 'string',
      filterable: true,
    },
    {
      key: 'category',
      label: 'Category',
      description:
        'Source code category that anchors this article (1st-pass only — empty for 2nd-pass cross-category records).',
      render: (r) => r.category ?? '—',
      width: 160,
      verticalAlign: 'top',
      align: 'left',
      accessor: (r) => r.category ?? null,
      type: 'string',
      filterable: true,
    },
    {
      key: 'previousArticleTitles',
      label: 'Previous article titles',
      description:
        '1st-pass article titles consolidated into this 2nd-pass article (cross-category dedupe lineage).',
      render: (r) => (
        <PreviousTitlesCell
          titles={r.previousArticleTitleSuggestions}
          titleOriginLookup={titleOriginLookup}
        />
      ),
      verticalAlign: 'top',
      align: 'left',
      accessor: (r) => (r.previousArticleTitleSuggestions ?? []).join(' '),
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'codes',
      label: 'Codes',
      description:
        'Codes included in this article. Click a chip for the per-code mapping info: description, previously suggested article, coverage score, importance.',
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
      description: 'Count of unique codes in this article',
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
        '1st pass: numeric AMBOSS coverage score (overallCoverage). 2nd pass: free-text coverage note (existingAmbossCoverage).',
      render: (r) => r.overallCoverage ?? r.existingAmbossCoverage ?? '—',
      width: 140,
      verticalAlign: 'top',
      align: 'center',
      accessor: (r) => r.overallCoverage ?? null,
      type: 'number',
      filterable: true,
    },
    {
      key: 'justification',
      label: 'Justification',
      description: 'Why this article was proposed',
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

export function ArticlesView({
  slug,
  consolidated,
  categoryLookup,
  titleOriginLookup,
  initialReviews,
  initialReviewers,
  initialCommentsByArticle,
  initialNotesByArticle,
  viewerEmail,
}: {
  slug: string;
  consolidated: ArticleRow[];
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  initialReviews: ReviewMap;
  initialReviewers: ReviewerMap;
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  initialNotesByArticle: Record<string, string>;
  viewerEmail?: string;
}) {
  const allColumns = useMemo(
    () => buildColumns(categoryLookup, titleOriginLookup),
    [categoryLookup, titleOriginLookup],
  );
  // 1st-consolidation column shape: keep Category, drop the cross-category
  // lineage column (the 2nd-pass-only `previousArticleTitles`).
  const columns = useMemo(
    () => allColumns.filter((c) => c.key !== 'previousArticleTitles'),
    [allColumns],
  );
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewers, setReviewers] = useState<ReviewerMap>(initialReviewers);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Articles the open review modal walks. Set when the user clicks one
  // of the Start review / Review all buttons — see scope handlers below.
  const [reviewArticles, setReviewArticles] = useState<ArticleRow[]>([]);
  // When the modal is opened from a row click, this is the row's PB
  // record id and the modal seeks straight to it. The Start review /
  // Review all buttons clear this so the modal lands on first-unreviewed.
  const [reviewStartAtId, setReviewStartAtId] = useState<string | undefined>();
  // Visible row set after the DataTable's filters + sort have been
  // applied. Drives the review modal so editors can scope a review
  // pass to whatever's currently filtered.
  const [visibleRows, setVisibleRows] = useState<ArticleRow[]>([]);

  // Tint applies to rows that have a recorded review status.
  const getRowStyle = (r: ArticleRow) => {
    if (!r.id) return undefined;
    const s = reviews[r.id];
    if (s === 'approved') return { background: APPROVED_TINT };
    if (s === 'rejected') return { background: REJECTED_TINT };
    return undefined;
  };

  const activeRows = consolidated;

  const reviewCounts = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    for (const r of consolidated) {
      if (!r.id) continue;
      const s = reviews[r.id];
      if (s === 'approved') approved++;
      else if (s === 'rejected') rejected++;
    }
    return {
      approved,
      rejected,
      unreviewed: consolidated.length - approved - rejected,
    };
  }, [consolidated, reviews]);

  return (
    <Stack space="xl">
      <ConsolidationViewSwitcher slug={slug} />
      <Stack space="m">
        <Inline space="s" vAlignItems="bottom">
          <Button
            variant="primary"
            onClick={() => {
              setReviewArticles(visibleRows);
              setReviewStartAtId(undefined);
              setReviewOpen(true);
            }}
            disabled={visibleRows.length === 0}
          >
            {visibleRows.length === activeRows.length || activeRows.length === 0
              ? 'Start review'
              : `Review ${visibleRows.length.toLocaleString()} filtered`}
          </Button>
          {visibleRows.length !== activeRows.length && activeRows.length > 0 && (
            <Button
              variant="tertiary"
              onClick={() => {
                setReviewArticles(activeRows);
                setReviewStartAtId(undefined);
                setReviewOpen(true);
              }}
            >
              Review all {activeRows.length.toLocaleString()}
            </Button>
          )}
        </Inline>
        <DataTable
          rows={activeRows}
          columns={columns}
          getRowKey={(_r, i) => `art-${i}`}
          getRowStyle={getRowStyle}
          onVisibleRowsChange={setVisibleRows}
          onRowClick={(row) => {
            if (!row.id) return;
            setReviewArticles(activeRows);
            setReviewStartAtId(row.id);
            setReviewOpen(true);
          }}
          leadingNote={`${reviewCounts.approved} approved · ${reviewCounts.rejected} rejected · ${reviewCounts.unreviewed} unreviewed`}
          emptyText="No approved new articles yet. Approve rows on the Review tab to populate this list."
          storageKey={`articles-table:${slug}`}
        />
      </Stack>

      {reviewOpen && (
        <ArticleManagerModalV2
          opener={{
            type: 'new',
            stage: 'review-1st',
            slug,
            articles: reviewArticles,
            passLabel: 'New articles',
            startAtId: reviewStartAtId,
            initialReviews: reviews,
            initialReviewers: reviewers,
            initialCommentsByArticle,
            initialNotesByArticle,
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
