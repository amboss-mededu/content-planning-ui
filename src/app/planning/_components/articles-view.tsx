'use client';

import {
  Button,
  Callout,
  H2,
  Inline,
  SegmentedControl,
  Stack,
  Text,
} from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { ReviewCommentRecord } from '@/lib/pb/types';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, EmbeddedCode, TitleOriginLookup } from './code-utils';
import { type Column, DataTable } from './data-table';
import { type ReviewMap, ReviewModal } from './review-modal';

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
  /** PB record id of the underlying consolidatedArticles row. Set on
   *  1st-pass rows; the review pass keys reviews on this. */
  id?: string;
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

type Pass = 'first' | 'second';

const APPROVED_TINT = 'rgba(16, 185, 129, 0.12)';
const REJECTED_TINT = 'rgba(220, 38, 38, 0.12)';

function buildColumns(categoryLookup: CategoryLookup): Column<ArticleRow>[] {
  return [
    {
      key: 'title',
      label: 'Title',
      description: 'Article title',
      render: (r) => r.articleTitle ?? '—',
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
      align: 'center',
      accessor: (r) => r.category ?? null,
      type: 'string',
      filterable: true,
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
  newOnes,
  updates,
  categoryLookup,
  titleOriginLookup,
  initialReviews,
  initialCommentsByArticle,
  viewerEmail,
}: {
  slug: string;
  consolidated: ArticleRow[];
  newOnes: ArticleRow[];
  updates: ArticleRow[];
  categoryLookup: CategoryLookup;
  titleOriginLookup: TitleOriginLookup;
  initialReviews: ReviewMap;
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  viewerEmail?: string;
}) {
  const columns = useMemo(() => buildColumns(categoryLookup), [categoryLookup]);
  const params = useSearchParams();
  const [pass, setPass] = useState<Pass>(() =>
    params.get('pass') === 'second' ? 'second' : 'first',
  );
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Articles the open review modal walks. Set when the user clicks one
  // of the Start review / Review all buttons — see scope handlers below.
  const [reviewArticles, setReviewArticles] = useState<ArticleRow[]>([]);
  // Visible row set after the DataTable's filters + sort have been
  // applied. Drives the review modal so editors can scope a review
  // pass to whatever's currently filtered.
  const [visibleRows, setVisibleRows] = useState<ArticleRow[]>([]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (pass !== 'first') p.set('pass', pass);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [pass]);

  // Tint applies to 1st-pass rows that have a recorded review status.
  const getRowStyle = (r: ArticleRow) => {
    if (!r.id) return undefined;
    const s = reviews[r.id];
    if (s === 'approved') return { background: APPROVED_TINT };
    if (s === 'rejected') return { background: REJECTED_TINT };
    return undefined;
  };

  const activeRows = pass === 'first' ? consolidated : newOnes;

  // Per-pass review counts. PB record ids are unique across collections,
  // so the same `reviews` map covers both 1st-pass (consolidatedArticles)
  // and 2nd-pass (newArticleSuggestions) — we just slice it by which
  // rows we're counting.
  const reviewCountsByPass = useMemo(() => {
    function count(rows: ArticleRow[]) {
      let approved = 0;
      let rejected = 0;
      for (const r of rows) {
        if (!r.id) continue;
        const s = reviews[r.id];
        if (s === 'approved') approved++;
        else if (s === 'rejected') rejected++;
      }
      return {
        approved,
        rejected,
        unreviewed: rows.length - approved - rejected,
      };
    }
    return { first: count(consolidated), second: count(newOnes) };
  }, [consolidated, newOnes, reviews]);
  const reviewCounts =
    pass === 'first' ? reviewCountsByPass.first : reviewCountsByPass.second;

  return (
    <Stack space="xl">
      <Stack space="m">
        <Inline space="s" vAlignItems="bottom">
          <SegmentedControl
            label="Consolidation pass"
            isLabelHidden
            value={pass}
            onChange={(v) => setPass(v === 'second' ? 'second' : 'first')}
            options={[
              { name: 'pass', value: 'first', label: '1st pass' },
              { name: 'pass', value: 'second', label: '2nd pass' },
            ]}
          />
          <Button
            variant="primary"
            onClick={() => {
              setReviewArticles(visibleRows);
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
          getRowKey={(_r, i) => `${pass}-${i}`}
          getRowStyle={getRowStyle}
          onVisibleRowsChange={setVisibleRows}
          leadingNote={`${reviewCounts.approved} approved · ${reviewCounts.rejected} rejected · ${reviewCounts.unreviewed} unreviewed`}
          emptyText={
            pass === 'first'
              ? 'No 1st-pass articles for this specialty.'
              : 'No 2nd-pass articles for this specialty.'
          }
        />
      </Stack>

      <Stack space="m">
        <H2>Article update suggestions</H2>
        {updates.length === 0 ? (
          <Callout
            type="info"
            text="Article_Update_Suggestions is empty for this specialty."
          />
        ) : (
          <DataTable rows={updates} columns={columns} getRowKey={(_r, i) => `upd-${i}`} />
        )}
      </Stack>

      {reviewOpen && (
        <ReviewModal
          slug={slug}
          articles={reviewArticles}
          passLabel={pass === 'first' ? '1st pass' : '2nd pass'}
          initialReviews={reviews}
          initialCommentsByArticle={initialCommentsByArticle}
          categoryLookup={categoryLookup}
          titleOriginLookup={titleOriginLookup}
          viewerEmail={viewerEmail}
          onClose={() => setReviewOpen(false)}
          onReviewsChange={setReviews}
        />
      )}
    </Stack>
  );
}
