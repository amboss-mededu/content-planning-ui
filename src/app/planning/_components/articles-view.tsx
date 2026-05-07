'use client';

import { Callout, H2, Stack, Text } from '@amboss/design-system';
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
    description: 'Article title after consolidation/deduplication',
    render: (r) => r.articleTitle ?? '—',
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
    accessor: (r) => r.articleType ?? null,
    type: 'string',
    filterable: true,
  },
  {
    key: 'category',
    label: 'Category',
    description: 'Code category that anchors this article',
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
    align: 'right',
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
    align: 'right',
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
    align: 'right',
    accessor: (r) => r.overallCoverage ?? null,
    type: 'number',
    filterable: true,
  },
  {
    key: 'justification',
    label: 'Justification',
    description: 'Why this consolidated article was proposed',
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
    description: 'Suggested article title',
    render: (r) => r.articleTitle ?? '—',
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
    align: 'right',
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

export function ArticlesView({
  consolidated,
  newOnes,
  updates,
}: {
  consolidated: ConsolidatedArticle[];
  newOnes: NewArticleSuggestion[];
  updates: ArticleUpdateSuggestion[];
}) {
  return (
    <Stack space="xl">
      <Stack space="m">
        <H2>Consolidated articles</H2>
        <Text color="secondary">
          {consolidated.length} deduped article suggestions post-consolidation.
        </Text>
        <DataTable
          rows={consolidated}
          columns={consolidatedColumns}
          getRowKey={(r, i) => `${i}-${r.index ?? ''}`}
        />
      </Stack>

      <Stack space="m">
        <H2>New article suggestions</H2>
        <Text color="secondary">
          {newOnes.length} editor-facing suggestions for new articles.
        </Text>
        <DataTable
          rows={newOnes}
          columns={newColumns}
          getRowKey={(r, i) => `${i}-${r.index ?? ''}`}
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
