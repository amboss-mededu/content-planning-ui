'use client';

import {
  Button,
  Callout,
  H2,
  Inline,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, EmbeddedCode } from './code-utils';
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
type StatusFilter = '' | 'unreviewed' | 'approved' | 'rejected';

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
  initialReviews,
}: {
  slug: string;
  consolidated: ArticleRow[];
  newOnes: ArticleRow[];
  updates: ArticleRow[];
  categoryLookup: CategoryLookup;
  initialReviews: ReviewMap;
}) {
  const columns = useMemo(() => buildColumns(categoryLookup), [categoryLookup]);
  const params = useSearchParams();
  const [pass, setPass] = useState<Pass>(() =>
    params.get('pass') === 'second' ? 'second' : 'first',
  );
  const [reviews, setReviews] = useState<ReviewMap>(initialReviews);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (pass !== 'first') p.set('pass', pass);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [pass]);

  const filteredConsolidated = useMemo(() => {
    if (!statusFilter) return consolidated;
    return consolidated.filter((r) => {
      const s = r.id ? reviews[r.id] : undefined;
      if (statusFilter === 'unreviewed') return !s;
      return s === statusFilter;
    });
  }, [consolidated, reviews, statusFilter]);

  // Tint applies to 1st-pass rows that have a recorded review status.
  const getRowStyle = (r: ArticleRow) => {
    if (!r.id) return undefined;
    const s = reviews[r.id];
    if (s === 'approved') return { background: APPROVED_TINT };
    if (s === 'rejected') return { background: REJECTED_TINT };
    return undefined;
  };

  const activeRows = pass === 'first' ? filteredConsolidated : newOnes;

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
          {pass === 'first' && (
            <>
              <div className="filter-cell">
                <Select
                  name="status"
                  label="Review status"
                  value={statusFilter}
                  options={[
                    { value: '', label: 'All' },
                    { value: 'unreviewed', label: 'Unreviewed' },
                    { value: 'approved', label: 'Approved' },
                    { value: 'rejected', label: 'Rejected' },
                  ]}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                />
              </div>
              <Button
                variant="primary"
                onClick={() => setReviewOpen(true)}
                disabled={consolidated.length === 0}
              >
                Start review
              </Button>
            </>
          )}
        </Inline>
        <DataTable
          rows={activeRows}
          columns={columns}
          getRowKey={(_r, i) => `${pass}-${i}`}
          getRowStyle={pass === 'first' ? getRowStyle : undefined}
          leadingNote={
            pass === 'first'
              ? `${reviewCounts.approved} approved · ${reviewCounts.rejected} rejected · ${reviewCounts.unreviewed} unreviewed`
              : undefined
          }
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
          articles={consolidated}
          initialReviews={reviews}
          categoryLookup={categoryLookup}
          onClose={() => setReviewOpen(false)}
          onReviewsChange={setReviews}
        />
      )}
    </Stack>
  );
}
