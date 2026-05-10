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
import { useEffect, useMemo, useState } from 'react';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, EmbeddedCode } from './code-utils';
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
  articleTitle?: string;
  articleType?: string;
  category?: string;
  codes: EmbeddedCode[];
  numCodes: number;
  overallCoverage?: number;
  existingAmbossCoverage?: string;
  overallImportance?: number;
  justification?: string;
  pass: 'first' | 'second';
};

type Pass = 'first' | 'second';

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
  consolidated,
  newOnes,
  updates,
  categoryLookup,
}: {
  consolidated: ArticleRow[];
  newOnes: ArticleRow[];
  updates: ArticleRow[];
  categoryLookup: CategoryLookup;
}) {
  const columns = useMemo(() => buildColumns(categoryLookup), [categoryLookup]);
  const params = useSearchParams();
  const [pass, setPass] = useState<Pass>(() =>
    params.get('pass') === 'second' ? 'second' : 'first',
  );

  useEffect(() => {
    const p = new URLSearchParams();
    if (pass !== 'first') p.set('pass', pass);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [pass]);

  const activeRows = pass === 'first' ? consolidated : newOnes;

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
        <DataTable
          rows={activeRows}
          columns={columns}
          getRowKey={(_r, i) => `${pass}-${i}`}
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
    </Stack>
  );
}
