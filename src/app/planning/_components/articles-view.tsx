'use client';

import {
  Callout,
  H2,
  Inline,
  SegmentedControl,
  Stack,
  Text,
} from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  ArticleUpdateSuggestion,
  ConsolidatedArticle,
  NewArticleSuggestion,
} from '@/lib/types';
import { type Column, DataTable } from './data-table';

const consolidatedColumns: Column<ConsolidatedArticle>[] = [
  {
    key: 'title',
    label: 'Title',
    description: 'Article title after the per-category 1st consolidation pass',
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
    width: 160,
    align: 'center',
    accessor: (r) => r.articleType ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'category',
    label: 'Category',
    description: 'Source code category that anchors this article',
    render: (r) => r.category ?? '—',
    accessor: (r) => r.category ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'numCodes',
    label: 'Codes',
    description: 'Number of source codes mapped to this article',
    render: (r) => r.numCodes ?? '—',
    width: 80,
    align: 'center',
    accessor: (r) => r.numCodes ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'importance',
    label: 'Importance',
    description: 'Editorial importance score (higher = higher priority)',
    render: (r) => r.overallImportance ?? '—',
    width: 100,
    align: 'center',
    accessor: (r) => r.overallImportance ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'coverage',
    label: 'Coverage',
    description:
      'Existing AMBOSS coverage score for this article (higher = better covered)',
    render: (r) => r.overallCoverage ?? '—',
    width: 100,
    align: 'center',
    accessor: (r) => r.overallCoverage ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'justification',
    label: 'Justification',
    description: 'Why this 1st-pass article was proposed',
    render: (r) => (
      <Text color="secondary" size="s">
        {r.justification ?? ''}
      </Text>
    ),
    accessor: (r) => r.justification ?? null,
    type: 'string',
    filterable: true,
    filterMode: 'contains',
  },
];

const newColumns: Column<NewArticleSuggestion>[] = [
  {
    key: 'title',
    label: 'Title',
    description: 'Suggested article title (post 2nd-pass cross-category consolidation)',
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
    width: 160,
    align: 'center',
    accessor: (r) => r.articleType ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'importance',
    label: 'Importance',
    description: 'Editorial importance score (higher = higher priority)',
    render: (r) => r.overallImportance ?? '—',
    width: 100,
    align: 'center',
    accessor: (r) => r.overallImportance ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'coverage',
    label: 'Existing AMBOSS',
    description: 'Free-text note on how this topic is covered in AMBOSS today',
    render: (r) => r.existingAmbossCoverage ?? '—',
    width: 140,
    align: 'center',
    accessor: (r) => r.existingAmbossCoverage ?? null,
    type: 'string',
    filterable: true,
    filterMode: 'contains',
  },
  {
    key: 'editor',
    label: 'Editor',
    description: 'Editor assigned to draft or update this article',
    render: (r) => r.assignedEditor ?? '—',
    width: 140,
    align: 'center',
    accessor: (r) => r.assignedEditor ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'verdict',
    label: 'Verdict',
    description: 'Editorial verdict on the suggestion (accept / reject / revise)',
    render: (r) => r.verdict ?? '—',
    width: 120,
    align: 'center',
    accessor: (r) => r.verdict ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'justification',
    label: 'Justification',
    description: 'Why this article should be created or updated',
    render: (r) => (
      <Text color="secondary" size="s">
        {r.justification ?? ''}
      </Text>
    ),
    accessor: (r) => r.justification ?? null,
    type: 'string',
    filterable: true,
    filterMode: 'contains',
  },
];

type Pass = 'first' | 'second';

export function ArticlesView({
  consolidated,
  newOnes,
  updates,
}: {
  consolidated: ConsolidatedArticle[];
  newOnes: NewArticleSuggestion[];
  updates: ArticleUpdateSuggestion[];
}) {
  const params = useSearchParams();
  const [pass, setPass] = useState<Pass>(() => {
    const v = params.get('pass');
    return v === 'second' ? 'second' : 'first';
  });

  // Mirror the URL-param sync pattern from sections-view: hold the lens in
  // local state and writeback via replaceState so refresh preserves the
  // choice without a full server round-trip.
  useEffect(() => {
    const p = new URLSearchParams();
    if (pass !== 'first') p.set('pass', pass);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [pass]);

  const summary =
    pass === 'first'
      ? `${consolidated.length.toLocaleString()} 1st-pass articles — per-category aggregation (consolidatedArticles).`
      : `${newOnes.length.toLocaleString()} 2nd-pass articles — cross-category, editor-facing (newArticleSuggestions).`;

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
        </Inline>
        <Text color="secondary">{summary}</Text>
        {pass === 'first' ? (
          <DataTable
            rows={consolidated}
            columns={consolidatedColumns}
            getRowKey={(r, i) => `${i}-${r.index ?? ''}`}
            emptyText="No 1st-pass articles for this specialty."
          />
        ) : (
          <DataTable
            rows={newOnes}
            columns={newColumns}
            getRowKey={(r, i) => `${i}-${r.index ?? ''}`}
            emptyText="No 2nd-pass articles for this specialty."
          />
        )}
      </Stack>

      <Stack space="m">
        <H2>Article update suggestions</H2>
        {updates.length === 0 ? (
          <Callout
            type="info"
            text="Article_Update_Suggestions is empty for this specialty."
          />
        ) : (
          <DataTable
            rows={updates}
            columns={newColumns}
            getRowKey={(r, i) => `${i}-${r.index ?? ''}`}
          />
        )}
      </Stack>
    </Stack>
  );
}
