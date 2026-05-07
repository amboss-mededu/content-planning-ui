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
  },
  {
    key: 'type',
    label: 'Type',
    description: 'Article type (e.g. disease, procedure, drug)',
    render: (r) => r.articleType ?? '—',
    width: 160,
  },
  {
    key: 'category',
    label: 'Category',
    description: 'Code category that anchors this article',
    render: (r) => r.category ?? '—',
  },
  {
    key: 'numCodes',
    label: 'Codes',
    description: 'Number of source codes mapped to this article',
    render: (r) => r.numCodes ?? '—',
    width: 80,
    align: 'right',
  },
  {
    key: 'importance',
    label: 'Importance',
    description: 'Editorial importance score (higher = higher priority)',
    render: (r) => r.overallImportance ?? '—',
    width: 100,
    align: 'right',
  },
  {
    key: 'coverage',
    label: 'Coverage',
    description:
      'Existing AMBOSS coverage score for this article (higher = better covered)',
    render: (r) => r.overallCoverage ?? '—',
    width: 100,
    align: 'right',
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
  },
];

const newColumns: Column<NewArticleSuggestion>[] = [
  {
    key: 'title',
    label: 'Title',
    description: 'Suggested article title',
    render: (r) => r.articleTitle ?? '—',
  },
  {
    key: 'type',
    label: 'Type',
    description: 'Article type (e.g. disease, procedure, drug)',
    render: (r) => r.articleType ?? '—',
    width: 160,
  },
  {
    key: 'importance',
    label: 'Importance',
    description: 'Editorial importance score (higher = higher priority)',
    render: (r) => r.overallImportance ?? '—',
    width: 100,
    align: 'right',
  },
  {
    key: 'coverage',
    label: 'Existing AMBOSS',
    description: 'Free-text note on how this topic is covered in AMBOSS today',
    render: (r) => r.existingAmbossCoverage ?? '—',
    width: 140,
  },
  {
    key: 'editor',
    label: 'Editor',
    description: 'Editor assigned to draft or update this article',
    render: (r) => r.assignedEditor ?? '—',
    width: 140,
  },
  {
    key: 'verdict',
    label: 'Verdict',
    description: 'Editorial verdict on the suggestion (accept / reject / revise)',
    render: (r) => r.verdict ?? '—',
    width: 120,
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
